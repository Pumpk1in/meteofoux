<?php
// Cache-busting automatique : l'URL des assets change dès que le fichier change.
// Aucun numéro de version à maintenir à la main (ni ici, ni dans sw.js).
$v = fn($f) => '?v=' . filemtime(__DIR__ . '/' . $f);
?>
<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#0f172a">
    <link rel="icon" type="image/png" sizes="512x512" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/favicon.png">
    <link rel="manifest" href="/manifest.json">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Meteo 7 jours - La Foux d'Allos et +</title>
    <link rel="stylesheet" href="style.css<?= $v('style.css') ?>">
    <script src="https://unpkg.com/lucide@latest"></script>
    <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
</head>
<body>

<!-- Barre fixe en haut : point choisi (ouvre la feuille des points) + date, rafraîchir, thème -->
<header class="top-bar">
    <div class="top-bar-left">
        <h1 class="point-title-heading">
            <button class="point-title" id="point-title" onclick="App.openPointSheet()" aria-haspopup="dialog" aria-expanded="false">
                <span class="point-title-name">
                    <span class="point-dot" id="point-title-dot"></span>
                    <span id="point-title-text">MeteoFoux</span>
                    <i data-lucide="chevron-down"></i>
                </span>
                <span class="point-title-date" id="current-date"></span>
            </button>
        </h1>
    </div>
    <div class="top-bar-right">
        <button class="refresh-btn" id="refresh-btn" onclick="App.refreshData()" title="Rafraîchir les données">
            <i data-lucide="refresh-cw"></i>
        </button>
        <button class="theme-toggle" onclick="App.toggleTheme()" title="Changer le thème">
            <i data-lucide="sun" class="icon-light"></i>
            <i data-lucide="moon" class="icon-dark"></i>
        </button>
    </div>
</header>

<!-- Contenu principal -->
<main id="content">
    <!-- Skeleton loader initial (remplacé par JS) -->
    <div class="skeleton-loader">
        <div class="skeleton-text">
            <i data-lucide="loader-2" class="lucide lucide-spin"></i>
            <span>Chargement des prévisions...</span>
        </div>
        <div class="skeleton-section">
            <div class="skeleton-summary">
                <div class="skeleton-summary-item skeleton" style="width: 80px"></div>
                <div class="skeleton-summary-item skeleton" style="width: 70px"></div>
                <div class="skeleton-summary-item skeleton" style="width: 75px"></div>
                <div class="skeleton-summary-item skeleton" style="width: 65px"></div>
            </div>
            <div class="skeleton-chart">
                <div class="skeleton-bar skeleton" style="height: 40%"></div>
                <div class="skeleton-bar skeleton" style="height: 65%"></div>
                <div class="skeleton-bar skeleton" style="height: 55%"></div>
                <div class="skeleton-bar skeleton" style="height: 80%"></div>
                <div class="skeleton-bar skeleton" style="height: 70%"></div>
                <div class="skeleton-bar skeleton" style="height: 50%"></div>
                <div class="skeleton-bar skeleton" style="height: 75%"></div>
                <div class="skeleton-bar skeleton" style="height: 60%"></div>
                <div class="skeleton-bar skeleton" style="height: 45%"></div>
                <div class="skeleton-bar skeleton" style="height: 70%"></div>
                <div class="skeleton-bar skeleton" style="height: 85%"></div>
                <div class="skeleton-bar skeleton" style="height: 55%"></div>
                <div class="skeleton-bar skeleton" style="height: 40%"></div>
                <div class="skeleton-bar skeleton" style="height: 60%"></div>
                <div class="skeleton-bar skeleton" style="height: 75%"></div>
                <div class="skeleton-bar skeleton" style="height: 50%"></div>
                <div class="skeleton-bar skeleton" style="height: 65%"></div>
                <div class="skeleton-bar skeleton" style="height: 45%"></div>
                <div class="skeleton-bar skeleton" style="height: 55%"></div>
                <div class="skeleton-bar skeleton" style="height: 70%"></div>
                <div class="skeleton-bar skeleton" style="height: 60%"></div>
                <div class="skeleton-bar skeleton" style="height: 50%"></div>
                <div class="skeleton-bar skeleton" style="height: 65%"></div>
                <div class="skeleton-bar skeleton" style="height: 45%"></div>
            </div>
            <div class="skeleton-cards">
                <div class="skeleton-card">
                    <div class="skeleton-time skeleton"></div>
                    <div class="skeleton-icon skeleton"></div>
                    <div class="skeleton-temp skeleton"></div>
                    <div class="skeleton-data">
                        <div class="skeleton-line skeleton" style="width: 85%"></div>
                        <div class="skeleton-line skeleton" style="width: 65%"></div>
                    </div>
                </div>
                <div class="skeleton-card">
                    <div class="skeleton-time skeleton"></div>
                    <div class="skeleton-icon skeleton"></div>
                    <div class="skeleton-temp skeleton"></div>
                    <div class="skeleton-data">
                        <div class="skeleton-line skeleton" style="width: 85%"></div>
                        <div class="skeleton-line skeleton" style="width: 65%"></div>
                    </div>
                </div>
                <div class="skeleton-card">
                    <div class="skeleton-time skeleton"></div>
                    <div class="skeleton-icon skeleton"></div>
                    <div class="skeleton-temp skeleton"></div>
                    <div class="skeleton-data">
                        <div class="skeleton-line skeleton" style="width: 85%"></div>
                        <div class="skeleton-line skeleton" style="width: 65%"></div>
                    </div>
                </div>
                <div class="skeleton-card">
                    <div class="skeleton-time skeleton"></div>
                    <div class="skeleton-icon skeleton"></div>
                    <div class="skeleton-temp skeleton"></div>
                    <div class="skeleton-data">
                        <div class="skeleton-line skeleton" style="width: 85%"></div>
                        <div class="skeleton-line skeleton" style="width: 65%"></div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</main>

<!-- Barre de navigation en bas (mobile) / en haut du contenu (desktop) -->
<nav class="bottom-nav">
    <div class="day-nav" id="day-nav">
        <!-- Navigation jours générée dynamiquement -->
    </div>
</nav>

<footer>
    <div><strong>Sources</strong> :<br> Open-Meteo · AROME/ARPEGE Météo-France · MET Norway</div>
    <details>
        <summary>Comment sont calculées les prévisions ?</summary>
        <p><strong>3 sources disponibles</strong> (toggle en haut à droite) :</p>
        <ul>
            <li><strong>Open-Meteo</strong> : Fusion multi-modèles "best_match" optimisée, 7 jours. Priorité : best_match → AROME HD → Seamless.</li>
            <li><strong>AROME</strong> : Modèles Météo-France uniquement (sans best_match), ~4-5 jours. Priorité : AROME HD (1.5km) → AROME (2.5km) → ARPEGE → Seamless.</li>
            <li><strong>MET.no</strong> : Institut météorologique norvégien, ~10 jours.</li>
        </ul>
        <p><strong>Cohérence</strong> : Si le code météo indique des précipitations sans données associées, fallback automatique sur AROME. Si le code indique ciel clair mais couverture nuageuse ≥ 80%, l'icône est corrigée vers "couvert".</p>
        <p><strong>Calcul de la neige</strong> : Méthode Roebber avec ratio neige/eau dynamique (base 14:1), calibrée pour les Alpes. Le ratio est ajusté selon : température (plus froid = neige plus légère), humidité (>90% = neige plus dense), vent (>3 m/s = compaction). La valeur retenue est le maximum entre Open-Meteo et Roebber.</p>
        <p><strong>Qualité de neige</strong> : "Sèche" si température ≤ -2°C ou point de rosée ≤ -3°C, "humide" sinon.</p>
        <p><strong>Classification neige/pluie</strong> : Les précipitations sont classées comme neige si température ≤ 1.5°C ET point de rosée ≤ 0.5°C.</p>
        <p><strong>Nébulosité</strong> : Pour la source AROME, la couverture nuageuse utilise le modèle ARPEGE en priorité. AROME HD ne fournit pas cette donnée, et AROME standard semble moins précis qu'ARPEGE comparé aux observations sur place.</p>
        <p><strong>Isotherme 0°C</strong> : Corrigé automatiquement via MeteoSwiss lorsqu'une inversion thermique est détectée (température négative mais isotherme au-dessus de l'altitude).</p>
        <p><strong>Points de mesure</strong> : Station (1794m), Vescal (2050m), Observatoire (2600m) — coordonnées GPS spécifiques à La Foux d'Allos.</p>
    </details>
</footer>

<!-- Scripts JS séparés -->
<script src="js/core.js<?= $v('js/core.js') ?>"></script>
<script src="js/ui.js<?= $v('js/ui.js') ?>"></script>

<script>
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js');
        });
    }
</script>

</body>
</html>
