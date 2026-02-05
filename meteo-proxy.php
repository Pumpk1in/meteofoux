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
 * - meteofrance_seamless : fallback + precipitation_probability (seule source)
 * 
 * Fallback neige/pluie :
 * - Si précipitation > 0 mais rain/snowfall absents ou à 0
 * - On utilise température + point de rosée pour déduire le type
 * - Neige si : temp <= 1.5°C ET dew_point <= 0.5°C
 */

// CORS headers
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Content-Type: application/json');

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
$cache_duration = 15 * 60; // 15 minutes en secondes
$min_size = 50 * 1024; // 50 Ko convertis en octets
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
            $cached_data['meta']['from_cache'] = true;
            $cached_data['meta']['cache_age'] = $cache_age;
            echo json_encode($cached_data);
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
    'models' => 'best_match,meteofrance_arome_france_hd,meteofrance_arome_france,meteofrance_seamless,meteoswiss_icon_seamless',
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

// ================= HELPERS =================

/**
 * Récupère une valeur depuis les données multi-modèles avec fallback
 * Parcourt les modèles par ordre de priorité jusqu'à trouver une valeur non-null
 */
function get_model_value($data, $key, $index, $models_priority) {
    foreach ($models_priority as $model) {
        $k = $key . '_' . $model;
        if (isset($data[$k][$index]) && $data[$k][$index] !== null) {
            return $data[$k][$index];
        }
    }
    return $data[$key][$index] ?? null;
}

/**
 * Détermine si c'est de la neige basé sur température et point de rosée
 * Utilisé comme fallback quand rain/snowfall ne sont pas disponibles
 * 
 * @param float|null $temp Température en °C
 * @param float|null $dew_point Point de rosée en °C
 * @return bool True si les conditions indiquent de la neige
 */
function is_snow_conditions($temp, $dew_point) {
    if ($temp === null) return false;
    return $temp <= 1.5 && ($dew_point === null || $dew_point <= 0.5);
}

/**
 * Détermine la qualité de la neige (sèche ou humide)
 * Basé sur température et point de rosée
 * 
 * @param float $snowfall Quantité de neige
 * @param float|null $temp Température en °C
 * @param float|null $dew_point Point de rosée en °C
 * @return string|null 'dry', 'wet', ou null si pas de neige
 */
function get_snow_quality($snowfall, $temp, $dew_point) {
    if ($snowfall <= 0 || $temp === null || $dew_point === null) {
        return null;
    }
    
    // Neige humide/collante si temp > -2°C ET point de rosée > -3°C
    $is_sticky = ($temp > -2 && $dew_point > -3);
    
    return $is_sticky ? 'wet' : 'dry';
}

/**
 * Calcule le ratio neige/eau (Snow-to-Liquid Ratio) selon la méthode Roebber simplifiée
 *
 * Basé sur Roebber et al. (2003) - adapté pour les Alpes européennes
 * Prend en compte : température, humidité relative, vitesse du vent (compaction)
 *
 * Observations alpines : densité neige fraîche ~68-110 kg/m³ (SLR moyen ~14-15:1)
 * Source: https://hess.copernicus.org/articles/22/2655/2018/
 *
 * @param float|null $temp Température en °C
 * @param float|null $humidity Humidité relative en %
 * @param float|null $wind_speed Vitesse du vent en m/s
 * @return float Ratio SLR (ex: 15 signifie 1mm eau = 1.5cm neige)
 */
function calculate_roebber_slr($temp, $humidity = null, $wind_speed = null) {
    // Base alpine (observations moyennes dans les Alpes)
    $base_slr = 14.0;
    $threshold_k = 271.16;  // -2°C en Kelvin

    if ($temp === null) {
        return $base_slr;
    }

    // Ajustement température (similaire à Kuchera)
    $temp_k = $temp + 273.15;
    if ($temp_k > $threshold_k) {
        // Au-dessus de -2°C : pente plus forte (fonte possible)
        $temp_adj = 2.0 * ($threshold_k - $temp_k);
    } else {
        // En dessous de -2°C : neige plus légère
        $temp_adj = ($threshold_k - $temp_k);
    }

    // Ajustement humidité (Roebber factor)
    // Humidité haute (>90%) = neige plus humide/dense = SLR plus bas
    // Référence: 75% = neutre
    $humidity = $humidity ?? 75;
    $humid_adj = (75 - $humidity) / 15;  // ~[-1, +1]

    // Ajustement vent - compaction (Roebber factor)
    // Vent > 3 m/s commence à compacter la neige
    $wind_speed = $wind_speed ?? 0;
    $wind_adj = -max(0, ($wind_speed - 3)) * 0.3;  // Pénalité progressive

    $slr = $base_slr + $temp_adj + $humid_adj + $wind_adj;

    // Borner entre 5 et 25 (valeurs réalistes observées)
    return max(5.0, min($slr, 25.0));
}

/**
 * Calcule le snowfall en utilisant le ratio SLR
 *
 * @param float $precipitation Précipitation en mm
 * @param float $slr Ratio Snow-to-Liquid
 * @return float Neige en cm
 */
function calculate_snowfall_from_slr($precipitation, $slr) {
    // precipitation (mm) * SLR / 10 = neige en cm
    // Ex: 10mm * 15 / 10 = 15cm
    return $precipitation * $slr / 10.0;
}

// ============================================================
// MÉTHODE KUCHERA (conservée pour référence/fallback)
// Décommenter si besoin de revenir à cette méthode
// ============================================================
/*
function calculate_kuchera_slr($temp_max_column) {
    if ($temp_max_column === null) {
        return 10.0;  // Ratio par défaut US
    }
    $temp_k = $temp_max_column + 273.15;
    $threshold_k = 271.16;  // -2°C en Kelvin
    if ($temp_k > $threshold_k) {
        return 12.0 + 2.0 * ($threshold_k - $temp_k);
    } else {
        return 12.0 + ($threshold_k - $temp_k);
    }
}

function calculate_kuchera_snowfall($precipitation, $slr) {
    return $precipitation * $slr / 10.0;
}
*/

/**
 * Calcule le point de rosée à partir de la température et de l'humidité relative
 * Formule de Magnus-Tetens (précision ±0.4°C pour -40°C à 50°C)
 * 
 * @param float|null $temp Température en °C
 * @param float|null $humidity Humidité relative en %
 * @return float|null Point de rosée en °C
 */
function calculate_dew_point($temp, $humidity) {
    if ($temp === null || $humidity === null || $humidity <= 0) {
        return null;
    }
    
    $a = 17.27;
    $b = 237.7;
    $alpha = (($a * $temp) / ($b + $temp)) + log($humidity / 100);
    
    return round(($b * $alpha) / ($a - $alpha), 1);
}

/**
 * Corrige le freezing_level en cas d'incohérence avec la température locale
 *
 * Problème : Les modèles météo calculent le freezing_level à partir du profil
 * atmosphérique "libre", sans tenir compte des inversions thermiques locales
 * fréquentes en montagne (air froid piégé dans les vallées).
 *
 * Résultat : Quand la température à la station est négative, le freezing_level
 * indique parfois une altitude bien supérieure, ce qui est incohérent.
 *
 * Solution :
 * 1. Si best_match est cohérent (freezing_level <= elevation OU temp > 0°C) → utiliser best_match
 *    SAUF si temp très négative et freezing proche de l'élévation (bug best_match probable)
 * 2. Sinon, utiliser meteoswiss_icon_seamless comme fallback (plus fiable en montagne)
 * 3. Si meteoswiss aussi incohérent → retourner l'elevation avec flag "corrected"
 *
 * @param float|null $freezing_level Altitude de l'isotherme 0°C best_match (en m)
 * @param float|null $freezing_level_fallback Altitude MeteoSwiss (en m)
 * @param float|null $temp Température à la station (en °C)
 * @param float $elevation Altitude de la station (en m, depuis Open-Meteo)
 * @return array ['value' => float|null, 'corrected' => bool, 'source' => string]
 */
function correct_freezing_level($freezing_level, $freezing_level_fallback, $temp, $elevation) {
    // Pas de données
    if ($elevation === null) {
        return ['value' => $freezing_level !== null ? round($freezing_level) : null, 'corrected' => false, 'source' => 'best_match'];
    }

    // Détection de valeur suspecte : temp très négative mais freezing proche de l'élévation
    // Avec -10°C, l'iso 0 devrait être ~1500m plus bas (gradient ~6.5°C/1000m)
    // Si freezing est dans les 500m sous l'élévation avec temp < -5°C, c'est suspect
    $suspect_best_match = ($temp !== null && $temp < -5 && $freezing_level !== null
        && $freezing_level > $elevation - 500);

    // Cas cohérent avec best_match : freezing_level <= elevation OU temp > 0°C
    // Mais pas si la valeur semble suspecte
    if (!$suspect_best_match && $freezing_level !== null && ($freezing_level <= $elevation || $temp === null || $temp > 0)) {
        return ['value' => round($freezing_level), 'corrected' => false, 'source' => 'best_match'];
    }

    // best_match incohérent ou suspect → essayer meteoswiss_icon_seamless
    if ($freezing_level_fallback !== null) {
        // MeteoSwiss cohérent ?
        if ($freezing_level_fallback <= $elevation || $temp === null || $temp > 0) {
            return ['value' => round($freezing_level_fallback), 'corrected' => false, 'source' => 'meteoswiss'];
        }
    }

    // Aucun modèle cohérent : freezing_level > elevation ET temp <= 0°C
    // On indique que le vrai freezing_level est sous l'altitude de la station
    return ['value' => round($elevation), 'corrected' => true, 'source' => 'elevation'];
}

/**
 * Détermine le symbol_code MET.no basé sur les précipitations et le code WMO
 * 
 * Référence : legend.csv de MET.no
 * - Variants=1 : icônes avec _day/_night (clearsky, fair, partlycloudy, *showers*)
 * - Variants=0 : icônes uniques (cloudy, fog, rain, snow, sleet sans "showers")
 * 
 * Fallback nuit : pour les icônes sans variante nuit (snow, lightsnow, sleet, lightsleet),
 * on utilise la version "showers" + _night pour avoir une icône nocturne cohérente.
 * 
 * Codes WMO :
 * - 0: ciel clair, 1: peu nuageux, 2: partiellement nuageux, 3: couvert
 * - 45,48: brouillard
 * - 51-57: bruine (56-57 verglaçante)
 * - 61-67: pluie (66-67 verglaçante)
 * - 68-69: pluie et neige mêlées
 * - 71-77: neige
 * - 80-82: averses de pluie
 * - 85-86: averses de neige
 * - 95,96,99: orage
 * 
 * Note: MET.no a des typos dans leurs noms de fichiers :
 * - lightssleetshowersandthunder (double 's')
 * - lightssnowshowersandthunder (double 's')
 */
function determine_symbol($snowfall, $rain, $wmo_code, $is_day) {
    $wmo_code = $wmo_code ?? 0;
    $suffix = $is_day ? '_day' : '_night';

    // Détection du type de précipitation par code WMO
    $showers = in_array($wmo_code, [80, 81, 82, 85, 86], true);
    $thunder = in_array($wmo_code, [95, 96, 99], true);
    $is_sleet_wmo = in_array($wmo_code, [56, 57, 66, 67, 68, 69], true);
    
    // ==================== SLEET (neige fondue / pluie verglaçante) ====================
    
    // Sleet détecté par code WMO
    if ($is_sleet_wmo) {
        // Forte intensité (codes 57, 67, 69)
        if (in_array($wmo_code, [57, 67, 69])) {
            if ($thunder) return $showers ? 'heavysleetshowersandthunder' : 'heavysleetandthunder';
            if ($showers) return 'heavysleetshowers' . $suffix;
            return $is_day ? 'heavysleet' : 'heavysleetshowers' . $suffix;
        }
        // Faible intensité (codes 56, 66, 68)
        if ($thunder) return $showers ? 'lightssleetshowersandthunder' : 'lightsleetandthunder';
        if ($showers) return 'lightsleetshowers' . $suffix;
        return $is_day ? 'lightsleet' : 'lightsleetshowers' . $suffix;
    }
    
    // Sleet détecté par les données : pluie ET neige en même temps
    if ($rain > 0 && $snowfall > 0) {
        $total = $rain + $snowfall;
        
        // Heavy sleet (>= 2.5)
        if ($total >= 2.5) {
            if ($thunder) return $showers ? 'heavysleetshowersandthunder' : 'heavysleetandthunder';
            if ($showers) return 'heavysleetshowers' . $suffix;
            return $is_day ? 'heavysleet' : 'heavysleetshowers' . $suffix;
        }
        // Normal sleet (>= 1.0)
        if ($total >= 1.0) {
            if ($thunder) return $showers ? 'sleetshowersandthunder' : 'sleetandthunder';
            if ($showers) return 'sleetshowers' . $suffix;
            return $is_day ? 'sleet' : 'sleetshowers' . $suffix;
        }
        // Light sleet (< 1.0) - noter le double 's' dans lightssleet...
        if ($thunder) return $showers ? 'lightssleetshowersandthunder' : 'lightsleetandthunder';
        if ($showers) return 'lightsleetshowers' . $suffix;
        return $is_day ? 'lightsleet' : 'lightsleetshowers' . $suffix;
    }

    // ==================== NEIGE ====================
    // Seuils : light < 1.0, moderate 1.0-2.5, heavy >= 2.5 cm/h
    
    if ($snowfall > 0) {
        // Heavy snow (>= 2.5 cm)
        if ($snowfall >= 2.5) {
            if ($thunder) return $showers ? 'heavysnowshowersandthunder' : 'heavysnowandthunder';
            if ($showers) return 'heavysnowshowers' . $suffix;
            return 'heavysnow'; // Variants=0, pas de _day/_night
        }
        // Normal snow (>= 1.0 cm)
        if ($snowfall >= 1.0) {
            if ($thunder) return $showers ? 'snowshowersandthunder' : 'snowandthunder';
            if ($showers) return 'snowshowers' . $suffix;
            return $is_day ? 'snow' : 'snowshowers' . $suffix; // Fallback nuit
        }
        // Light snow (< 1.0 cm) - noter le double 's' dans lightssnow...
        if ($thunder) return $showers ? 'lightssnowshowersandthunder' : 'lightsnowandthunder';
        if ($showers) return 'lightsnowshowers' . $suffix;
        return $is_day ? 'lightsnow' : 'lightsnowshowers' . $suffix; // Fallback nuit
    }

    // ==================== PLUIE ====================
    // Seuils : light < 2.5, moderate 2.5-7.5, heavy >= 7.5 mm/h
    
    if ($rain > 0) {
        // Heavy rain (>= 7.5 mm)
        if ($rain >= 7.5) {
            if ($thunder) return $showers ? 'heavyrainshowersandthunder' : 'heavyrainandthunder';
            if ($showers) return 'heavyrainshowers' . $suffix;
            return 'heavyrain'; // Variants=0
        }
        // Normal rain (>= 2.5 mm)
        if ($rain >= 2.5) {
            if ($thunder) return $showers ? 'rainshowersandthunder' : 'rainandthunder';
            if ($showers) return 'rainshowers' . $suffix;
            return 'rain'; // Variants=0
        }
        // Light rain (< 2.5 mm)
        if ($thunder) return $showers ? 'lightrainshowersandthunder' : 'lightrainandthunder';
        if ($showers) return 'lightrainshowers' . $suffix;
        return 'lightrain'; // Variants=0
    }

    // ==================== PAS DE PRÉCIPITATION DÉTECTÉE ====================
    // Mais le weather_code peut quand même indiquer des précipitations
    // (incohérence entre modèles). On utilise le code WMO comme fallback.

    // Codes WMO de précipitation sans données rain/snowfall détectées
    // → Afficher une icône cohérente avec le code plutôt que clearsky
    if (in_array($wmo_code, [51, 53, 55, 56, 57])) {
        // Bruine (légère, modérée, forte, verglaçante)
        return 'lightrain';
    }
    if (in_array($wmo_code, [61, 63, 80])) {
        // Pluie légère à modérée
        return 'lightrain';
    }
    if (in_array($wmo_code, [65, 81, 82])) {
        // Pluie forte
        return 'rain';
    }
    if (in_array($wmo_code, [66, 67, 68, 69])) {
        // Pluie verglaçante / neige mêlée
        return $is_day ? 'lightsleet' : 'lightsleetshowers' . $suffix;
    }
    if (in_array($wmo_code, [71, 85])) {
        // Neige légère
        return $is_day ? 'lightsnow' : 'lightsnowshowers' . $suffix;
    }
    if (in_array($wmo_code, [73])) {
        // Neige modérée
        return $is_day ? 'snow' : 'snowshowers' . $suffix;
    }
    if (in_array($wmo_code, [75, 77, 86])) {
        // Neige forte
        return 'heavysnow';
    }
    if (in_array($wmo_code, [95, 96, 99])) {
        // Orage
        return 'rainandthunder';
    }

    // Nuages/soleil/brouillard
    return match ($wmo_code) {
        0 => 'clearsky' . $suffix,      // Ciel clair
        1 => 'fair' . $suffix,          // Peu nuageux
        2 => 'partlycloudy' . $suffix,  // Partiellement nuageux
        3 => 'cloudy',                  // Couvert (Variants=0)
        45, 48 => 'fog',                // Brouillard (Variants=0)
        default => 'clearsky' . $suffix
    };
}

/**
 * Enrichit les données hourly d'Open-Meteo
 * Fusionne les données de plusieurs modèles selon leur spécialité
 *
 * @param array $openmeteo Données brutes Open-Meteo
 * @param float $elevation Altitude de la station (depuis Open-Meteo)
 * @param array|null $priorities Priorités personnalisées ['hd' => [...], 'decomp' => [...], 'prob' => [...], 'freezing' => [...]]
 */
function enrich_openmeteo_hourly($openmeteo, $elevation = null, $priorities = null) {
    if (!isset($openmeteo['hourly']['time'])) return null;

    $hourly = $openmeteo['hourly'];
    $count = count($hourly['time']);

    // Priorités par défaut (best_match) ou personnalisées
    // - best_match en premier : fusion optimisée, plus précise en montagne
    // - Fallbacks sur modèles Météo-France spécifiques si best_match absent

    // Température, vent, précip totale
    $prio_hd = $priorities['hd'] ?? ['best_match', 'meteofrance_arome_france_hd', 'meteofrance_seamless', 'meteofrance_arome_france'];

    // Rain/snowfall/weather_code (best_match les a, sinon arome_france)
    $prio_decomp = $priorities['decomp'] ?? ['best_match', 'meteofrance_arome_france', 'meteofrance_seamless'];

    // Precipitation_probability (uniquement seamless et best_match)
    $prio_prob = $priorities['prob'] ?? ['meteofrance_seamless', 'best_match'];

    // Freezing level (isotherme 0)
    $prio_freezing = $priorities['freezing'] ?? ['best_match'];

    $enriched = [
        'time' => [],
        'temperature' => [],
        'apparent_temperature' => [],
        'dew_point' => [],
        'humidity' => [],
        'wind_speed' => [],
        'wind_direction' => [],
        'wind_gusts' => [],
        'precipitation' => [],
        'rain' => [],
        'snowfall' => [],
        'snowfall_roebber' => [],  // Neige calculée avec méthode Roebber (calibrée Alpes)
        'roebber_slr' => [],  // Ratio SLR Roebber utilisé
        'precipitation_probability' => [],
        'freezing_point' => [],
        'freezing_point_corrected' => [],  // true si valeur corrigée (inversion thermique)
        'cloud_cover' => [],
        'weather_code' => [],
        'symbol_code' => [],
        'snow_quality' => [],
        'uv_index' => [],
        'is_day' => []
    ];
    
    for ($i = 0; $i < $count; $i++) {
        $time = $hourly['time'][$i];
        
        // Température et vent
        $temp = get_model_value($hourly, 'temperature_2m', $i, $prio_hd);
        $apparent = get_model_value($hourly, 'apparent_temperature', $i, $prio_hd);
        $dew = get_model_value($hourly, 'dew_point_2m', $i, $prio_hd);
        $humidity = get_model_value($hourly, 'relative_humidity_2m', $i, $prio_hd);
        $wind_speed = get_model_value($hourly, 'wind_speed_10m', $i, $prio_hd);
        $wind_dir = get_model_value($hourly, 'wind_direction_10m', $i, $prio_hd);
        $wind_gusts = get_model_value($hourly, 'wind_gusts_10m', $i, $prio_hd);
        $cloud = get_model_value($hourly, 'cloud_cover', $i, $prio_decomp);

        // Précipitation totale
        $precip = get_model_value($hourly, 'precipitation', $i, $prio_hd) ?? 0;
        
        // Probabilité de précipitation
        $precip_prob = get_model_value($hourly, 'precipitation_probability', $i, $prio_prob) ?? 0;

        // Isotherme 0 - avec correction pour inversions thermiques
        // Priorité: selon $prio_freezing, fallback sur meteoswiss_icon_seamless si incohérent
        $freezing_point_raw = get_model_value($hourly, 'freezing_level_height', $i, $prio_freezing);
        $freezing_point_meteoswiss = $hourly['freezing_level_height_meteoswiss_icon_seamless'][$i] ?? null;
        $freezing_correction = correct_freezing_level($freezing_point_raw, $freezing_point_meteoswiss, $temp, $elevation);
        $freezing_point = $freezing_correction['value'];
        $freezing_corrected = $freezing_correction['corrected'];
        
        // Rain/Snowfall décomposés
        $rain = get_model_value($hourly, 'rain', $i, $prio_decomp);
        $snowfall = get_model_value($hourly, 'snowfall', $i, $prio_decomp);
        
        // Weather code - IMPORTANT pour determine_symbol quand pas de précipitations
        $weather_code = get_model_value($hourly, 'weather_code', $i, $prio_decomp);

        // ============================================================
        // CORRECTION INCOHÉRENCE WEATHER_CODE / PRÉCIPITATIONS
        // Open-Meteo "best_match" peut mixer des modèles incohérents :
        // weather_code=61 (pluie) mais rain=0.
        //
        // Stratégie : fallback sur meteofrance_arome_france si incohérent,
        // puis correction basée sur cloud_cover en dernier recours.
        // ============================================================
        $precip_codes = range(51, 99); // Codes WMO de précipitation
        $has_precip_data = ($rain > 0 || $snowfall > 0 || $precip > 0);

        if (in_array($weather_code, $precip_codes) && !$has_precip_data) {
            // Incohérence détectée : essayer meteofrance_arome_france
            $arome_prio = ['meteofrance_arome_france'];
            $arome_weather_code = get_model_value($hourly, 'weather_code', $i, $arome_prio);
            $arome_rain = get_model_value($hourly, 'rain', $i, $arome_prio);
            $arome_snowfall = get_model_value($hourly, 'snowfall', $i, $arome_prio);
            $arome_precip = get_model_value($hourly, 'precipitation', $i, $arome_prio) ?? 0;

            $arome_has_precip = ($arome_rain > 0 || $arome_snowfall > 0 || $arome_precip > 0);
            $arome_is_precip_code = in_array($arome_weather_code, $precip_codes);

            // AROME est cohérent ?
            if ($arome_weather_code !== null && ($arome_is_precip_code === $arome_has_precip)) {
                // Utiliser les données AROME (cohérentes)
                $weather_code = $arome_weather_code;
                $rain = $arome_rain;
                $snowfall = $arome_snowfall;
                $precip = $arome_precip;
            } else {
                // AROME aussi incohérent ou indisponible → correction basée sur cloud_cover
                $weather_code = ($cloud >= 80) ? 3 : (($cloud >= 50) ? 2 : 1);
            }
        }

        // ============================================================
        // CORRECTION WEATHER_CODE / CLOUD_COVER (cas inverse)
        // Si weather_code indique beau temps (0=clair, 1=peu nuageux) mais
        // cloud_cover est élevé, corriger le weather_code.
        // ============================================================
        if (in_array($weather_code, [0, 1]) && $cloud !== null) {
            if ($cloud >= 80) {
                $weather_code = 3; // Couvert
            } elseif ($cloud >= 50 && $weather_code === 0) {
                $weather_code = 2; // Partiellement nuageux
            }
        }

        // ============================================================
        // FALLBACK INTELLIGENT NEIGE/PLUIE
        // Si on a des précipitations mais pas de décomposition rain/snowfall,
        // on utilise la température et le point de rosée pour déduire le type.
        // Note: $rain et $snowfall sont déjà récupérés plus haut pour la
        // correction du weather_code.
        // ============================================================
        if ($rain === null && $snowfall === null) {
            if ($precip > 0 && $temp !== null) {
                if (is_snow_conditions($temp, $dew)) {
                    $snowfall = $precip;
                    $rain = 0;
                } else {
                    $rain = $precip;
                    $snowfall = 0;
                }
            } else {
                $rain = 0;
                $snowfall = 0;
            }
        } elseif (($rain == 0 && $snowfall == 0) && $precip > 0) {
            // Cas 2: rain/snowfall à 0 mais précipitation > 0
            if (is_snow_conditions($temp, $dew)) {
                $snowfall = $precip;
                $rain = 0;
            } else {
                $rain = $precip;
                $snowfall = 0;
            }
        }
        
        // Assurer que rain/snowfall ne sont jamais null
        $rain = $rain ?? 0;
        $snowfall = $snowfall ?? 0;

        // ============================================================
        // CALCUL ROEBBER : neige basée sur précipitation + ratio dynamique
        // Méthode calibrée pour les Alpes (temp, humidité, vent)
        // Plus réaliste en montagne que le ratio fixe d'Open-Meteo (~0.7)
        // ============================================================
        // Note: wind_speed est encore en km/h ici, on convertit en m/s pour Roebber
        $wind_ms_for_slr = $wind_speed !== null ? $wind_speed / 3.6 : null;
        $roebber_slr = calculate_roebber_slr($temp, $humidity, $wind_ms_for_slr);
        $snowfall_roebber = 0;

        // Calculer la neige Roebber seulement si conditions de neige
        if ($precip > 0 && is_snow_conditions($temp, $dew)) {
            $snowfall_roebber = round(calculate_snowfall_from_slr($precip, $roebber_slr), 2);
        }

        // ============================================================
        // CORRECTION HYBRIDE : si Open-Meteo dit "pluie" mais que les
        // conditions locales indiquent de la neige, on corrige
        // ============================================================
        if ($rain > 0 && is_snow_conditions($temp, $dew)) {
            $snowfall += $rain;  // mm → cm (ratio ~1:10, simplifié 1:1 car neige humide)
            $rain = 0;
        }
        
        // UV index (préférer uv_index, fallback sur uv_index_clear_sky)
        $uv = get_model_value($hourly, 'uv_index', $i, $prio_hd);
        if ($uv === null) {
            $uv = get_model_value($hourly, 'uv_index_clear_sky', $i, $prio_hd);
        }

        // is_day
        $is_day = get_model_value($hourly, 'is_day', $i, $prio_hd);
        if ($is_day === null) {
            $hour = (int)substr($time, 11, 2);
            $is_day = ($hour >= 7 && $hour < 17);
        }
        
        // Symbol code basé sur les précipitations réelles ET le weather_code
        $symbol = determine_symbol($snowfall, $rain, $weather_code, (bool)$is_day);
        
        // Qualité de neige
        $snow_quality = get_snow_quality($snowfall, $temp, $dew);
        
        // Conversion vent km/h -> m/s
        $wind_speed_ms = $wind_speed !== null ? round($wind_speed / 3.6, 1) : null;
        $wind_gusts_ms = $wind_gusts !== null ? round($wind_gusts / 3.6, 1) : null;
        
        $enriched['time'][] = $time;
        $enriched['temperature'][] = $temp;
        $enriched['apparent_temperature'][] = $apparent;
        $enriched['dew_point'][] = $dew;
        $enriched['humidity'][] = $humidity;
        $enriched['wind_speed'][] = $wind_speed_ms;
        $enriched['wind_direction'][] = $wind_dir;
        $enriched['wind_gusts'][] = $wind_gusts_ms;
        $enriched['precipitation'][] = round($precip, 4);
        $enriched['rain'][] = $rain;
        $enriched['snowfall'][] = $snowfall;
        $enriched['snowfall_roebber'][] = $snowfall_roebber;
        $enriched['roebber_slr'][] = round($roebber_slr, 1);
        $enriched['precipitation_probability'][] = $precip_prob;
        $enriched['freezing_point'][] = $freezing_point;
        $enriched['freezing_point_corrected'][] = $freezing_corrected;
        $enriched['cloud_cover'][] = $cloud;
        $enriched['weather_code'][] = $weather_code;
        $enriched['symbol_code'][] = $symbol;
        $enriched['snow_quality'][] = $snow_quality;
        $enriched['uv_index'][] = $uv !== null ? round($uv, 1) : null;
        $enriched['is_day'][] = $is_day ? 1 : 0;
    }

    return $enriched;
}

/**
 * Agrège les données horaires en tranches de 6h
 * Pour les vues J+1, J+2
 */
function aggregate_hourly_to_6h($hourly) {
    if (!isset($hourly['time'])) return null;

    $six_hourly = [
        'time' => [],
        'temperature_min' => [],
        'temperature_max' => [],
        'wind_speed_max' => [],
        'wind_direction' => [],
        'precipitation' => [],
        'rain' => [],
        'snowfall' => [],
        'snowfall_roebber' => [],
        'precipitation_probability' => [],
        'freezing_point' => [],
        'freezing_point_corrected' => [],
        'weather_code' => [],
        'symbol_code' => [],
        'snow_quality' => [],
        'uv_index_max' => [],
        'cloud_cover' => []
    ];

    $count = count($hourly['time']);
    
    for ($i = 0; $i < $count; $i++) {
        $timestamp = $hourly['time'][$i];
        $hour = (int)substr($timestamp, 11, 2);
        
        if (!in_array($hour, [0, 6, 12, 18])) continue;
        
        // Accumulateurs pour la tranche de 6h
        $temps = [];
        $dew_points = [];
        $wind_speeds = [];
        $wind_dirs = [];
        $precip_sum = 0;
        $rain_sum = 0;
        $snowfall_sum = 0;
        $snowfall_roebber_sum = 0;
        $prob_max = 0;
        $uv_max = 0;
        $cloud_covers = [];
        $weather_codes = [];
        $freezing_points = [];
        $freezing_any_corrected = false;
        $is_day_dominant = ($hour >= 6 && $hour < 18);
        
        for ($j = 0; $j < 6 && ($i + $j) < $count; $j++) {
            $idx = $i + $j;
            
            if ($hourly['temperature'][$idx] !== null) {
                $temps[] = $hourly['temperature'][$idx];
            }
            if ($hourly['dew_point'][$idx] !== null) {
                $dew_points[] = $hourly['dew_point'][$idx];
            }
            if ($hourly['wind_speed'][$idx] !== null) {
                $wind_speeds[] = $hourly['wind_speed'][$idx];
            }
            if ($hourly['wind_direction'][$idx] !== null) {
                $wind_dirs[] = $hourly['wind_direction'][$idx];
            }
            
            $precip_sum += $hourly['precipitation'][$idx] ?? 0;
            $rain_sum += $hourly['rain'][$idx] ?? 0;
            $snowfall_sum += $hourly['snowfall'][$idx] ?? 0;
            $snowfall_roebber_sum += $hourly['snowfall_roebber'][$idx] ?? 0;
            $prob_max = max($prob_max, $hourly['precipitation_probability'][$idx] ?? 0);
            $uv_max = max($uv_max, $hourly['uv_index'][$idx] ?? 0);
            if (isset($hourly['cloud_cover'][$idx]) && $hourly['cloud_cover'][$idx] !== null) {
                $cloud_covers[] = $hourly['cloud_cover'][$idx];
            }

            // Collecter les freezing_point pour déterminer le dominant
            if (isset($hourly['freezing_point'][$idx]) && $hourly['freezing_point'][$idx] !== null) {
                $freezing_points[] = $hourly['freezing_point'][$idx];
                // Si une des valeurs est corrigée, on marque la tranche comme corrigée
                if (!empty($hourly['freezing_point_corrected'][$idx])) {
                    $freezing_any_corrected = true;
                }
            }
            
            // Collecter les weather_codes pour déterminer le dominant
            if (isset($hourly['weather_code'][$idx]) && $hourly['weather_code'][$idx] !== null) {
                $weather_codes[] = $hourly['weather_code'][$idx];
            }
        }

        // Déterminer le freezing_point moyen
        $average_freezing_point = null;
        if (!empty($freezing_points)) { 
            $avg_fpoint = array_sum($freezing_points) / count($freezing_points);
            $average_freezing_point = array_reduce(
                $freezing_points,
                function ($carry, $value) use ($avg_fpoint) {
                    return $carry === null ||
                           abs($value - $avg_fpoint) < abs($carry - $avg_fpoint)
                        ? $value
                        : $carry;
                },
                null
            );
        }
        
        // Déterminer le weather_code dominant (le plus élevé = plus sévère)
        $dominant_wmo = 0;
        if (!empty($weather_codes)) {
            $dominant_wmo = max($weather_codes);
        }
        
        // Déterminer l'icône basée sur les précipitations cumulées + weather_code dominant
        $symbol = determine_symbol($snowfall_sum, $rain_sum, $dominant_wmo, $is_day_dominant);
        
        // Si pas de précipitations, utiliser l'icône la plus fréquente de la tranche
        if ($snowfall_sum == 0 && $rain_sum == 0) {
            $symbol_counts = [];
            for ($j = 0; $j < 6 && ($i + $j) < $count; $j++) {
                $sym = $hourly['symbol_code'][$i + $j] ?? null;
                if ($sym !== null) {
                    $symbol_counts[$sym] = ($symbol_counts[$sym] ?? 0) + 1;
                }
            }
            if (!empty($symbol_counts)) {
                arsort($symbol_counts);
                $symbol = array_key_first($symbol_counts);
            }
        }
        
        // Qualité de neige pour la tranche (basée sur moyennes)
        $avg_temp = !empty($temps) ? array_sum($temps) / count($temps) : null;
        $avg_dew = !empty($dew_points) ? array_sum($dew_points) / count($dew_points) : null;
        $snow_quality = get_snow_quality($snowfall_sum, $avg_temp, $avg_dew);
        
        $six_hourly['time'][] = $timestamp;
        $six_hourly['temperature_min'][] = !empty($temps) ? round(min($temps), 1) : null;
        $six_hourly['temperature_max'][] = !empty($temps) ? round(max($temps), 1) : null;
        $six_hourly['wind_speed_max'][] = !empty($wind_speeds) ? round(max($wind_speeds), 1) : null;
        $six_hourly['wind_direction'][] = !empty($wind_dirs) ? round(array_sum($wind_dirs) / count($wind_dirs)) : null;
        $six_hourly['precipitation'][] = round($precip_sum, 4);
        $six_hourly['rain'][] = round($rain_sum, 4);
        $six_hourly['snowfall'][] = round($snowfall_sum, 4);
        $six_hourly['snowfall_roebber'][] = round($snowfall_roebber_sum, 2);
        $six_hourly['precipitation_probability'][] = $prob_max;
        $six_hourly['freezing_point'][] = $average_freezing_point;
        $six_hourly['freezing_point_corrected'][] = $freezing_any_corrected;
        $six_hourly['weather_code'][] = $dominant_wmo;
        $six_hourly['symbol_code'][] = $symbol;
        $six_hourly['snow_quality'][] = $snow_quality;
        $six_hourly['uv_index_max'][] = $uv_max > 0 ? round($uv_max, 1) : null;
        $six_hourly['cloud_cover'][] = !empty($cloud_covers) ? round(array_sum($cloud_covers) / count($cloud_covers)) : null;
    }

    return $six_hourly;
}

/**
 * Enrichit les données MET.no avec les mêmes calculs que Open-Meteo
 * Ajoute snow_quality et harmonise la déduction neige/pluie
 * Utilise la méthode Roebber pour le calcul du SLR
 */
function enrich_metno_timeseries(&$metno) {
    if (!isset($metno['properties']['timeseries'])) return;

    foreach ($metno['properties']['timeseries'] as &$entry) {
        $details = $entry['data']['instant']['details'] ?? null;
        if (!$details) continue;

        $temp = $details['air_temperature'] ?? null;
        $humidity = $details['relative_humidity'] ?? null;
        $wind_speed = $details['wind_speed'] ?? null;  // MET.no fournit le vent en m/s

        // MET.no fournit dew_point directement, sinon on le calcule
        $dew = $details['dew_point_temperature'] ?? calculate_dew_point($temp, $humidity);

        // Ajouter le dew_point aux details si calculé
        if ($dew !== null && !isset($details['dew_point_temperature'])) {
            $entry['data']['instant']['details']['dew_point_temperature'] = $dew;
        }

        // Calculer le SLR Roebber (temp, humidité, vent)
        $roebber_slr = calculate_roebber_slr($temp, $humidity, $wind_speed);

        // Enrichir next_1_hours
        if (isset($entry['data']['next_1_hours'])) {
            $precip = $entry['data']['next_1_hours']['details']['precipitation_amount'] ?? 0;

            // Déduire neige/pluie avec la même logique que Open-Meteo
            if ($precip > 0) {
                $is_snow = is_snow_conditions($temp, $dew);
                // Neige en cm avec Roebber (précip mm × SLR / 10)
                $snowfall_cm = $is_snow ? round(calculate_snowfall_from_slr($precip, $roebber_slr), 2) : 0;
                $entry['data']['next_1_hours']['details']['snowfall'] = $snowfall_cm;
                $entry['data']['next_1_hours']['details']['rain'] = $is_snow ? 0 : $precip;
                $entry['data']['next_1_hours']['details']['snow_quality'] = $is_snow
                    ? get_snow_quality($snowfall_cm, $temp, $dew)
                    : null;
            } else {
                $entry['data']['next_1_hours']['details']['snowfall'] = 0;
                $entry['data']['next_1_hours']['details']['rain'] = 0;
                $entry['data']['next_1_hours']['details']['snow_quality'] = null;
            }
        }

        // Enrichir next_6_hours
        if (isset($entry['data']['next_6_hours'])) {
            $precip = $entry['data']['next_6_hours']['details']['precipitation_amount'] ?? 0;

            if ($precip > 0) {
                $is_snow = is_snow_conditions($temp, $dew);
                // Neige en cm avec Roebber (précip mm × SLR / 10)
                $snowfall_cm = $is_snow ? round(calculate_snowfall_from_slr($precip, $roebber_slr), 2) : 0;
                $entry['data']['next_6_hours']['details']['snowfall'] = $snowfall_cm;
                $entry['data']['next_6_hours']['details']['rain'] = $is_snow ? 0 : $precip;
                $entry['data']['next_6_hours']['details']['snow_quality'] = $is_snow
                    ? get_snow_quality($snowfall_cm, $temp, $dew)
                    : null;
            } else {
                $entry['data']['next_6_hours']['details']['snowfall'] = 0;
                $entry['data']['next_6_hours']['details']['rain'] = 0;
                $entry['data']['next_6_hours']['details']['snow_quality'] = null;
            }
        }
    }
}

// ================= EXEC (séquentiel pour éviter saturation proxy) =================

// Appel MET.no
$ch_metno = get_curl_handle($url_metno, $proxy_host, $proxy_port, $proxy_user, $proxy_pass);
$res_metno_raw = curl_exec($ch_metno);
$res_metno = json_decode($res_metno_raw, true);
curl_close($ch_metno);

// Petit délai entre les deux APIs
usleep(100000); // 100ms

// Appel Open-Meteo
$ch_open = get_curl_handle($url_openmeteo, $proxy_host, $proxy_port, $proxy_user, $proxy_pass);
$res_open_raw = curl_exec($ch_open);
$res_open = json_decode($res_open_raw, true);
curl_close($ch_open);

// ================= ENRICHISSEMENT =================

// Enrichir MET.no avec snow/rain décomposés et snow_quality
if ($res_metno) {
    enrich_metno_timeseries($res_metno);
}

// ================= OUTPUT =================

// Récupérer l'elevation depuis Open-Meteo (utile pour le front)
$elevation = $res_open['elevation'] ?? null;

$aggregated = null;
$arome_aggregated = null;

if (isset($res_open['hourly'])) {
    // Agrégation Open-Meteo (best_match en priorité) - comportement par défaut
    $hourly_enriched = enrich_openmeteo_hourly($res_open, $elevation);
    $six_hourly_agg = aggregate_hourly_to_6h($hourly_enriched);

    $aggregated = [
        'hourly' => $hourly_enriched,
        'six_hourly' => $six_hourly_agg
    ];

    // Agrégation AROME (modèles Météo-France uniquement, sans best_match)
    // Chaîne : arome_hd → arome → seamless (pas de fallback meteoswiss)
    $arome_priorities = [
        'hd' => ['meteofrance_arome_france_hd', 'meteofrance_arome_france', 'meteofrance_seamless'],
        'decomp' => ['meteofrance_arome_france', 'meteofrance_seamless'],
        'prob' => ['meteofrance_seamless'],
        'freezing' => ['meteofrance_arome_france_hd', 'meteofrance_arome_france', 'meteofrance_seamless']
    ];
    $hourly_arome = enrich_openmeteo_hourly($res_open, $elevation, $arome_priorities);
    $six_hourly_arome = aggregate_hourly_to_6h($hourly_arome);

    $arome_aggregated = [
        'hourly' => $hourly_arome,
        'six_hourly' => $six_hourly_arome
    ];
}

// Merger les données MET.no avec le cache existant (garder l'historique)
$metno_merged = $res_metno;
if ($res_metno && file_exists($cache_file)) {
    $cached = json_decode(file_get_contents($cache_file), true);
    if ($cached && isset($cached['metno']['properties']['timeseries'])) {
        $cached_timeseries = $cached['metno']['properties']['timeseries'];
        $new_timeseries = $res_metno['properties']['timeseries'] ?? [];

        // Indexer les nouvelles données par time
        $new_by_time = [];
        foreach ($new_timeseries as $entry) {
            $new_by_time[$entry['time']] = $entry;
        }

        // Merger : garder les anciennes, écraser/ajouter les nouvelles
        $merged = [];
        foreach ($cached_timeseries as $entry) {
            $time = $entry['time'];
            // Si on a une nouvelle valeur pour ce time, utiliser la nouvelle
            if (isset($new_by_time[$time])) {
                $merged[$time] = $new_by_time[$time];
                unset($new_by_time[$time]);
            } else {
                $merged[$time] = $entry;
            }
        }
        // Ajouter les nouvelles entrées qui n'existaient pas
        foreach ($new_by_time as $time => $entry) {
            $merged[$time] = $entry;
        }

        // Trier par time et réindexer
        ksort($merged);

        // Nettoyer : supprimer les entrées antérieures à minuit (heure locale)
        $today_midnight = strtotime('today midnight');
        $merged = array_filter($merged, function($entry) use ($today_midnight) {
            $entry_time = strtotime($entry['time']);
            return $entry_time >= $today_midnight;
        });

        $metno_merged['properties']['timeseries'] = array_values($merged);
    }
}

$output = [
    'metno' => $metno_merged,
    'openmeteo' => $res_open,
    'openmeteo_aggregated' => $aggregated,
    'arome_aggregated' => $arome_aggregated,
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
                'description' => 'Météo-France AROME (modèles français uniquement)',
                'priority' => 'arome_hd → arome → seamless',
                'coverage' => '~4.5 jours (données null après)'
            ],
            'metno' => [
                'description' => 'MET.no Locationforecast (Institut météo norvégien)',
                'coverage' => '~10 jours'
            ]
        ],
        'slr_method' => 'Roebber simplifié (base 14, calibré Alpes) - facteurs: temp, humidity, wind',
        'snow_detection' => 'temp <= 1.5°C AND dew_point <= 0.5°C',
        'snow_quality' => 'wet if temp > -2°C AND dew_point > -3°C, else dry',
        'freezing_level_correction' => 'corrected=true when API value > elevation AND temp <= 0°C',
        'from_cache' => false
    ]
];

// Sauvegarder en cache
file_put_contents($cache_file, json_encode($output));

echo json_encode($output);