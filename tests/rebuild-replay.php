<?php
/**
 * Recalcule la clé "forecasts" d'une réponse du proxy avec le code courant (stdin → stdout).
 *
 * Sert à vérifier dans l'interface un changement de lib/weather.php : les réponses rejouées par
 * tests/ui-snapshot.js contiennent le "forecasts" calculé par le code de l'époque.
 *
 *   for f in <replay>/*.json; do
 *     docker compose exec -T meteofoux php tests/rebuild-replay.php < "$f" > "<replay_apres>/$(basename "$f")"
 *   done
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('CLI only');
}

require_once __DIR__ . '/../lib/weather.php';

$response = json_decode(stream_get_contents(STDIN), true);
$response['forecasts'] = build_forecasts($response['openmeteo'] ?? null, $response['metno'] ?? null, $response['elevation'] ?? null);
echo json_encode($response);
