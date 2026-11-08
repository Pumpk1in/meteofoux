<?php
/**
 * Recalcule les sorties attendues d'une fixture capturée depuis le proxy
 * (openmeteo_aggregated, arome_aggregated, enrichissement MET.no, forecasts) avec le code courant.
 *
 *   docker compose exec -T meteofoux php tests/regen-capture-fixture.php observatoire
 *
 * À n'utiliser qu'après un changement de comportement VOULU, et après avoir inspecté
 * le diff : régénérer pour faire passer une suite rouge lui retire toute utilité.
 * Les données brutes (openmeteo, metno avant enrichissement) ne sont pas modifiées.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/../lib/weather.php';

$name = $argv[1] ?? '';
$path = __DIR__ . "/fixtures/openmeteo-$name.json";
$fixture = json_decode(@file_get_contents($path), true);

if (!$fixture || !isset($fixture['openmeteo']['hourly'])) {
    fwrite(STDERR, "fixture illisible : $path\n");
    exit(1);
}

$raw = $fixture['openmeteo'];
$elevation = $fixture['elevation'];

$h = enrich_openmeteo_hourly($raw, $elevation);
$fixture['openmeteo_aggregated'] = ['hourly' => $h, 'six_hourly' => aggregate_hourly_to_6h($h)];
$ha = enrich_openmeteo_hourly($raw, $elevation, arome_priorities());
$fixture['arome_aggregated'] = ['hourly' => $ha, 'six_hourly' => aggregate_hourly_to_6h($ha)];

if (isset($fixture['metno'])) {
    enrich_metno_timeseries($fixture['metno']);
}

// Sortie attendue du pipeline commun, pour toutes les sources (golden-master de "forecasts")
$fixture['forecasts'] = build_forecasts($raw, $fixture['metno'] ?? null, $elevation);

file_put_contents($path, json_encode($fixture));
echo "ok : $path\n";
