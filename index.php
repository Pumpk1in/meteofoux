<?php
// Cache-busting automatique : l'URL des assets change dès que le fichier change.
// Aucun numéro de version à maintenir à la main (ni ici, ni dans sw.js).
$v = fn($f) => '?v=' . filemtime(__DIR__ . '/' . $f);
?>
<!DOCTYPE html>
<html lang="fr" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#020617">
    <link rel="icon" type="image/png" sizes="512x512" href="/favicon.png" />
    <link rel="apple-touch-icon" href="/favicon.png">
    <link rel="manifest" href="/manifest.json">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>Meteo 7 jours - La Foux d'Allos et +</title>
    <!-- Les deux graisses de l'écran d'ouverture : sans elles, le texte s'affiche d'abord en police système -->
    <link rel="preload" href="fonts/fira-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="fonts/fira-sans-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="style.css<?= $v('style.css') ?>">
    <!-- Versions épinglées : une nouvelle version publiée en amont ne change pas l'interface en douce -->
    <script src="https://unpkg.com/lucide@1.61.0/dist/umd/lucide.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/apexcharts@8.5.0/dist/apexcharts.min.js"></script>
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
        <button class="refresh-btn" id="refresh-btn" onclick="App.refreshData()" aria-label="Rafraîchir les prévisions">
            <i data-lucide="refresh-cw"></i>
        </button>
        <button class="theme-toggle" onclick="App.toggleTheme()" aria-label="Thème clair ou sombre">
            <i data-lucide="sun" class="icon-light"></i>
            <i data-lucide="moon" class="icon-dark"></i>
        </button>
    </div>
</header>

<!-- Contenu principal -->
<main id="content" aria-busy="true">
    <?php readfile(__DIR__ . '/partials/skeleton.html'); ?>
</main>

<!-- Le même squelette, repris par App.showSkeleton() (rafraîchissement, point pas encore chargé) -->
<template id="skeleton-template"><?php readfile(__DIR__ . '/partials/skeleton.html'); ?></template>

<!-- Barre de navigation en bas (mobile) / en haut du contenu (desktop) -->
<nav class="bottom-nav">
    <div class="day-nav" id="day-nav">
        <!-- 7 jours en attente, remplacés par App.renderDayNav() -->
        <div class="day-btn is-skeleton" aria-hidden="true"><span class="skeleton sk" style="width: 1.6rem"></span><span class="skeleton sk sk-micro" style="width: 2.2rem"></span><span class="skeleton sk sk-micro sk-mobile" style="width: 1rem"></span></div>
        <div class="day-btn is-skeleton" aria-hidden="true"><span class="skeleton sk" style="width: 1.6rem"></span><span class="skeleton sk sk-micro" style="width: 2.2rem"></span><span class="skeleton sk sk-micro sk-mobile" style="width: 1rem"></span></div>
        <div class="day-btn is-skeleton" aria-hidden="true"><span class="skeleton sk" style="width: 1.6rem"></span><span class="skeleton sk sk-micro" style="width: 2.2rem"></span><span class="skeleton sk sk-micro sk-mobile" style="width: 1rem"></span></div>
        <div class="day-btn is-skeleton" aria-hidden="true"><span class="skeleton sk" style="width: 1.6rem"></span><span class="skeleton sk sk-micro" style="width: 2.2rem"></span><span class="skeleton sk sk-micro sk-mobile" style="width: 1rem"></span></div>
        <div class="day-btn is-skeleton" aria-hidden="true"><span class="skeleton sk" style="width: 1.6rem"></span><span class="skeleton sk sk-micro" style="width: 2.2rem"></span><span class="skeleton sk sk-micro sk-mobile" style="width: 1rem"></span></div>
        <div class="day-btn is-skeleton" aria-hidden="true"><span class="skeleton sk" style="width: 1.6rem"></span><span class="skeleton sk sk-micro" style="width: 2.2rem"></span><span class="skeleton sk sk-micro sk-mobile" style="width: 1rem"></span></div>
        <div class="day-btn is-skeleton" aria-hidden="true"><span class="skeleton sk" style="width: 1.6rem"></span><span class="skeleton sk sk-micro" style="width: 2.2rem"></span><span class="skeleton sk sk-micro sk-mobile" style="width: 1rem"></span></div>
    </div>
</nav>

<footer>
    <div><strong>Sources</strong> :<br> Open-Meteo · AROME/ARPEGE Météo-France · MET Norway</div>
    <details>
        <summary>Comment sont calculées les prévisions ?</summary>
        <p><strong>3 sources</strong>, comparées dans le bloc en tête de chaque jour. Touchez la case d'un modèle pour voir ses heures :</p>
        <ul>
            <li><strong>Open-Meteo</strong> : fusion multi-modèles "best_match", 7 jours. Priorité : best_match → AROME HD → Seamless.</li>
            <li><strong>AROME / ARPEGE</strong> : modèles Météo-France uniquement (sans best_match). AROME HD (1,5 km) puis AROME (2,5 km) sur environ 2 jours, puis ARPEGE jusqu'à J+4. La case affiche le modèle réellement utilisé ce jour-là.</li>
            <li><strong>MET.no</strong> : institut météorologique norvégien. Heure par heure sur environ 2 jours, puis toutes les 6 h.</li>
        </ul>
        <p><strong>Accord des modèles</strong> : ils divergent quand l'écart dépasse 2 cm de neige (3 mm de pluie) et que le plus fort vaut au moins 1,5 fois le plus faible. Une source qui ne couvre qu'une partie de la journée n'entre pas dans la fourchette.</p>
        <p><strong>Cohérence</strong> : si le code météo indique des précipitations sans données associées, repli automatique sur AROME. Si le code indique un ciel clair mais une couverture nuageuse ≥ 80 %, l'icône est corrigée vers "couvert".</p>
        <p><strong>Neige ou pluie</strong> : neige si la température humide (calculée à partir de la température et du point de rosée) est ≤ 1 °C. La même règle s'applique aux trois sources ; leur propre partage pluie/neige est ignoré.</p>
        <p><strong>Quantité de neige</strong> : méthode Roebber, ratio neige/eau dynamique (base 14:1) calibré pour les Alpes. Le ratio est ajusté selon la température (plus froid = neige plus légère), l'humidité (> 90 % = neige plus dense) et le vent (> 3 m/s = compaction). C'est cette quantité qui est affichée, pour les trois sources.</p>
        <p><strong>Qualité de neige</strong> : "sèche" si la température est ≤ -2 °C ou le point de rosée ≤ -3 °C, "humide" sinon.</p>
        <p><strong>Nébulosité</strong> : pour AROME, la couverture nuageuse vient d'ARPEGE en priorité. AROME HD ne fournit pas cette donnée, et AROME standard semble moins précis qu'ARPEGE comparé aux observations sur place.</p>
        <p><strong>Limite du gel</strong> (isotherme 0 °C : l'altitude au-dessus de laquelle il gèle) : corrigée automatiquement via MeteoSwiss lorsqu'une inversion thermique est détectée (température négative mais isotherme au-dessus de l'altitude).</p>
        <p><strong>Points de mesure</strong> : Station (1794 m), Marin-Pascal (2291 m), Vescal (2419 m), Observatoire (2590 m) — coordonnées GPS spécifiques à La Foux d'Allos. Vous pouvez ajouter vos propres points depuis le titre en haut de l'écran.</p>
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
