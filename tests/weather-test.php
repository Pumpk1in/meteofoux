<?php
/**
 * Tests de lib/weather.php
 *
 *   docker compose exec -T meteofoux php tests/weather-test.php
 *
 * Deux niveaux :
 * 1. Golden-master — rejoue le pipeline sur un payload Open-Meteo réel et exige
 *    l'égalité stricte avec l'agrégat produit par la version de référence.
 *    C'est ce test qui garantit qu'un refactor ne change pas le comportement.
 * 2. Assertions unitaires — cas limites que des données réelles ne couvrent pas.
 */

// Ce fichier ne doit jamais être exécutable depuis le web une fois déployé.
// (un .htaccess ne suffirait pas : AllowOverride vaut None dans php:8.3-apache)
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/../lib/weather.php';

// ================= HARNAIS =================

$passed = 0;
$failed = 0;

function check($label, $actual, $expected) {
    global $passed, $failed;
    if ($actual === $expected) {
        $passed++;
        return;
    }
    $failed++;
    echo "  ECHEC  $label\n";
    echo "         attendu : " . json_encode($expected) . "\n";
    echo "         obtenu  : " . json_encode($actual) . "\n";
}

/** Compare deux structures et pointe la première divergence (sinon illisible sur 216 entrées) */
function check_deep($label, $actual, $expected) {
    global $passed, $failed;
    if (json_encode($actual) === json_encode($expected)) {
        $passed++;
        return;
    }
    $failed++;
    echo "  ECHEC  $label\n";
    $diff = first_difference($expected, $actual, '');
    echo "         premiere divergence : " . ($diff ?? '(structure globale)') . "\n";
}

function first_difference($expected, $actual, $path) {
    if (!is_array($expected) || !is_array($actual)) {
        return json_encode($expected) === json_encode($actual)
            ? null
            : "$path : attendu " . json_encode($expected) . ", obtenu " . json_encode($actual);
    }
    foreach ($expected as $k => $v) {
        if (!array_key_exists($k, $actual)) {
            return "$path/$k : clé absente du résultat";
        }
        $sub = first_difference($v, $actual[$k], "$path/$k");
        if ($sub !== null) {
            return $sub;
        }
    }
    foreach ($actual as $k => $v) {
        if (!array_key_exists($k, $expected)) {
            return "$path/$k : clé en trop dans le résultat";
        }
    }
    return null;
}

function section($title) {
    echo "\n$title\n";
}

// ================= 1. GOLDEN-MASTER =================

// Trois jeux de données :
// - station : capture réelle du proxy (aout, 10-25°C). Verrouille la fusion
//   multi-modèles sur données de production, mais ne traverse aucune branche neige.
// - winter  : dérivée déterministe de la précédente (voir make-winter-fixture.php).
//   72/216 heures de neige, 90 valeurs de SLR distinctes : c'est elle qui couvre
//   Roebber, la classification neige/pluie et les icônes de neige.
// - observatoire : capture réelle du proxy (8 novembre 2026, 2590 m). Vraie neige,
//   températures autour de 0°C : couvre les cas limites pluie/neige réels.
$fixtures = [
    'station' => 'donnees reelles, aout',
    'winter' => 'derivee hivernale',
    'observatoire' => 'donnees reelles, novembre, 2590 m',
];

foreach ($fixtures as $name => $desc) {
    section("Golden-master : $name ($desc)");

    $path = __DIR__ . "/fixtures/openmeteo-$name.json";
    $fixture = json_decode(@file_get_contents($path), true);

    if (!$fixture || !isset($fixture['openmeteo']['hourly'])) {
        echo "  ECHEC  fixture illisible : $path\n";
        $failed++;
        continue;
    }

    $raw = $fixture['openmeteo'];
    $elevation = $fixture['elevation'];

    // Chaîne par défaut (best_match) → doit reproduire openmeteo_aggregated
    $hourly = enrich_openmeteo_hourly($raw, $elevation);
    check_deep("[$name] enrich_openmeteo_hourly (best_match)", $hourly, $fixture['openmeteo_aggregated']['hourly']);
    check_deep("[$name] aggregate_hourly_to_6h (best_match)", aggregate_hourly_to_6h($hourly), $fixture['openmeteo_aggregated']['six_hourly']);

    // Chaîne AROME → doit reproduire arome_aggregated
    $hourly_arome = enrich_openmeteo_hourly($raw, $elevation, arome_priorities());
    check_deep("[$name] enrich_openmeteo_hourly (AROME)", $hourly_arome, $fixture['arome_aggregated']['hourly']);
    check_deep("[$name] aggregate_hourly_to_6h (AROME)", aggregate_hourly_to_6h($hourly_arome), $fixture['arome_aggregated']['six_hourly']);

    // L'enrichissement MET.no est idempotent : il recalcule depuis instant.details
    // et precipitation_amount, que l'enrichissement ne modifie pas.
    if (isset($fixture['metno'])) {
        $metno = $fixture['metno'];
        $before = json_encode($metno);
        enrich_metno_timeseries($metno);
        check("[$name] enrich_metno_timeseries idempotent", json_encode($metno), $before);
    }
}

// ================= 2. ASSERTIONS UNITAIRES =================

section('calculate_dew_point');
check('20C / 50%', calculate_dew_point(20, 50), 9.3);
check('0C / 100%', calculate_dew_point(0, 100), 0.0);
check('temp null', calculate_dew_point(null, 80), null);
check('humidite nulle', calculate_dew_point(10, 0), null);

section('is_snow_conditions (seuils 1.5C / 0.5C)');
check('sous les deux seuils', is_snow_conditions(0, -1), true);
check('pile sur les seuils', is_snow_conditions(1.5, 0.5), true);
check('temp au-dessus', is_snow_conditions(1.6, 0.5), false);
check('dew point au-dessus', is_snow_conditions(1.5, 0.6), false);
check('temp null', is_snow_conditions(null, -5), false);
check('dew point null tolere', is_snow_conditions(0, null), true);

section('get_snow_quality (seuils -2C / -3C)');
check('froid = seche', get_snow_quality(5, -5, -8), 'dry');
check('doux = humide', get_snow_quality(5, 0, 0), 'wet');
check('pile sur temp', get_snow_quality(5, -2, 0), 'dry');
check('pile sur dew point', get_snow_quality(5, 0, -3), 'dry');
check('pas de neige', get_snow_quality(0, -5, -8), null);
check('temp null', get_snow_quality(5, null, -8), null);

section('calculate_roebber_slr (base 14, borne 5-25)');
check('temp null = base', calculate_roebber_slr(null), ROEBBER_BASE_SLR);
check('borne haute', calculate_roebber_slr(-40, 20, 0), SLR_MAX);
check('borne basse', calculate_roebber_slr(15, 100, 30), SLR_MIN);
$slr_calme = calculate_roebber_slr(-10, 75, 0);
$slr_vente = calculate_roebber_slr(-10, 75, 10);
check('vent > 3 m/s compacte', $slr_vente < $slr_calme, true);
$slr_sec = calculate_roebber_slr(-10, 60, 0);
$slr_humide = calculate_roebber_slr(-10, 95, 0);
check('humidite haute densifie', $slr_humide < $slr_sec, true);
$slr_froid = calculate_roebber_slr(-15, 75, 0);
check('plus froid = plus leger', $slr_froid > $slr_calme, true);

section('calculate_snowfall_from_slr');
check('10mm x 15 = 15cm', calculate_snowfall_from_slr(10, 15), 15.0);
check('0mm', calculate_snowfall_from_slr(0, 15), 0.0);

section('classify_precipitation');
$c = classify_precipitation(0, -5, -8, 80, 2);
check('precip nulle : snowfall', $c['snowfall'], 0);
check('precip nulle : rain', $c['rain'], 0);
check('precip nulle : qualite', $c['snow_quality'], null);
$c = classify_precipitation(5, -5, -8, 80, 2);
check('conditions neige : rain a 0', $c['rain'], 0);
check('conditions neige : snowfall', $c['snowfall'], 5);
check('conditions neige : qualite seche', $c['snow_quality'], 'dry');
check('conditions neige : roebber > 0', $c['snowfall_roebber'] > 0, true);
$c = classify_precipitation(5, 10, 8, 80, 2);
check('conditions pluie : rain', $c['rain'], 5);
check('conditions pluie : snowfall a 0', $c['snowfall'], 0);
check('conditions pluie : roebber a 0', $c['snowfall_roebber'], 0);

section('correct_freezing_level (4 branches)');
// Note : correct_freezing_level renvoie round(), donc un float — d'ou les 1500.0
$r = correct_freezing_level(1500, null, -3, 1794);
check('coherent (iso < altitude) : valeur', $r['value'], 1500.0);
check('coherent : non corrige', $r['corrected'], false);
check('coherent : source', $r['source'], 'best_match');
$r = correct_freezing_level(2500, null, 5, 1794);
check('temp positive = coherent', $r['source'], 'best_match');
$r = correct_freezing_level(2500, 1200, -3, 1794);
check('incoherent -> meteoswiss : valeur', $r['value'], 1200.0);
check('incoherent -> meteoswiss : source', $r['source'], 'meteoswiss');
$r = correct_freezing_level(2500, 2400, -3, 1794);
check('les deux incoherents : valeur = altitude', $r['value'], 1794.0);
check('les deux incoherents : corrige', $r['corrected'], true);
check('les deux incoherents : source', $r['source'], 'elevation');
// best_match suspect : -10C mais iso a moins de 500m sous la station
$r = correct_freezing_level(1500, 800, -10, 1794);
check('best_match suspect -> meteoswiss', $r['source'], 'meteoswiss');
check('best_match suspect : valeur', $r['value'], 800.0);
$r = correct_freezing_level(1500, null, -3, null);
check('elevation inconnue', $r['source'], 'best_match');

section('resolve_precip_icon');
check('neige simple jour', resolve_precip_icon('snow', false, false, true, '_day'), 'snow');
check('neige averse jour', resolve_precip_icon('snow', true, false, true, '_day'), 'snowshowers_day');
check('neige nuit (repli showers)', resolve_precip_icon('snow', false, false, false, '_night'), 'snowshowers_night');
check('heavysnow nuit (pas de repli)', resolve_precip_icon('heavysnow', false, false, false, '_night'), 'heavysnow');
check('pluie orage', resolve_precip_icon('rain', false, true, true, '_day'), 'rainandthunder');
check('pluie averse + orage', resolve_precip_icon('rain', true, true, true, '_day'), 'rainshowersandthunder');
// Typos assumees de MET.no (double 's' apres "light")
check('typo lightssleet...', resolve_precip_icon('lightsleet', true, true, true, '_day'), 'lightssleetshowersandthunder');
check('typo lightssnow...', resolve_precip_icon('lightsnow', true, true, true, '_day'), 'lightssnowshowersandthunder');

section('determine_symbol');
check('WMO 56 (bruine verglacante)', determine_symbol(0, 0, 56, true), 'lightsleet');
check('WMO 67 (pluie verglacante forte)', determine_symbol(0, 0, 67, true), 'heavysleet');
check('pluie + neige = sleet', determine_symbol(1, 2, 0, true), 'heavysleet');
check('neige legere', determine_symbol(0.5, 0, 0, true), 'lightsnow');
check('neige normale', determine_symbol(1.5, 0, 0, true), 'snow');
check('neige forte', determine_symbol(3, 0, 0, true), 'heavysnow');
check('pluie legere', determine_symbol(0, 1, 0, true), 'lightrain');
check('pluie normale', determine_symbol(0, 5, 0, true), 'rain');
check('pluie forte', determine_symbol(0, 10, 0, true), 'heavyrain');
check('ciel clair jour', determine_symbol(0, 0, 0, true), 'clearsky_day');
check('ciel clair nuit', determine_symbol(0, 0, 0, false), 'clearsky_night');
check('peu nuageux', determine_symbol(0, 0, 1, true), 'fair_day');
check('partiellement nuageux', determine_symbol(0, 0, 2, true), 'partlycloudy_day');
check('couvert (sans variante)', determine_symbol(0, 0, 3, true), 'cloudy');
check('brouillard', determine_symbol(0, 0, 45, true), 'fog');
check('WMO 95 sans precip', determine_symbol(0, 0, 95, true), 'rainandthunder');
check('code WMO null', determine_symbol(0, 0, null, true), 'clearsky_day');

section('get_model_value (chaine de priorites)');
$data = [
    'temp_a' => [null, 1],
    'temp_b' => [2, null],
    'temp'   => [3, 3],
];
check('saute le null, prend le suivant', get_model_value($data, 'temp', 0, ['a', 'b']), 2);
check('respecte l ordre', get_model_value($data, 'temp', 1, ['a', 'b']), 1);
check('repli sur cle non suffixee', get_model_value($data, 'temp', 0, ['inconnu']), 3);
check('cle totalement absente', get_model_value($data, 'vent', 0, ['a']), null);

section('merge_metno_timeseries');
$cutoff = strtotime('2026-02-10T00:00:00Z');
$cached = [
    ['time' => '2026-02-09T22:00:00Z', 'v' => 'vieux'],
    ['time' => '2026-02-10T06:00:00Z', 'v' => 'cache'],
    ['time' => '2026-02-10T12:00:00Z', 'v' => 'cache'],
];
$new = [
    ['time' => '2026-02-10T12:00:00Z', 'v' => 'frais'],
    ['time' => '2026-02-10T18:00:00Z', 'v' => 'frais'],
];
$m = merge_metno_timeseries($cached, $new, $cutoff);
check('purge sous le seuil', count($m), 3);
check('tri chronologique', array_column($m, 'time'), [
    '2026-02-10T06:00:00Z', '2026-02-10T12:00:00Z', '2026-02-10T18:00:00Z'
]);
check('entree conservee du cache', $m[0]['v'], 'cache');
check('nouvelle valeur ecrase l ancienne', $m[1]['v'], 'frais');
check('nouvelle entree ajoutee', $m[2]['v'], 'frais');
check('reindexation', array_keys($m), [0, 1, 2]);
$m = merge_metno_timeseries([], $new, $cutoff);
check('cache vide', count($m), 2);

// ================= RESULTAT =================

echo "\n" . str_repeat('-', 46) . "\n";
echo sprintf("%d reussis, %d echecs\n", $passed, $failed);
exit($failed > 0 ? 1 : 0);
