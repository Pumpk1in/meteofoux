<?php
/**
 * Génère tests/fixtures/openmeteo-winter.json à partir de la fixture estivale.
 *
 *   docker compose exec -T meteofoux php tests/make-winter-fixture.php
 *
 * Pourquoi : la fixture réelle a été capturée en août (10-25°C, zéro heure de
 * neige). Elle verrouille la plomberie de fusion, mais laisse non couvert tout
 * le code qui fait la valeur de l'app — SLR Roebber, classification neige/pluie,
 * correction hybride pluie→neige, icônes de neige, correction d'isotherme.
 *
 * On dérive donc une entrée hivernale déterministe du payload réel, et on fige
 * la sortie produite par le code courant. Le but n'est pas le réalisme
 * météorologique : c'est de traverser les branches "neige" et de les verrouiller
 * pour qu'un refactor futur ne puisse pas les changer en silence.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/../lib/weather.php';

$src = json_decode(file_get_contents(__DIR__ . '/fixtures/openmeteo-station.json'), true);
$raw = $src['openmeteo'];
$elevation = $src['elevation'];

// On ne garde que ce dont le pipeline Open-Meteo a besoin
unset($raw['daily']);

$hourly = &$raw['hourly'];
$count = count($hourly['time']);

foreach ($hourly as $key => &$values) {
    if ($key === 'time' || !is_array($values)) {
        continue;
    }

    // Températures et point de rosée : -25°C → conditions de neige franches
    if (str_starts_with($key, 'temperature_2m')
        || str_starts_with($key, 'dew_point_2m')
        || str_starts_with($key, 'apparent_temperature')) {
        foreach ($values as $i => $v) {
            $values[$i] = $v === null ? null : round($v - 25, 1);
        }
        continue;
    }

    // Isotherme 0°C sous l'altitude de la station (1794m), avec quelques valeurs
    // incohérentes volontaires pour traverser correct_freezing_level()
    if (str_starts_with($key, 'freezing_level_height')) {
        foreach ($values as $i => $v) {
            $values[$i] = $v === null ? null : ($i % 12 === 0 ? 2600 : 1200);
        }
        continue;
    }

    // Précipitations : une heure sur trois, intensité croissante puis remise à zéro.
    // rain/snowfall restent à 0 → exerce le fallback de décomposition ET la
    // correction d'incohérence weather_code vs précipitations.
    if (str_starts_with($key, 'precipitation') && !str_starts_with($key, 'precipitation_probability')) {
        foreach ($values as $i => $v) {
            $values[$i] = $i % 3 === 0 ? round(($i % 30) / 10 + 0.2, 1) : 0.0;
        }
        continue;
    }
}
unset($values);

$out = [
    'openmeteo' => $raw,
    'elevation' => $elevation,
];
$h = enrich_openmeteo_hourly($raw, $elevation);
$out['openmeteo_aggregated'] = ['hourly' => $h, 'six_hourly' => aggregate_hourly_to_6h($h)];
$ha = enrich_openmeteo_hourly($raw, $elevation, arome_priorities());
$out['arome_aggregated'] = ['hourly' => $ha, 'six_hourly' => aggregate_hourly_to_6h($ha)];

file_put_contents(__DIR__ . '/fixtures/openmeteo-winter.json', json_encode($out));

// Résumé : sans heures de neige, la fixture ne servirait à rien
foreach ([['best_match', $h], ['AROME', $ha]] as [$nom, $data]) {
    $slr = array_values(array_unique(array_filter($data['roebber_slr'], fn($v) => $v !== null)));
    sort($slr);
    $neige = count(array_filter($data['snowfall_roebber'], fn($v) => $v > 0));
    $icones = array_values(array_unique(array_filter($data['symbol_code'], fn($s) => str_contains((string)$s, 'snow'))));
    printf(
        "%-11s | SLR distincts: %2d (%s) | heures de neige: %3d/%d | icones neige: %d\n",
        $nom, count($slr), implode(',', array_slice($slr, 0, 5)), $neige, $count, count($icones)
    );
}
