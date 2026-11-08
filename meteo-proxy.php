<?php
/**
 * Proxy Météo - Fusion MET.no + Open-Meteo
 * 
 * Stratégie de données :
 * - 0-72h : données Open-Meteo (multi-modèles)
 * - 72h+  : données MET.no uniquement
 * 
 * Modèles Open-Meteo (par ordre de priorité) :
 * - best_match : fusion optimisée multi-modèles, calibrée sur observations réelles
 *   → Plus précis que les modèles individuels en montagne (testé empiriquement)
 *   → Cumuls de neige cohérents avec annonces stations (~9cm vs ~2cm pour AROME seul)
 * - meteofrance_arome_france_hd : haute résolution 1.5km (température, vent)
 *   → N'a PAS rain/snowfall/weather_code séparés
 * - meteofrance_arome_france : résolution 2.5km avec décomposition rain/snowfall
 * - meteofrance_arpege_seamless : cloud_cover plus réaliste qu'AROME, fallback pour le reste
 * - meteofrance_seamless : fallback + precipitation_probability (seule source)
 * 
 * Neige/pluie (même règle pour Open-Meteo, AROME et MET.no) :
 * - Neige si : température humide <= 1.0°C (calculée depuis T et Td)
 * - Quantité de neige : précipitation × SLR Roebber
 * - La décomposition rain/snowfall des modèles n'est pas utilisée pour le type
 */

// CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Content-Type: application/json');

require_once __DIR__ . '/lib/weather.php';

/**
 * Ce que reçoit le front : les prévisions au format commun, l'altitude et les métadonnées.
 * Le fichier de cache garde en plus les réponses brutes d'Open-Meteo et de MET.no
 * (historique MET.no, reconstruction de "forecasts" pour un cache antérieur), dont le front
 * n'a pas besoin.
 */
function client_payload(array $data) {
    return array_intersect_key($data, array_flip(['forecasts', 'elevation', 'meta']));
}

// ================= CACHE =================

const CACHE_DURATION = 15 * 60;        // 15 minutes en secondes
const CACHE_MIN_SIZE = 50 * 1024;      // 50 Ko minimum pour un cache valide

// ================= CONFIG =================
// Proxy HTTP désactivé (plus utilisé)
$proxy_host = '';
$proxy_port = '';
$proxy_user = '';
$proxy_pass = '';

// ================= PARAMS =================

$lat = isset($_GET['lat']) ? (float) $_GET['lat'] : null;
$lon = isset($_GET['lon']) ? (float) $_GET['lon'] : null;
$force_refresh = isset($_GET['refresh']) && $_GET['refresh'] == '1';

if ($lat === null || $lon === null) {
    echo json_encode(['error' => 'Coordonnées manquantes']);
    exit;
}

// ================= CACHE CONFIG =================

$cache_dir = __DIR__ . '/cache';
$cache_duration = CACHE_DURATION;
$min_size = CACHE_MIN_SIZE;
$cache_file = $cache_dir . '/meteo_' . round($lat, 4) . '_' . round($lon, 4) . '.json';

// Créer le dossier cache si nécessaire
if (!is_dir($cache_dir)) {
    mkdir($cache_dir, 0755, true);
}

// Vérifier le cache (sauf si refresh forcé)
if (!$force_refresh && file_exists($cache_file)) {
    $cache_age = time() - filemtime($cache_file);
    $cache_size = filesize($cache_file);
    if ($cache_age < $cache_duration && $cache_size > $min_size) {
        // Cache valide, le retourner directement
        $cached_data = json_decode(file_get_contents($cache_file), true);
        if ($cached_data) {
            // Cache écrit par une version antérieure à la clé "forecasts" : on la reconstruit
            $cached_data['forecasts'] ??= build_forecasts($cached_data['openmeteo'] ?? null, $cached_data['metno'] ?? null, $cached_data['elevation'] ?? null);
            $cached_data['meta']['from_cache'] = true;
            $cached_data['meta']['cache_age'] = $cache_age;
            echo json_encode(client_payload($cached_data));
            exit;
        }
    }
}

// ================= URLS =================

$url_metno = "https://api.met.no/weatherapi/locationforecast/2.0/?lat=$lat&lon=$lon";

// Dates pour couvrir minuit heure locale (Europe/Paris = UTC+1 ou UTC+2)
// On commence la veille à 22h UTC pour capturer minuit local
$start_date = gmdate('Y-m-d', strtotime('-1 day'));
$end_date = gmdate('Y-m-d', strtotime('+7 days'));

$url_openmeteo = "https://api.open-meteo.com/v1/forecast?" . http_build_query([
    'latitude' => $lat,
    'longitude' => $lon,
    'models' => 'best_match,meteofrance_arome_france_hd,meteofrance_arome_france,meteofrance_arpege_seamless,meteofrance_seamless,meteoswiss_icon_seamless',
    'timezone' => 'GMT',
    'start_date' => $start_date,
    'end_date' => $end_date,
    'hourly' => implode(',', [
        'temperature_2m','apparent_temperature','dew_point_2m','freezing_level_height',
        'relative_humidity_2m','precipitation','rain','snowfall','showers',
        'weather_code','cloud_cover','wind_speed_10m','wind_direction_10m',
        'wind_gusts_10m','precipitation_probability','is_day','total_column_integrated_water_vapour','uv_index','uv_index_clear_sky',
        'temperature_850hPa','temperature_700hPa','temperature_500hPa'
    ]),
    'daily' => implode(',', [
        'precipitation_sum','showers_sum','snowfall_sum',
    ]),
    'cell_selection' => 'land'
]);

//echo $url_openmeteo;
//return;

// ================= CURL =================

function get_curl_handle($url, $proxy_host, $proxy_port, $proxy_user, $proxy_pass) {
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => [
            'User-Agent: MeteoFoux/1.0',
            'Contact: olivier@igloo.ovh'
        ]
    ];

    // Ajouter le proxy seulement s'il est configuré
    if (!empty($proxy_host)) {
        $opts[CURLOPT_PROXY] = $proxy_host;
        $opts[CURLOPT_PROXYPORT] = $proxy_port;
        $opts[CURLOPT_PROXYUSERPWD] = "$proxy_user:$proxy_pass";
    }

    curl_setopt_array($ch, $opts);
    return $ch;
}


// ================= EXEC (séquentiel pour éviter saturation proxy) =================

// Appel Open-Meteo (en premier : son altitude sert à MET.no)
$ch_open = get_curl_handle($url_openmeteo, $proxy_host, $proxy_port, $proxy_user, $proxy_pass);
$res_open_raw = curl_exec($ch_open);
$http_open = curl_getinfo($ch_open, CURLINFO_HTTP_CODE);
$res_open = json_decode($res_open_raw, true);
curl_close($ch_open);

// Sans altitude, MET.no utilise son propre relief : 2475 m au lieu de 2590 à
// l'Observatoire, soit ~0,7 °C trop chaud. On lui passe celle d'Open-Meteo.
if (isset($res_open['elevation'])) {
    $url_metno .= '&altitude=' . (int) round($res_open['elevation']);
}

// Petit délai entre les deux APIs
usleep(100000); // 100ms

// Appel MET.no
$ch_metno = get_curl_handle($url_metno, $proxy_host, $proxy_port, $proxy_user, $proxy_pass);
$res_metno_raw = curl_exec($ch_metno);
$http_metno = curl_getinfo($ch_metno, CURLINFO_HTTP_CODE);
$res_metno = json_decode($res_metno_raw, true);
curl_close($ch_metno);

// ================= VALIDATION DES RÉPONSES =================
// Une réponse absente ou tronquée (timeout, throttle 429, erreur 5xx) ne doit
// jamais écraser le cache : il contient aussi l'historique MET.no accumulé.

$metno_ok = $res_metno && isset($res_metno['properties']['timeseries']);
$open_ok = $res_open && isset($res_open['hourly']);

if (!$metno_ok && !$open_ok) {
    // Les deux sources sont KO : servir le cache périmé plutôt qu'un payload cassé
    if (file_exists($cache_file) && filesize($cache_file) > $min_size) {
        $stale = json_decode(file_get_contents($cache_file), true);
        if ($stale) {
            $stale['forecasts'] ??= build_forecasts($stale['openmeteo'] ?? null, $stale['metno'] ?? null, $stale['elevation'] ?? null);
            $stale['meta']['from_cache'] = true;
            $stale['meta']['stale'] = true;
            $stale['meta']['cache_age'] = time() - filemtime($cache_file);
            echo json_encode(client_payload($stale));
            exit;
        }
    }
    http_response_code(502);
    echo json_encode([
        'error' => 'Sources météo indisponibles',
        'http_metno' => $http_metno,
        'http_openmeteo' => $http_open
    ]);
    exit;
}

// ================= OUTPUT =================

// Récupérer l'elevation depuis Open-Meteo (utile pour le front)
$elevation = $res_open['elevation'] ?? null;

// Merger les données MET.no avec le cache existant (garder l'historique)
$metno_merged = $res_metno;
if ($res_metno && file_exists($cache_file)) {
    $cached = json_decode(file_get_contents($cache_file), true);
    if ($cached && isset($cached['metno']['properties']['timeseries'])) {
        // Purge des entrées antérieures à minuit (heure locale)
        $metno_merged['properties']['timeseries'] = merge_metno_timeseries(
            $cached['metno']['properties']['timeseries'],
            $res_metno['properties']['timeseries'] ?? [],
            // Minuit heure de Paris : le fuseau PHP est UTC, et un minuit UTC
            // supprimait l'heure 0h-1h locale (1h-2h en été)
            (new DateTime('today', new DateTimeZone('Europe/Paris')))->getTimestamp()
        );
    }
}

// Toutes les sources au format commun (adaptateurs + pipeline commun, voir lib/weather.php)
$forecasts = build_forecasts($res_open, $metno_merged, $elevation);

$output = [
    'metno' => $metno_merged,
    'openmeteo' => $res_open,
    'forecasts' => $forecasts,
    'elevation' => $elevation,
    'meta' => [
        'generated_at' => gmdate('Y-m-d\TH:i:s\Z'),
        'sources' => [
            'openmeteo' => [
                'description' => 'Open-Meteo best_match (fusion optimisée multi-modèles)',
                'priority' => 'best_match → arome_hd → seamless → arome',
                'coverage' => '7 jours'
            ],
            'arome' => [
                'description' => 'Météo-France AROME + ARPEGE (modèles français uniquement)',
                'priority' => 'arome_hd → arome → arpege → seamless (cloud: arpege → arome → seamless)',
                'coverage' => '~4.5 jours (données null après)'
            ],
            'metno' => [
                'description' => 'MET.no Locationforecast (Institut météo norvégien)',
                'coverage' => '~10 jours'
            ]
        ],
        'slr_method' => 'Roebber simplifié (base ' . ROEBBER_BASE_SLR . ', calibré Alpes) - facteurs: temp, humidity, wind',
        'snow_detection' => 'wet-bulb temperature <= ' . SNOW_WET_BULB_THRESHOLD . '°C (Stull, from temp and dew_point)',
        'snow_quality' => 'wet if temp > ' . DRY_SNOW_TEMP_THRESHOLD . '°C AND dew_point > ' . DRY_SNOW_DEW_POINT_THRESHOLD . '°C, else dry',
        'freezing_level_correction' => 'corrected=true when API value > elevation AND temp <= 0°C',
        'http_metno' => $http_metno,
        'http_openmeteo' => $http_open,
        'from_cache' => false
    ]
];

// Sauvegarder en cache uniquement si les deux sources ont répondu :
// un payload partiel écraserait le cache valide et l'historique MET.no mergé.
if ($metno_ok && $open_ok) {
    file_put_contents($cache_file, json_encode($output));
}

echo json_encode(client_payload($output));

