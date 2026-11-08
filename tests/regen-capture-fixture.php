<?php
/**
 * Recalcule les sorties attendues d'une fixture capturée depuis le proxy
 * (la clé forecasts) avec le code courant.
 *
 *   docker compose exec -T meteofoux php tests/regen-capture-fixture.php observatoire
 *
 * À n'utiliser qu'après un changement de comportement VOULU, et après avoir inspecté
 * le diff : régénérer pour faire passer une suite rouge lui retire toute utilité.
 * Les données brutes (openmeteo, metno) ne sont pas modifiées.
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

// Sortie attendue du pipeline commun, pour toutes les sources (golden-master de "forecasts").
// Les clés d'avant le format commun ne sont plus produites.
unset($fixture['openmeteo_aggregated'], $fixture['arome_aggregated']);
$fixture['forecasts'] = build_forecasts($raw, $fixture['metno'] ?? null, $elevation);

file_put_contents($path, json_encode($fixture));
echo "ok : $path\n";
