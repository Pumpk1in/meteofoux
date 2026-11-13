/**
 * MeteoFoux - UI Module
 * Graphiques, composants, gestion de l'application
 */

// Gestionnaire de graphiques ApexCharts
const Charts = {
    instances: {},

    // Faux le temps d'un rendu : les graphiques paraissent d'un coup, sans l'animation d'entrée
    // d'ApexCharts (elle peint d'abord le tracé fini une image, l'efface puis le redessine). Pour les
    // voisins préparés hors écran, et après un balayage : la page vient déjà de glisser
    animate: true,

    // Couleurs des séries selon le thème (clair : ≥ 3:1 sur blanc). La neige est la série la plus
    // saturée : c'est la grandeur qui compte ici
    getSeriesColors(isDark) {
        return isDark
            // Neige cyan clair / pluie bleu moyen : même famille, mais un net écart de clarté (3:1 entre elles)
            ? { temp: '#f97316', feels: '#fdba74', wind: '#98dfb6', gusts: '#39b36c', uv: '#fbbf24', snow: '#67e8f9', rain: '#3b82f6' }
            : { temp: '#c2410c', feels: '#ea580c', wind: '#15803d', gusts: '#16a34a', uv: '#b45309', snow: '#0891b2', rain: '#1d4ed8' };
    },

    // Titres d'axes : la couleur de la série qu'ils mesurent (°C, km/h du vent, UV)
    getAxisTitleColors(isDark) {
        return isDark
            ? { temp: '#f97316', wind: '#98dfb6', uv: '#fbbf24' }
            : { temp: '#c2410c', wind: '#15803d', uv: '#b45309' };
    },

    // Clé du graphique (HTML, au-dessus du tracé) : un repère par série — trait plein ou pointillé
    // pour les courbes, carré pour les barres — puis les unités au-dessus de leur colonne de graduations.
    // Les entrées ne sont pas cliquables ; seul le bouton « Plus de détails » ajoute ressenti, rafales, UV.
    chartHeadHtml(defs, isDark, details) {
        // Neige / pluie : dans la clé seulement si le jour en a (pas de « Neige » un jour de pluie).
        // La série reste dans le graphique : ses axes et leurs index ne bougent pas
        const items = defs.filter(d => d.type !== 'column' || d.data.some(p => p[1] > 0)).map(d => {
            const mark = d.type === 'column'
                ? `<span class="chart-key-bar" style="background:${d.color}"></span>`
                : `<span class="chart-key-line${d.dash > 0 ? ' is-dashed' : ''}" style="border-color:${d.color}"></span>`;
            return `<span class="chart-key-item">${mark}${d.name}</span>`;
        }).join('');
        const t = this.getAxisTitleColors(isDark);
        const hasUv = defs.some(d => d.key === 'uv');
        // Le bouton est centré sur la ligne des unités, pas au bout de la clé : quand la clé passe
        // sur deux lignes (détails affichés), il ne change pas de place sous le doigt
        return `<div class="chart-key">${items}</div>
            <div class="chart-units-row">
                <div class="chart-units${hasUv ? '' : ' no-uv'}" aria-hidden="true">
                    <span style="color:${t.temp}">°C</span>
                    <span class="chart-unit-wind" style="color:${t.wind}">km/h</span>
                    ${hasUv ? `<span class="chart-unit-uv" style="color:${t.uv}">UV</span>` : ''}
                </div>
                <button class="chart-details-btn" aria-expanded="${details}" onclick="App.toggleChartDetails(this)"><span class="chart-details-pill">${details ? 'Moins de détails' : 'Plus de détails'}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></span></button>
            </div>`;
    },

    // Options de base pour tous les graphiques (thème sombre)
    getBaseOptions(isDark = true) {
        return {
            chart: {
                background: 'transparent',
                fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
                toolbar: { show: false },
                // Pas de zoom : aucune commande n'y menait, et son mode « déplacement » redessinait tout le
                // graphique au premier glissé sur le tracé (l'infobulle ne suivait pas le doigt)
                zoom: { enabled: false },
                animations: { enabled: this.animate, speed: 400 },
                offsetX: 0,
                offsetY: 0,
                parentHeightOffset: 0
            },
            theme: { mode: isDark ? 'dark' : 'light' },
            grid: {
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                strokeDashArray: 3,
                // Avec UV (détails) : les colonnes km/h et UV dans la marge de droite, comme °C à gauche, et
                // le tracé s'arrête 4 px avant (il passait sous les graduations, la marge restait vide).
                // padding.right ne déplace que le tracé, pas les colonnes. top : moins de vide sous les unités
                padding: { left: -9, right: -47, top: -12, bottom: 0 }
            },
            tooltip: {
                theme: isDark ? 'dark' : 'light',
                x: { format: 'HH:mm' }
            },
            stroke: { curve: 'smooth', width: 2 },
            legend: {
                position: 'top',
                horizontalAlign: 'right',
                floating: true,
                offsetY: -5,
                labels: { colors: isDark ? '#e5e7eb' : '#374151' }
            },
            xaxis: {
                type: 'datetime',
                labels: {
                    style: { colors: isDark ? '#94a3b8' : '#4b5563' },
                    datetimeUTC: false,
                    datetimeFormatter: { hour: 'HH:mm' }
                },
                axisBorder: { show: false },
                axisTicks: { show: false },
                range: undefined // Pas de range fixe, utiliser les données
            },
            yaxis: {
                labels: { style: { colors: isDark ? '#94a3b8' : '#4b5563' } }
            }
        };
    },

    // Graphique unifié : Température, Vent, Précipitations, UV
    // hasExtendedData = true pour Open-Meteo (ressenti, rafales), false pour MET.no
    // scales = App.sharedChartScales() : axes communs aux modèles du jour (null : axes propres à data)
    // details = ressenti, rafales et UV affichés (bouton « Plus de détails »)
    createUnifiedChart(containerId, data, isDark = true, hasExtendedData = true, iconByHour = {}, scales = null, details = false) {
        const colors = this.getSeriesColors(isDark);

        // YAxis config selon les séries
        // Pour MET.no avec peu de variation, forcer une plage min de 10°C
        let yTempConfig = { seriesName: 'Temp' };
        // Axes du vent et des UV : même nombre d'intervalles que les températures, pour que leurs
        // graduations tombent sur les lignes de la grille
        const windScale = {}, uvScale = { max: 10 };

        if (scales) {
            // Bornes entières, pas entier : des graduations rondes (pas deux fois "1°")
            let lo = Math.floor(scales.tempMin), hi = Math.ceil(scales.tempMax);
            if (hi - lo < 3) {
                const mid = (scales.tempMin + scales.tempMax) / 2;
                lo = Math.floor(mid - 5);
                hi = Math.ceil(mid + 5);
            }
            const step = Math.max(1, Math.ceil((hi - lo) / 5));
            const ticks = Math.ceil((hi - lo) / step);
            yTempConfig = { seriesName: 'Temp', min: lo, max: lo + ticks * step, tickAmount: ticks };

            // Vent : maximum commun aux modèles, pas rond
            const windStep = [5, 10, 20, 25, 50, 100].find(s => s * ticks >= scales.windMax) || 100;
            Object.assign(windScale, { max: windStep * ticks, tickAmount: ticks });
            // UV : pas de 2 (0 à 10 sur 5 intervalles, 0 à 8 sur 4...)
            Object.assign(uvScale, { max: 2 * ticks, tickAmount: ticks });
        } else {
            const temps = data.temp.map(d => d[1]).filter(v => v !== null);
            const tempRange = Math.max(...temps) - Math.min(...temps);
            if (tempRange < 3) {
                const mid = (Math.max(...temps) + Math.min(...temps)) / 2;
                yTempConfig.min = Math.floor(mid - 5);
                yTempConfig.max = Math.ceil(mid + 5);
            }
        }

        // Calculer max dynamique pour neige et pluie (communs aux modèles si scales est fourni)
        const snowValues = scales ? [scales.snowMax] : data.snow.map(d => d[1]).filter(v => v !== null);
        const rainValues = scales ? [scales.rainMax] : data.rain.map(d => d[1]).filter(v => v !== null);
        const snowMax = Math.max(1.9, ...snowValues) * 1.2; // Au moins 1.9, avec 20% de marge
        const rainMax = Math.max(10, ...rainValues) * 1.2; // Au moins 10, avec 20% de marge

        // Une entrée par série, avec son axe (même ordre : ApexCharts associe série et axe par index).
        // Unités des axes : dans la clé HTML (chartHeadHtml), pas en titres ApexCharts.
        const labelStyle = { colors: isDark ? '#94a3b8' : '#4b5563', fontSize: '10px' }; // ≈ Micro (0.62rem), DESIGN.md
        const showUv = details;
        const defs = [
            { key: 'temp', name: 'Temp.', type: 'line', data: data.temp, width: 3, dash: 0, axis: {
                labels: {
                    formatter: v => Math.round(v) + '°',
                    style: labelStyle,
                    // Colonne à 12 px du bord gauche, sous « °C » (.chart-units) ; sans l'axe UV, ApexCharts la décale de 5 px
                    offsetX: showUv ? -7 : -12
                },
                showAlways: true,
                ...yTempConfig
            } },
            // Ressenti même axe (bornes recopiées : sinon ApexCharts lui calcule sa propre plage)
            hasExtendedData && details && { key: 'feels', name: 'T° ressentie', type: 'line', data: data.feels, width: 1.5, dash: 4,
                axis: { show: false, seriesName: 'Temp', ...(scales ? { min: yTempConfig.min, max: yTempConfig.max } : {}) } },
            { key: 'wind', name: 'Vent', type: 'line', data: data.speed, width: 2, dash: 0, axis: {
                opposite: true,
                axisBorder: { show: false },
                axisTicks: { show: false },
                labels: {
                    formatter: v => Math.round(v),
                    style: labelStyle,
                    // Sous « km/h » (.chart-unit-wind) : tout à droite sans UV, juste avant la colonne UV sinon.
                    // Axe opposé : plus négatif = plus à droite ; libellés calés à gauche (« 100 » s'étend vers le bord)
                    offsetX: showUv ? -46 : -20
                },
                seriesName: 'Vent',
                min: 0,
                ...windScale,
                showAlways: true
            } },
            hasExtendedData && details && { key: 'gusts', name: 'Rafales', type: 'line', data: data.gusts, width: 1.5, dash: 4,
                axis: { show: false, seriesName: 'Vent', min: 0, ...windScale } },
            showUv && { key: 'uv', name: 'UV', type: 'line', data: data.uv, width: 2, dash: 0, axis: {
                opposite: true,
                axisBorder: { show: false },
                axisTicks: { show: false },
                labels: {
                    formatter: v => v.toFixed(0),
                    style: labelStyle,
                    offsetX: -24 // Sous « UV » (.chart-unit-uv), tout à droite, à 9 px du bord comme °C à gauche
                },
                seriesName: 'UV',
                min: 0,
                ...uvScale,
                showAlways: true
            } },
            { key: 'snow', name: 'Neige', type: 'column', data: data.snow, width: 0, dash: 0,
                axis: { show: false, min: 0, max: snowMax, showAlways: true } },
            { key: 'rain', name: 'Pluie', type: 'column', data: data.rain, width: 0, dash: 0,
                axis: { show: false, min: 0, max: rainMax, showAlways: true } }
        ].filter(Boolean).map(d => ({ ...d, color: colors[d.key] }));
        const series = defs.map(d => ({ name: d.name, type: d.type, data: d.data }));
        const yaxis = defs.map(d => d.axis);

        // Étendue de l'axe X : toute la plage de données du jour
        const timestamps = data.temp.map(d => d[0]);
        const xMinVisible = Math.min(...timestamps);
        const xMaxVisible = Math.max(...timestamps);
        const now = Date.now();

        const options = {
            ...this.getBaseOptions(isDark),
            chart: {
                ...this.getBaseOptions(isDark).chart,
                type: 'line',
                // La clé est en HTML au-dessus : 50 px de moins pour garder la hauteur de tracé d'avant
                height: Utils.isMobile() ? 210 : 250,
                id: containerId,
                stacked: false,
                events: {
                    // Icônes dès le montage, sans attendre la fin de l'animation (~0,6 s) : les libellés de
                    // l'axe X sont déjà placés et l'animation ne les redessine pas
                    mounted: function() {
                        Charts.addWeatherIcons(containerId, iconByHour);
                    },
                    updated: function() {
                        setTimeout(() => Charts.addWeatherIcons(containerId, iconByHour), 100);
                    }
                }
            },
            series,
            colors: defs.map(d => d.color),
            stroke: {
                width: defs.map(d => d.width),
                curve: 'smooth',
                dashArray: defs.map(d => d.dash)
            },
            // Ligne « maintenant » : seulement sur le graphique qui contient l'heure actuelle (aujourd'hui)
            annotations: { xaxis: now >= xMinVisible && now <= xMaxVisible ? [{
                x: now,
                borderColor: isDark ? '#cbd5e1' : '#334155',
                strokeDashArray: 0,
                label: {
                    text: 'maintenant',
                    orientation: 'horizontal',
                    position: 'top',
                    offsetY: -2,
                    borderWidth: 0,
                    style: { background: 'transparent', color: isDark ? '#cbd5e1' : '#334155', fontSize: '10px', fontWeight: 600 }
                }
            }] : [] },
            plotOptions: {
                bar: { columnWidth: '70%', borderRadius: 2 }
            },
            legend: { show: false }, // Remplacée par la clé HTML (chartHeadHtml)
            // Sans l'axe UV, ApexCharts réserve moins de place à droite : son propre réglage. Le tracé s'arrête
            // 4 px avant les colonnes °C et km/h, symétriques (9 px du bord de la carte)
            ...(showUv ? {} : { grid: { ...this.getBaseOptions(isDark).grid, padding: { left: -11, right: -21, top: -12, bottom: 0 } } }),
            xaxis: {
                type: 'datetime',
                min: xMinVisible,
                max: xMaxVisible,
                labels: {
                    style: { colors: isDark ? '#94a3b8' : '#4b5563' },
                    datetimeUTC: false,
                    datetimeFormatter: { hour: 'HH:mm' }
                },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis
        };

        const head = document.getElementById(containerId)?.parentElement.querySelector('.chart-head');
        if (head) head.innerHTML = this.chartHeadHtml(defs, isDark, details);

        if (this.instances[containerId]) {
            this.instances[containerId].updateOptions(options);
        } else {
            this.instances[containerId] = new ApexCharts(document.getElementById(containerId), options);
            this.instances[containerId].render();
        }
    },

    // Détruit tous les graphiques
    destroyAll() {
        Object.values(this.instances).forEach(chart => chart.destroy());
        this.instances = {};
    },

    // Détruit les graphiques contenus dans un élément (une page quittée, un voisin préparé)
    destroyIn(root) {
        for (const [id, chart] of Object.entries(this.instances)) {
            if (root.contains(chart.el)) { chart.destroy(); delete this.instances[id]; }
        }
    },

    // Ajoute les icônes météo sous les labels de l'axe X
    addWeatherIcons(containerId, iconByHour) {
        const el = document.getElementById(containerId);
        if (!el) return;

        // Autoriser le débordement pour les icônes sous l'axe X
        const svg = el.querySelector('.apexcharts-svg');
        if (svg) svg.style.overflow = 'visible';

        // Supprimer les icônes précédentes
        el.querySelectorAll('.weather-icon-annotation').forEach(e => e.remove());

        // Trouver les labels de l'axe X
        const xaxisGroup = el.querySelector('.apexcharts-xaxis-texts-g');
        if (!xaxisGroup) return;

        xaxisGroup.querySelectorAll('text').forEach(textEl => {
            const label = (textEl.querySelector('tspan')?.textContent || textEl.textContent).trim();
            const icon = iconByHour[label];
            if (!icon) return;

            // Ne pas ajouter d'icône si le label est masqué
            const opacity = parseFloat(textEl.getAttribute('opacity') ?? '1');
            if (opacity < 0.1) return;

            const x = parseFloat(textEl.getAttribute('x'));
            const y = parseFloat(textEl.getAttribute('y'));

            const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `weather/svg/${icon}.svg`);
            img.setAttribute('href', `weather/svg/${icon}.svg`);
            // 22 px (18 avant : trop petites au soleil), même centre qu'avant
            img.setAttribute('x', x - 8);
            img.setAttribute('y', y + 3);
            img.setAttribute('width', 22);
            img.setAttribute('height', 22);
            img.classList.add('weather-icon-annotation');

            xaxisGroup.appendChild(img);
        });
    }
};

const App = {
    state: {
        currentDay: null,
        currentPoint: 'station',
        globalSource: 'arome',      // 'openmeteo', 'arome', ou 'metno' (AROME par défaut : le plus fiable ici)
        theme: 'dark',
        days: [],
        expandedDays: new Set(), // Jours avec vue horaire étendue
        todayHoursExpanded: false, // État du "Voir heures suivantes" pour aujourd'hui
        modelsHelpOpen: false,     // Explication des modèles (bouton "?" du verdict) dépliée
        chartDetails: false        // Graphique : ressenti, rafales et UV affichés ("Plus de détails")
    },

    // Helper pour obtenir les données selon la source sélectionnée
    getSourceData(pointData, source = this.state.globalSource) {
        return pointData.sources[source] || { hourly: {}, sixHourly: {}, extended: false };
    },

    async init() {
        try {
            // Charger les points personnalisés avant tout
            CustomPoints.init();
            // Rouvrir le dernier point consulté, s'il existe encore ; sinon (première visite) la Station,
            // le plus bas du domaine, quel que soit l'ordre mémorisé des points
            const savedPoint = localStorage.getItem('fmeteo_point');
            this.state.currentPoint = CONFIG.points.some(p => p.key === savedPoint)
                ? savedPoint : CONFIG.domain[0];

            // Charger le thème sauvegardé
            const savedTheme = localStorage.getItem('fmeteo_theme') || 'dark';
            this.state.theme = savedTheme;
            document.documentElement.setAttribute('data-theme', savedTheme);
            // Mettre à jour la couleur du navigateur mobile
            const themeColor = savedTheme === 'dark' ? '#020617' : '#ffffff'; // = fond de la barre du haut
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);

            // Charger la source sauvegardée
            const savedSource = localStorage.getItem('fmeteo_source') || 'arome';
            this.state.globalSource = savedSource;
            this.tintSkeleton();
            // Le titre nomme déjà le point mémorisé pendant le chargement (son altitude vient avec les données)
            this.updateTopBar();
            this.initSwipe();
            this.initDayScrub();

            // Charger le point initial et afficher immédiatement
            await DataService.loadFirst(false, this.state.currentPoint);
            this.setupDays();
            this.renderNavigation();
            this.render();

            // Charger les autres points en arrière-plan (la feuille des points se complète au fur et à mesure)
            DataService.loadRemaining(false, key => { this.refreshPointSheet(); this.scheduleNeighbors(key); });

            // "mis à jour il y a X min" reste juste si l'onglet reste ouvert
            setInterval(() => this.updateTopBar(), 60000);
        } catch (e) {
            console.error("Erreur chargement:", e);
            document.getElementById('content').removeAttribute('aria-busy');
            document.getElementById('content').innerHTML = `
                <div class="error" role="alert">
                    <p><strong>Impossible de charger les prévisions.</strong></p>
                    <p>Vérifiez la connexion, puis réessayez. Si le problème persiste, les services météo sont peut-être momentanément indisponibles.</p>
                    <button class="btn-more" onclick="location.reload()">Réessayer</button>
                    <p class="error-detail">Détail : ${Utils.escapeHtml(e.message)}</p>
                </div>`;
        }
    },

    setupDays() {
        const data = DataService.state.data;
        const now = new Date();
        const todayStr = now.toLocaleDateString('fr-CA');

        const allDays = [...new Set(Object.values(data)[0].series.map(s => Utils.getLocalDay(s.time)))];
        this.state.days = allDays.filter(day => day >= todayStr).slice(0, 7);
        // Le soir, on regarde surtout demain : après 18 h, ouvrir sur le lendemain
        this.state.currentDay = now.getHours() >= 18 && this.state.days.length > 1
            ? this.state.days[1]
            : this.state.days[0];
    },

    renderNavigation() {
        this.renderDayNav();
        this.updateTopBar();

        lucide.createIcons();
    },

    // Barre des jours : "AUJ." puis les jours de la semaine, chacun avec l'indicateur du verdict
    // pour le point affiché (flocon + cm, goutte + mm, soleil + max), l'unité sur sa propre ligne
    // (« 28–49 mm » ne tient pas dans un bouton de 44 px), en ambre si les modèles se contredisent.
    // À refaire quand le point change.
    renderDayNav() {
        const pointData = DataService.state.data[this.state.currentPoint];
        const deg = n => String(Math.round(n)).replace('-', '−');
        const ICONS = { snow: 'snowflake', rain: 'cloud-rain', dry: 'sun' };
        const SPOKEN = { snow: ' de neige', rain: ' de pluie', dry: ', sec' };
        const UNITS = { snow: 'cm', rain: 'mm', dry: 'max' };

        document.getElementById('day-nav').innerHTML = this.state.days.map((day, index) => {
            const isActive = day === this.state.currentDay;
            const label = index === 0 ? 'AUJ.' : CONFIG.dayLabels[Utils.getDayOfWeek(day)];
            const verdict = pointData ? DataNormalizer.dayVerdict(pointData, day).verdict : null;

            let indicatorHtml = '', spoken = '';
            if (verdict) {
                const { prefix, value, unit } = Components.verdictValue(verdict);
                spoken = ` : ${prefix ? `${prefix} ` : ''}${value} ${unit}${SPOKEN[verdict.mode]}${verdict.contradict ? ', peu fiable' : ''}`;
                let short;
                if (verdict.mode === 'dry') {
                    short = `${deg(verdict.tempMax)}°`;
                } else {
                    const lo = Math.round(verdict.range.lo), hi = Math.round(verdict.range.hi);
                    short = verdict.basis.length === 1 || lo === hi ? `${hi}` : `${lo}–${hi}`;
                }
                indicatorHtml = `<span class="day-indicator is-${verdict.mode}${verdict.contradict ? ' is-unsure' : ''}"><i data-lucide="${ICONS[verdict.mode]}"></i>${short}</span>
                    <span class="day-unit">${UNITS[verdict.mode]}</span>`;
            }

            return `
                <button class="day-btn ${isActive ? 'active' : ''}" data-day="${day}" aria-current="${isActive}"
                        aria-label="${Utils.formatDateLabel(day)}${spoken}" onclick="App.selectDay('${day}')">
                    <span class="day-label">${label}</span>
                    ${indicatorHtml}
                </button>`;
        }).join('');
        lucide.createIcons();
    },


    // « Vescal · 2100 m » ; le nom seul tant que le point n'a pas chargé
    pointName(point) {
        const elevation = DataService.state.data[point.key]?.elevation;
        return elevation ? `${point.name} · ${Math.round(elevation)} m` : point.name;
    },

    // Les points entre lesquels on balaie : ceux du domaine, ou les points perso entre eux, dans
    // l'ordre de la feuille. On ne passe pas de l'un à l'autre groupe : le domaine garde ses deux bouts
    swipeGroup(key = this.state.currentPoint) {
        return CONFIG.domain.includes(key) ? CONFIG.domain : CONFIG.points.filter(p => p.custom).map(p => p.key);
    },

    // Barre du haut : point choisi et son altitude (ouvre la feuille des points), puis la date.
    // Un autre point pendant un balayage : celui où l'on arrivera en lâchant
    updateTopBar(pointKey = this.state.currentPoint) {
        const point = CONFIG.points.find(p => p.key === pointKey);
        if (point) {
            document.getElementById('point-title-text').textContent = this.pointName(point);
            // Sa place dans son groupe (les quatre du domaine, du plus bas au plus haut, ou les points
            // perso), les autres en petit, mobile seulement : le balayage passe de l'un à l'autre
            const group = this.swipeGroup(point.key);
            const rank = group.indexOf(point.key);
            const dot = `<span class="point-dot" style="--point-color: ${point.color}"></span>`;
            document.getElementById('point-title-dots').innerHTML = group.length < 2 ? dot
                : group.map((_, i) => i === rank ? dot : '<span class="point-step"></span>').join('');
        }
        const dateEl = document.getElementById('current-date');
        if (this.state.currentDay) {
            // Sur ordinateur, tous les jours s'empilent et chacun a sa date en tête : en haut, la
            // date d'un seul jour contredisait celui qu'on lisait. Seule la fraîcheur y reste
            const formatted = Utils.isMobile() ? Utils.formatDateShort(this.state.currentDay) : '';
            const freshness = this.freshness(DataService.state.data[pointKey]?.meta);
            const line = [formatted, freshness?.text].filter(Boolean).join(' · ');
            dateEl.textContent = line.charAt(0).toUpperCase() + line.slice(1);
            dateEl.classList.toggle('is-stale', !!freshness?.stale);
        }
    },

    // Âge des prévisions affichées. Anciennes : le proxy a servi son cache faute de réponse des
    // sources, ou les données ont plus d'une heure (onglet resté ouvert, réseau coupé)
    freshness(meta) {
        if (!meta?.generated_at) return null;
        const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(meta.generated_at)) / 60000));
        const age = minutes < 1 ? 'à l’instant'
            : minutes < 60 ? `il y a ${minutes} min`
            : `il y a ${Math.floor(minutes / 60)} h`;
        const stale = !!meta.stale || minutes >= 60;
        // Court : la ligne tient sur un téléphone à côté de la date
        const text = !stale ? `màj ${age}` : minutes < 1 ? 'données en cache' : `données d’${age}`;
        return { stale, text };
    },

    selectDay(day) {
        this.state.currentDay = day;

        // Mettre à jour les boutons
        document.querySelectorAll('.day-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.day === day);
            btn.setAttribute('aria-current', btn.dataset.day === day);
        });

        this.updateTopBar();
        this.render();

        // Sur desktop, scroll vers l'ancre
        if (!Utils.isMobile()) {
            const section = document.querySelector(`.day-section[data-day="${day}"]`);
            if (section) section.scrollIntoView({ behavior: 'smooth' });
        }
    },

    // Barre des jours au doigt : appuyer sur un jour puis glisser sur les côtés. Le jour sous le
    // doigt se soulève au-dessus de lui (le doigt le cacherait) et tremble à chaque changement ;
    // relâcher l'ouvre. Doigt remonté loin au-dessus de la barre : rien n'est choisi. Un appui
    // sans glisser reste un appui ordinaire
    initDayScrub() {
        const nav = document.getElementById('day-nav');
        const CANCEL = 60;               // px au-dessus de la barre où le doigt annule
        let g = null;
        let suppressUntil = 0;           // le clic qui peut suivre un glissement ne choisit rien

        // Le jour le plus proche du doigt (les espaces entre les boutons comptent aussi)
        const dayAt = x => {
            let best = null, bestDist = Infinity;
            nav.querySelectorAll('.day-btn').forEach(btn => {
                const r = btn.getBoundingClientRect();
                const dist = Math.abs(x - (r.left + r.right) / 2);
                if (dist < bestDist) { best = btn; bestDist = dist; }
            });
            return best;
        };

        const hover = btn => {
            if (btn === g.btn) return;
            g.btn?.classList.remove('is-scrub');
            g.btn = btn;
            if (!btn) return;
            btn.classList.add('is-scrub');
            navigator.vibrate?.(8);
        };

        const end = (e, cancelled) => {
            if (!g || e.pointerId !== g.id) return;
            const gesture = g;
            if (gesture.locked) {
                hover(null);
                nav.classList.remove('is-scrubbing');
                suppressUntil = e.timeStamp + 500;
            }
            g = null;
            const day = gesture.locked && !cancelled ? gesture.day : null;
            if (day && day !== this.state.currentDay) this.selectDay(day);
        };

        nav.addEventListener('pointerdown', e => {
            if (e.pointerType === 'mouse' || !e.isPrimary || !e.target.closest('.day-btn')) return;
            g = { id: e.pointerId, x0: e.clientX, locked: false, btn: null, day: null };
        });

        nav.addEventListener('pointermove', e => {
            if (!g || e.pointerId !== g.id) return;
            if (!g.locked) {
                if (Math.abs(e.clientX - g.x0) < 10) return;
                g.locked = true;
                nav.setPointerCapture(e.pointerId);
                nav.classList.add('is-scrubbing');
            }
            const away = e.clientY < nav.getBoundingClientRect().top - CANCEL;
            hover(away ? null : dayAt(e.clientX));
            g.day = g.btn?.dataset.day ?? null;
        });

        nav.addEventListener('pointerup', e => end(e, false));
        nav.addEventListener('pointercancel', e => end(e, true));
        nav.addEventListener('click', e => {
            if (e.timeStamp < suppressUntil) { e.stopPropagation(); e.preventDefault(); }
        }, { capture: true });
    },

    async selectPoint(pointKey) {
        this.state.currentPoint = pointKey;
        localStorage.setItem('fmeteo_point', pointKey);
        this.updateTopBar();

        // Si le point n'est pas encore chargé, afficher skeleton et attendre
        if (!DataService.state.data[pointKey]) {
            this.showSkeleton();
            const point = CONFIG.points.find(p => p.key === pointKey);
            await DataService.loadSinglePoint(point);
        }

        this.renderDayNav();
        this.render();
    },

    // Modèle affiché en détail (cases du bloc verdict). Mémorisé, valable pour tous les jours.
    // Le rendu garde la position de défilement : seul le détail change.
    selectSource(source) {
        if (source === this.state.globalSource) return;
        this.state.globalSource = source;
        localStorage.setItem('fmeteo_source', source);
        const scrollY = window.scrollY;
        this.render();
        window.scrollTo(0, scrollY);
    },

    toggleTheme() {
        this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', this.state.theme);
        localStorage.setItem('fmeteo_theme', this.state.theme);
        // Les graphiques sont recréés : séries ET titres d'axes changent de teinte avec le thème
        // (pas de rendu tant que le point n'a pas de données : chargement initial, écran d'erreur)
        if (DataService.state.data[this.state.currentPoint]) {
            const scrollY = window.scrollY;
            this.render();
            window.scrollTo(0, scrollY);
        }
        // Mettre à jour la couleur du navigateur mobile
        const themeColor = this.state.theme === 'dark' ? '#020617' : '#ffffff'; // = fond de la barre du haut
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
    },

    // Rafraîchit : le squelette de la page pendant l'attente ; en cas d'échec (réseau faible sur les
    // pistes), les prévisions d'avant reviennent, avec un message
    async refreshData() {
        const btn = document.getElementById('refresh-btn');
        // Un seul rafraîchissement à la fois, arrière-plan compris (sinon deux tournées forcées
        // de tous les points en parallèle : appels doublés vers les API, risque de 429)
        if (this._refreshing) return;
        this._refreshing = true;
        btn.classList.add('refreshing');
        // La barre des jours garde les valeurs d'avant : estompées tant que le point n'a pas répondu
        const dayNav = document.getElementById('day-nav');
        dayNav.classList.add('is-loading');
        dayNav.setAttribute('aria-busy', 'true');
        this.showSkeleton();
        window.scrollTo(0, 0);

        const current = CONFIG.points.find(p => p.key === this.state.currentPoint);
        try {
            await DataService.loadSinglePoint(current, true);
            this.renderDayNav();
            this.render();
        } catch (e) {
            console.error('Rafraîchissement impossible :', e);
            this.render();
            const freshness = this.freshness(DataService.state.data[current.key]?.meta);
            this.showNotice(`Rafraîchissement impossible (réseau ou service météo indisponible). `
                + `Les prévisions affichées sont conservées${freshness ? ` (${freshness.text.replace('màj ', 'mises à jour ')})` : ''}.`);
        } finally {
            btn.classList.remove('refreshing');
            dayNav.classList.remove('is-loading');
            dayNav.removeAttribute('aria-busy');
        }

        // Les autres points, en arrière-plan ; un échec garde simplement leurs anciennes données
        for (const point of CONFIG.points.filter(p => p.key !== current.key)) {
            try {
                await DataService.loadSinglePoint(point, true);
                this.refreshPointSheet();
                this.scheduleNeighbors(point.key);
            } catch (e) {
                console.warn(`Rafraîchissement de ${point.key} impossible :`, e.message);
            }
        }
        this._refreshing = false;
    },

    // Squelette de la page pendant un chargement, le détail aux couleurs du modèle choisi
    showSkeleton() {
        Charts.destroyAll();
        const content = document.getElementById('content');
        content.innerHTML = Components.Skeleton();
        content.setAttribute('aria-busy', 'true');
        this.tintSkeleton();
    },

    tintSkeleton() {
        document.querySelector('#content .skeleton-loader .day-detail')?.setAttribute('data-source', this.state.globalSource);
    },

    // Message en tête du contenu (remplacé au prochain rendu)
    showNotice(text) {
        document.querySelector('#content .notice')?.remove();
        const notice = document.createElement('div');
        notice.className = 'notice';
        notice.setAttribute('role', 'status');
        notice.textContent = text;
        document.getElementById('content').prepend(notice);
    },

    render() {
        const data = DataService.state.data;
        const isToday = Utils.isToday(this.state.currentDay);
        const pointData = data[this.state.currentPoint];

        this.updateTopBar();
        document.getElementById('content').removeAttribute('aria-busy');

        // Détruire les anciens graphiques avant de recréer le DOM
        Charts.destroyAll();

        // Sur mobile : afficher uniquement le jour sélectionné
        // Sur desktop : afficher tous les jours en scroll
        if (Utils.isMobile()) {
            const html = this.renderDayContent(this.state.currentDay, pointData, isToday);
            document.getElementById('content').innerHTML = html;
        } else {
            const html = this.state.days
                .map(day => this.renderDayContent(day, pointData, Utils.isToday(day)))
                .join('');
            document.getElementById('content').innerHTML = html;
        }

        lucide.createIcons();
        this.restoreToggles(document);

        // Rendre les graphiques après le DOM
        requestAnimationFrame(() => this.renderCharts());
        this.scheduleNeighbors();
    },

    // Heures dépliées (aujourd'hui, jours suivants) dans un rendu tout neuf : la page, ou le point
    // voisin pendant un balayage
    restoreToggles(root) {
        // Restaurer l'état du toggle aujourd'hui si nécessaire
        if (this.state.todayHoursExpanded) {
            const todayGrid = root.querySelector('.day-section[data-day="' + new Date().toLocaleDateString('fr-CA') + '"] .cards-grid:not(.cards-grid-tomorrow)');
            if (todayGrid) {
                todayGrid.querySelectorAll('.hidden-card').forEach(card => {
                    card.classList.remove('hidden-card');
                    card.classList.add('was-hidden');
                });
                const btn = todayGrid.querySelector('.btn-more');
                if (btn) btn.textContent = 'Replier les heures';
                todayGrid.querySelector('.rows').setAttribute('style', Components.rowsCount(todayGrid.querySelectorAll('.card').length));
            }
        }

        // Restaurer l'état du toggle pour chaque jour étendu
        this.state.expandedDays.forEach(day => {
            const dayGrid = root.querySelector(`.cards-grid-tomorrow[data-day="${day}"]`);
            if (dayGrid) {
                const periodsGrid = dayGrid.querySelector('.grid-periods');
                const hourlyGrid = dayGrid.querySelector('.grid-hourly');
                const btn = dayGrid.querySelector('.btn-toggle-tomorrow');
                if (periodsGrid && hourlyGrid && btn) {
                    periodsGrid.style.display = 'none';
                    hourlyGrid.style.display = '';
                    btn.textContent = 'Replier les heures';
                }
            }
        });
    },

    // Un point voisin dans un panneau posé hors écran à côté de la page : le jour affiché, pour ce point
    neighborPanel(key, side) {
        const el = document.createElement('div');
        el.className = 'swipe-peek';
        el.dataset.key = key;
        el.setAttribute('aria-hidden', 'true');
        el.inert = true;
        el.style.transform = `translateX(${side === 'prev' ? '-' : ''}100%)`;
        const pointData = DataService.state.data[key];
        el.innerHTML = pointData
            ? this.renderDayContent(this.state.currentDay, pointData, Utils.isToday(this.state.currentDay))
            : Components.Skeleton();
        if (!pointData) el.querySelector('.day-detail')?.setAttribute('data-source', this.state.globalSource);
        this.restoreToggles(el);
        document.getElementById('content').appendChild(el);
        lucide.createIcons();
        return el;
    },

    // Les deux voisins (mobile), préparés hors écran quand le navigateur a le temps, graphique compris :
    // au balayage ils sont déjà là, et à l'arrivée il n'y a plus rien à dessiner. Refaits après chaque
    // rendu, chaque bascule qui change la page, et quand un voisin (loadedKey) vient de charger
    scheduleNeighbors(loadedKey) {
        const group = this.swipeGroup();
        const i = group.indexOf(this.state.currentPoint);
        if (loadedKey && Math.abs(group.indexOf(loadedKey) - i) !== 1) return;
        // Pendant un geste, les voisins restent (retirés, la page glisserait vers le vide) : refaits à la fin
        if (this._swiping) { this._neighborsStale = true; return; }
        this._neighborsStale = false;
        const content = document.getElementById('content');
        content.querySelectorAll(':scope > .swipe-peek').forEach(p => { Charts.destroyIn(p); p.remove(); });
        if (!Utils.isMobile() || i < 0) return;
        const token = this._neighbors = (this._neighbors || 0) + 1;
        const idle = window.requestIdleCallback || (fn => setTimeout(fn, 200));
        // Un voisin par moment libre : chacun coûte ~70 ms sur un téléphone moyen
        [[group[i - 1], 'prev'], [group[i + 1], 'next']].forEach(([key, side]) => idle(() => {
            if (token !== this._neighbors || this._swiping || content.hasAttribute('aria-busy')) return;
            if (!key || !DataService.state.data[key]) return;
            const panel = this.neighborPanel(key, side);
            Charts.animate = false;
            this.renderCharts(key);
            Charts.animate = true;
            panel.dataset.drawn = '1';
        }));
    },

    // Balayage d'un point à l'autre de son groupe (swipeGroup : le domaine, ou les points perso ;
    // mobile, au doigt). La page suit le doigt et le point voisin entre à côté, déjà dessiné
    // (scheduleNeighbors) ; à l'arrivée, il devient la page. Lâchée au-delà de 30 % de la largeur, ou
    // d'un geste vif, elle part vers ce point ; sinon elle revient. Vers la gauche on monte (le point
    // suivant), vers la droite on descend ; pas de boucle : aux deux bouts, la page résiste. Le titre
    // annonce le point où l'on arrivera en lâchant. Le jour et la position dans la page ne changent
    // pas : on compare le même endroit d'un point à l'autre.
    // Depuis le tracé du graphique aussi, sauf après un appui dessus : on y glisse alors pour lire les
    // heures, jusqu'à toucher ailleurs. Sur tous les graphiques, même sans voisin : un seul usage à apprendre
    initSwipe() {
        const content = document.getElementById('content');
        const COMMIT = 0.3, FLICK = 0.5; // part de la largeur ; vitesse en px/ms
        let g = null;                    // geste en cours
        let tap = null;                  // doigt posé sur un tracé, pas encore glissé : un appui s'il se lève
        let engaged = null;              // graphique (.chart) touché d'un appui : on y lit les heures
        let mute = false;                // le graphique ne voit pas ce geste (son infobulle suivrait le doigt)

        // Avant ApexCharts (phase de capture) ; un appui lui est transmis à part, au lever du doigt
        ['touchstart', 'touchmove'].forEach(type => content.addEventListener(type, e => {
            if (mute) e.stopPropagation();
        }, { capture: true, passive: true }));

        // Le voisin préparé ; sinon (geste juste après un changement) construit maintenant, sans son
        // graphique, dont la place est gardée : les heures ne remontent pas puis redescendent à l'arrivée
        const panelFor = (key, side) => {
            if (!key) return null;
            const ready = content.querySelector(`:scope > .swipe-peek[data-key="${key}"]`);
            if (ready) return ready;
            const el = this.neighborPanel(key, side);
            const chartHeight = content.querySelector(':scope > .day-section .chart-wrapper')?.offsetHeight;
            if (chartHeight) el.querySelectorAll('.chart-wrapper').forEach(w => w.style.minHeight = `${chartHeight}px`);
            return el;
        };

        // Étiquette du point qui arrive, à hauteur du doigt (un peu au-dessus, que le pouce ne la cache
        // pas) : là où l'œil est pendant le geste. Le titre, petit et en haut à gauche, passait inaperçu,
        // surtout après un balayage involontaire. Elle glisse avec la page voisine, rebondit à
        // l'arrivée, y reste un instant puis s'efface.
        // Sur un point perso sans voisin de ce côté (HINT), elle renvoie au titre, qui ouvre la feuille
        // des points : sans elle, le geste ne donnait aucun retour
        const label = document.createElement('div');
        label.className = 'swipe-label';
        label.setAttribute('aria-hidden', 'true');
        document.body.appendChild(label);
        const HINT = '';
        let labelTimer = null;
        const showLabel = (key, x, animate) => {
            clearTimeout(labelTimer);
            if (label.dataset.key !== key) {
                const point = CONFIG.points.find(p => p.key === key);
                label.innerHTML = key === HINT ? '<i data-lucide="arrow-up-left"></i>Autres points'
                    : `<span class="point-dot" style="--point-color: ${point.color}"></span>${Utils.escapeHtml(this.pointName(point))}`;
                if (key === HINT) lucide.createIcons();
                label.dataset.key = key;
            }
            // translate, pas transform : le rebond (scale) se fait alors autour de la bulle à sa place
            label.style.transition = animate ? 'translate 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
            label.style.translate = `calc(-50% + ${x}px) -50%`;
            label.classList.add('is-on');
        };
        // Entre la barre du haut et celle des jours
        const placeLabel = y => {
            const half = label.offsetHeight / 2 + 8;
            const min = document.querySelector('.top-bar').getBoundingClientRect().bottom + half;
            const max = document.querySelector('.bottom-nav').getBoundingClientRect().top - half;
            label.style.top = `${Math.min(max, Math.max(min, y - 64))}px`;
        };
        const hideLabel = delay => {
            clearTimeout(labelTimer);
            labelTimer = setTimeout(() => {
                label.style.transition = 'opacity 0.4s, visibility 0.4s';
                label.classList.remove('is-on');
            }, delay);
        };
        // Rebond (la bulle, le titre) : la classe retirée puis remise le relance d'un geste à l'autre
        const pop = (el, cls) => {
            el.classList.remove(cls);
            void el.offsetWidth;
            el.classList.add(cls);
        };

        const place = (gesture, offset, animate) => {
            [...gesture.current, gesture.prev, gesture.next].filter(Boolean).forEach(el => {
                el.style.transition = animate ? 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
            });
            gesture.current.forEach(el => el.style.transform = `translateX(${offset}px)`);
            if (gesture.prev) gesture.prev.style.transform = `translateX(calc(-100% + ${offset}px))`;
            if (gesture.next) gesture.next.style.transform = `translateX(calc(100% + ${offset}px))`;
        };

        content.addEventListener('pointerdown', e => {
            // Un second doigt ne touche pas au geste en cours (pincer : le navigateur l'annule lui-même)
            if (e.pointerType === 'mouse' || !e.isPrimary) return;
            g = tap = null;
            mute = false;
            if (this._swiping || !Utils.isMobile()) return;
            // Le tracé : la bande verticale de sa grille (pas la légende au-dessus, ni les heures en dessous)
            const chart = e.target.closest('.chart');
            const plot = chart?.querySelector('.apexcharts-grid')?.getBoundingClientRect();
            const onPlot = plot && e.clientY >= plot.top && e.clientY <= plot.bottom ? chart : null;
            if (onPlot) tap = { id: e.pointerId, x0: e.clientX, y0: e.clientY, chart: onPlot };
            if (onPlot && onPlot === engaged) return;
            engaged = null;
            if (!DataService.state.data[this.state.currentPoint]) return;
            if (content.hasAttribute('aria-busy')) return;
            mute = !!onPlot;
            g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, locked: false, offset: 0, samples: [] };
        });

        content.addEventListener('pointermove', e => {
            if (tap?.id === e.pointerId && Math.hypot(e.clientX - tap.x0, e.clientY - tap.y0) >= 10) tap = null;
            if (!g || e.pointerId !== g.id) return;
            const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
            if (!g.locked) {
                if (Math.hypot(dx, dy) < 10) return;
                // Plutôt vertical : la page défile, le balayage n'a pas lieu
                if (Math.abs(dy) >= Math.abs(dx)) { g = null; return; }
                g.locked = true;
                this._swiping = true;
                content.setPointerCapture(e.pointerId);
                const group = this.swipeGroup();
                const i = group.indexOf(this.state.currentPoint);
                g.prevKey = group[i - 1];
                g.nextKey = group[i + 1];
                g.current = [...content.children].filter(el => !el.classList.contains('swipe-peek'));
                g.prev = panelFor(g.prevKey, 'prev');
                g.next = panelFor(g.nextKey, 'next');
                g.shown = this.state.currentPoint;
            }
            g.samples.push({ x: e.clientX, t: e.timeStamp });
            if (g.samples.length > 5) g.samples.shift();

            const targetKey = dx < 0 ? g.nextKey : g.prevKey;
            g.offset = targetKey ? dx : dx / 3; // pas de voisin de ce côté : la page résiste
            place(g, g.offset, false);
            // Au milieu de la page voisine, qu'elle suit ; l'indice, lui, reste au doigt. Aux bouts du
            // domaine, rien : l'ordre d'altitude se comprend seul
            g.side = dx < 0 ? 1 : -1;
            const hint = !targetKey && !CONFIG.domain.includes(this.state.currentPoint);
            if (targetKey || hint) {
                const fresh = label.dataset.key !== (targetKey || HINT) || !label.classList.contains('is-on');
                showLabel(targetKey || HINT, targetKey ? g.side * content.clientWidth + g.offset : 0, false);
                if (!g.labelPlaced) { placeLabel(g.y0); g.labelPlaced = true; }
                if (hint && fresh) {
                    pop(label, 'is-pop');
                    pop(document.getElementById('point-title'), 'is-nudge');
                }
            } else label.classList.remove('is-on');
            const shown = targetKey && Math.abs(g.offset) > content.clientWidth * COMMIT ? targetKey : this.state.currentPoint;
            if (shown !== g.shown) { g.shown = shown; this.updateTopBar(shown); }
        });

        const end = (e, cancelled) => {
            if (!g || e.pointerId !== g.id) return;
            const gesture = g;
            g = null;
            if (!gesture.locked) return;

            // Vitesse sur les derniers déplacements : un geste vif suffit, même court, s'il va dans
            // le sens où la page est déjà partie
            const s = gesture.samples;
            const v = s.length > 1 ? (s[s.length - 1].x - s[0].x) / Math.max(1, s[s.length - 1].t - s[0].t) : 0;
            const toward = Math.sign(gesture.offset);
            const go = !cancelled && (Math.abs(v) > FLICK
                ? Math.sign(v) === toward
                : Math.abs(gesture.offset) > content.clientWidth * COMMIT);
            const key = go ? (toward < 0 ? gesture.nextKey : gesture.prevKey) : null;
            place(gesture, key ? toward * content.clientWidth : 0, true);
            if (label.classList.contains('is-on')) {
                if (key) {
                    showLabel(key, 0, true);
                    pop(label, 'is-pop');
                    hideLabel(1400);
                }
                else if (label.dataset.key === HINT) hideLabel(1400);
                else { showLabel(label.dataset.key, gesture.side * content.clientWidth, true); hideLabel(280); }
            }

            const panel = key && (toward < 0 ? gesture.next : gesture.prev);
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                this._swiping = false;
                // Un voisin a rechargé pendant le geste (rafraîchissement) : son panneau date d'avant
                const stale = this._neighborsStale;
                if (panel?.dataset.drawn && !stale) {
                    // Le voisin devient la page, graphique compris : rien à redessiner. L'ancienne page
                    // s'en va ; l'autre voisin aussi, les nouveaux se préparent
                    gesture.current.forEach(el => { Charts.destroyIn(el); el.remove(); });
                    panel.replaceWith(...panel.childNodes);
                    this.state.currentPoint = key;
                    localStorage.setItem('fmeteo_point', key);
                    this.updateTopBar();
                    this.renderDayNav();
                    this.scheduleNeighbors();
                } else if (key) {
                    // Voisin pas encore dessiné : le rendu remplace la page, même position dans la page.
                    // Le graphique n'est tracé qu'à l'image suivante : d'ici là, la page garde sa hauteur
                    // (sinon le navigateur ramènerait le défilement plus haut), et il paraît en fondu
                    const scrollY = window.scrollY;
                    content.style.minHeight = `${content.offsetHeight}px`;
                    Charts.animate = false;
                    this.selectPoint(key);
                    window.scrollTo(0, scrollY);
                    content.querySelector('.chart-wrapper')?.classList.add('chart-enter');
                    // Après le tracé (même image que celui de render, demandé avant)
                    requestAnimationFrame(() => {
                        content.style.minHeight = '';
                        Charts.animate = true;
                    });
                } else {
                    gesture.current.forEach(el => el.style.transform = el.style.transition = '');
                    this.updateTopBar();
                    // Voisins construits pendant le geste, sans graphique : à préparer pour de bon
                    if (stale || [gesture.prev, gesture.next].some(p => p && !p.dataset.drawn)) this.scheduleNeighbors();
                }
            };
            gesture.current[0]?.addEventListener('transitionend', finish, { once: true });
            setTimeout(finish, 350);
        };
        content.addEventListener('pointerup', e => {
            // Un appui sur le tracé : son infobulle à cette heure, tout de suite, et les glissés suivants y
            // lisent les heures. Donnée par nous : certains téléphones n'envoient pas au graphique les
            // événements de souris d'un appui. Après le touchend, qui la masquerait
            if (tap?.id === e.pointerId) {
                engaged = tap.chart;
                const { target, clientX, clientY } = e;
                setTimeout(() => target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY })));
            }
            tap = null;
            end(e, false);
        });
        content.addEventListener('pointercancel', e => { tap = null; end(e, true); });
    },

    // Modèle affiché en détail pour un jour : le choix de l'utilisateur, sauf au-delà de son horizon
    // (AROME/ARPEGE ~J+4) où le premier modèle qui couvre ce jour prend le relais, sans toucher au choix.
    // Une source qui ne répond pas reste choisie : le détail le dit et propose de réessayer.
    daySource(pointData, summaries) {
        const chosen = this.state.globalSource;
        if (summaries[chosen] || !pointData.sources[chosen]) return chosen;
        return ['openmeteo', 'arome', 'metno'].find(k => summaries[k]) || chosen;
    },

    renderDayContent(day, pointData, isToday) {
        const { series } = pointData;

        // En tête du jour (ordinateur, où tous les jours s'empilent) : la date seule, le point est en haut
        const dayHeaderHtml = `
            <h2 class="day-header">
                <span class="day-label">${Utils.formatDateLabel(day)}</span>
            </h2>`;

        // Verdict du jour selon tous les modèles disponibles (bloc en tête du jour)
        const { summaries, verdict } = DataNormalizer.dayVerdict(pointData, day);
        // Sources présentes dans la réponse du proxy : une absente n'a pas répondu (429, panne)
        const available = Object.keys(pointData.sources);
        // Modèle du détail pour ce jour (relais au-delà de l'horizon du modèle choisi)
        const source = this.daySource(pointData, summaries);
        const sourceData = this.getSourceData(pointData, source);
        const hourlyData = sourceData.hourly;
        const sixHourlyData = sourceData.sixHourly;
        const verdictHtml = Components.Verdict(verdict, summaries, source, available);

        // Créneaux du jour (chronologie commune), avec les données de la source choisie
        const dayEntries = series
            .filter(e => Utils.getLocalDay(e.time) === day)
            .map(e => ({ time: e.time, hourly: hourlyData[e.time] || null, sixHourly: sixHourlyData[e.time] || null }));

        // Pas de données de cette source pour ce jour : elle ne répond pas, ou aucun modèle ne couvre ce jour
        if (!summaries[source]) {
            const label = { openmeteo: 'Open-Meteo', arome: 'Météo-France', metno: 'MET.no' }[source];
            const message = available.includes(source)
                ? `<p>${label} n’a pas de prévision pour ce jour</p>
                   <small>${source === 'arome' ? 'AROME puis ARPEGE ne prévoient qu’à 4 jours environ. ' : ''}Choisissez un autre modèle ci-dessus.</small>`
                : `<p>${label} ne répond pas pour le moment</p>
                   <small>Les autres modèles restent affichés ci-dessus.</small>
                   <button class="btn-more" onclick="App.refreshData()">Réessayer</button>`;
            return `
                <section class="day-section" data-day="${day}" id="day-${day}">
                    ${dayHeaderHtml}
                    ${verdictHtml}
                    <div class="day-detail" data-source="${source}">
                        <div class="no-data-message">${message}</div>
                    </div>
                </section>
            `;
        }

        // En tête du détail : le modèle dont on voit les heures, et pourquoi si ce n'est pas celui choisi
        const chosen = this.state.globalSource;
        const sourceLine = `<p class="detail-source">Heures selon <strong>${Components.sourceLabel(source, summaries[source])}</strong>${
            source !== chosen ? ` · ${Components.sourceLabel(chosen)} ne prévoit pas si loin` : ''}</p>`;

        // Préparer les données
        let displayEntries;
        let hourlyEntries = []; // Toutes les heures du jour, pour le toggle des jours suivants

        if (isToday) {
            const nowMs = new Date().getTime();
            displayEntries = dayEntries.filter(e => e.hourly && Utils.parseTime(e.time).getTime() >= nowMs - 3600000);
        } else {
            // Les 4 périodes (6h) ; un pas sans données (fin d'horizon de la source) n'a pas de carte
            displayEntries = dayEntries
                .filter(e => e.sixHourly && e.sixHourly.tempMax !== null && Utils.parseTime(e.time).getUTCHours() % 6 === 0)
                .slice(0, 4);
            // ET toutes les heures (pour le toggle), si la source en a pour ce jour
            hourlyEntries = dayEntries.filter(e => e.hourly && e.hourly.temp !== null);
        }

        if (!displayEntries.length) return '';

        const preparedEntries = displayEntries.map(e => DataNormalizer.prepareEntry(e, isToday));
        const preparedHourlyEntries = hourlyEntries.map(e => DataNormalizer.prepareEntry(e, true));

        // Déterminer si on peut afficher un graphique pour ce jour
        const dayIndex = this.state.days.indexOf(day);
        const chartAvailability = Utils.getChartDataAvailability(day, hourlyData, sixHourlyData);
        const showChart = CONFIG.charts.maxDays > 0
            && dayIndex < CONFIG.charts.maxDays
            && chartAvailability.type !== 'none';

        let contentHtml;
        if (showChart) {
            // Afficher le graphique
            contentHtml = Components.ChartSection(day, pointData.point.key);

            if (!isToday && preparedHourlyEntries.length > 0) {
                // Jours avec données hourly : afficher périodes par défaut + hourly caché avec toggle
                contentHtml += Components.CardsGridTomorrow(preparedEntries, preparedHourlyEntries, day);
            } else {
                contentHtml += Components.CardsGrid(preparedEntries, isToday);
            }
        } else {
            // Pas de graphique, seulement les cartes (libellés horaires pour aujourd'hui)
            contentHtml = Components.CardsGrid(preparedEntries, isToday);
        }

        return `
            <section class="day-section" data-day="${day}" id="day-${day}">
                ${dayHeaderHtml}
                ${verdictHtml}
                <div class="day-detail" data-source="${source}">${sourceLine}${contentHtml}</div>
            </section>
        `;
    },

    // Un autre point que le point affiché : un voisin préparé hors écran (balayage)
    renderCharts(pointKey = this.state.currentPoint) {
        const data = DataService.state.data;
        const pointData = data[pointKey];

        // Déterminer quels jours ont besoin d'un graphique
        const daysToRender = Utils.isMobile() ? [this.state.currentDay] : this.state.days;

        daysToRender.forEach((day, dayIndex) => {
            // Vérifier si on dépasse le nombre max de jours avec graphique
            if (CONFIG.charts.maxDays === 0 || dayIndex >= CONFIG.charts.maxDays) return;

            // Même modèle que le détail de ce jour (relais au-delà de l'horizon du modèle choisi)
            const { summaries } = DataNormalizer.dayVerdict(pointData, day);
            const sourceData = this.getSourceData(pointData, this.daySource(pointData, summaries));

            const chartAvailability = Utils.getChartDataAvailability(day, sourceData.hourly, sourceData.sixHourly);

            // Ne pas rendre si pas assez de données
            if (chartAvailability.type === 'none') return;

            this.renderChartForDay(day, chartAvailability.type, sourceData, pointKey);
        });
    },

    renderChartForDay(day, dataType, sourceData, pointKey = this.state.currentPoint) {
        const chartData = DataNormalizer.toChartData(day, sourceData, dataType);
        if (chartData.length < 2) return;

        const isDark = this.state.theme === 'dark';
        const chartIdPrefix = `chart-${day}-${pointKey}`;

        // Formater les données pour ApexCharts
        const formattedData = {
            temp: chartData.map(d => [d.time, d.temp]),
            feels: chartData.map(d => [d.time, d.apparent_temperature || d.temp]),
            speed: chartData.map(d => [d.time, Utils.msToKmh(d.windSpeed)]),
            gusts: chartData.map(d => [d.time, Utils.msToKmh(d.wind_gusts || d.windSpeed)]),
            snow: chartData.map(d => [d.time, d.snow || 0]),
            rain: chartData.map(d => [d.time, d.rain || 0]),
            uv: chartData.map(d => [d.time, d.uv_index || 0])
        };

        // Construire la map icône par heure pour les annotations du graphique
        const iconByHour = {};
        chartData.forEach(d => {
            const date = new Date(d.time);
            const hh = String(date.getHours()).padStart(2, '0');
            const mm = String(date.getMinutes()).padStart(2, '0');
            iconByHour[`${hh}:${mm}`] = d.icon;
        });

        // Ressenti et rafales : seulement en horaire, et si la source les fournit (pas MET.no)
        const hasExtendedData = sourceData.extended && dataType === 'hourly';
        if (document.getElementById(`${chartIdPrefix}-unified`)) {
            Charts.createUnifiedChart(`${chartIdPrefix}-unified`, formattedData, isDark, hasExtendedData, iconByHour,
                this.sharedChartScales(day, dataType, pointKey), this.state.chartDetails);
        }
    },

    // Échelles communes aux modèles d'un jour : passer d'une case à l'autre ne change pas les axes,
    // une heure à 1 cm a la même hauteur chez les trois. Températures et vent : tous les modèles.
    // Neige et pluie : seulement ceux tracés au même pas (une barre de 6 h cumule six heures).
    sharedChartScales(day, dataType, pointKey = this.state.currentPoint) {
        const pointData = DataService.state.data[pointKey];
        const temps = [], winds = [], snows = [], rains = [];
        for (const src of Object.values(pointData.sources)) {
            const type = Utils.getChartDataAvailability(day, src.hourly, src.sixHourly).type;
            if (type === 'none') continue;
            // Ressenti et rafales comptent seulement s'ils sont affichés : sinon, du vide en haut
            const extended = src.extended && type === 'hourly' && this.state.chartDetails;
            DataNormalizer.toChartData(day, src, type).forEach(d => {
                if (d.temp !== null && d.temp !== undefined) temps.push(d.temp);
                if (extended && d.apparent_temperature != null) temps.push(d.apparent_temperature);
                if (d.windSpeed != null) winds.push(Utils.msToKmh(d.windSpeed));
                if (extended && d.wind_gusts != null) winds.push(Utils.msToKmh(d.wind_gusts));
                if (type === dataType) {
                    snows.push(d.snow || 0);
                    rains.push(d.rain || 0);
                }
            });
        }
        if (!temps.length) return null;
        return {
            tempMin: Math.min(...temps), tempMax: Math.max(...temps),
            windMax: winds.length ? Math.max(...winds) : 0,
            snowMax: snows.length ? Math.max(...snows) : 0,
            rainMax: rains.length ? Math.max(...rains) : 0
        };
    },

    // === Feuille des points (ouverte depuis le titre) ===
    // Deux groupes : le domaine trié par altitude, puis les points personnels dans leur ordre.
    // Chaque ligne donne le verdict du jour affiché. Ajout, suppression et ordre se gèrent ici.

    _pointsEditing: false,

    openPointSheet() {
        if (document.getElementById('point-sheet')) return;
        this._pointsEditing = false;
        const root = document.createElement('div');
        root.id = 'point-sheet';
        root.className = 'sheet-root';
        root.addEventListener('keydown', e => this.onPointSheetKey(e));
        document.body.appendChild(root);
        this.renderPointSheet();
        document.getElementById('point-title').setAttribute('aria-expanded', 'true');
        (root.querySelector('.sheet-row[aria-current="true"]') || root.querySelector('.sheet-close'))?.focus();
    },

    closePointSheet() {
        const root = document.getElementById('point-sheet');
        if (!root) return;
        root.remove();
        const title = document.getElementById('point-title');
        title.setAttribute('aria-expanded', 'false');
        title.focus();
    },

    // Re-rendu si la feuille est ouverte (un point vient de finir de charger, un point a changé)
    refreshPointSheet() {
        if (document.getElementById('point-sheet')) this.renderPointSheet();
        this.updateTopBar();
    },

    renderPointSheet() {
        const root = document.getElementById('point-sheet');
        const hadFocus = root.contains(document.activeElement);
        const focusedKey = document.activeElement?.closest?.('#point-sheet [data-focus-key]')?.dataset.focusKey;
        const data = DataService.state.data;
        const day = this.state.currentDay;
        const elevationOf = p => data[p.key]?.elevation ?? null;

        // Verdict court du jour pour un point (s'il est chargé)
        const verdictHtml = point => {
            const pointData = data[point.key];
            if (!pointData) {
                return DataService.state.failed[point.key]
                    ? '<span class="sheet-row-verdict is-loading">Indisponible</span>'
                    : '<span class="sheet-row-verdict is-loading">Chargement…</span>';
            }
            const { verdict } = DataNormalizer.dayVerdict(pointData, day);
            if (!verdict) return '<span class="sheet-row-verdict">—</span>';
            const { prefix, value, unit } = Components.verdictValue(verdict);
            const icon = { snow: 'snowflake', rain: 'cloud-rain', dry: 'sun' }[verdict.mode];
            return `<span class="sheet-row-verdict is-${verdict.mode}"><i data-lucide="${icon}"></i>${prefix ? `${prefix} ` : ''}${value} ${unit}</span>`;
        };

        const row = point => {
            const elevation = elevationOf(point);
            const current = point.key === this.state.currentPoint;
            return `
                <button class="sheet-row" data-focus-key="row-${point.key}" aria-current="${current}" onclick="App.choosePoint('${point.key}')">
                    <span class="point-dot" style="--point-color: ${point.color}"></span>
                    <span class="sheet-row-name">${Utils.escapeHtml(point.name)}</span>
                    <span class="sheet-row-alt">${elevation ? `${Math.round(elevation)} m` : ''}</span>
                    ${verdictHtml(point)}
                </button>`;
        };

        const customs = CONFIG.points.filter(p => p.custom);
        const editRow = (point, i) => `
            <div class="sheet-row sheet-row-edit">
                <span class="point-dot" style="--point-color: ${point.color}"></span>
                <span class="sheet-row-name">${Utils.escapeHtml(point.name)}</span>
                <span class="sheet-row-actions">
                    <button class="sheet-icon-btn" data-focus-key="up-${point.key}" onclick="App.movePoint('${point.key}', -1)" aria-label="Monter ${Utils.escapeHtml(point.name)}" ${i === 0 ? 'disabled' : ''}><i data-lucide="arrow-up"></i></button>
                    <button class="sheet-icon-btn" data-focus-key="down-${point.key}" onclick="App.movePoint('${point.key}', 1)" aria-label="Descendre ${Utils.escapeHtml(point.name)}" ${i === customs.length - 1 ? 'disabled' : ''}><i data-lucide="arrow-down"></i></button>
                    <button class="sheet-icon-btn is-danger" onclick="App.confirmDeletePoint('${point.key}')" aria-label="Supprimer ${Utils.escapeHtml(point.name)}"><i data-lucide="trash-2"></i></button>
                </span>
            </div>`;

        // Domaine : du plus bas au plus haut, dans l'ordre du balayage (fixe : ne bouge pas pendant
        // que les points chargent)
        const domain = CONFIG.domain.map(key => CONFIG.points.find(p => p.key === key));
        const canAdd = CustomPoints.getSaved().length < CustomPoints.MAX_CUSTOM;
        const dayLabel = Utils.formatDateShort(day);

        root.innerHTML = `
            <div class="sheet-backdrop" onclick="App.closePointSheet()"></div>
            <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
                <div class="sheet-header">
                    <h2 id="sheet-title">Choisir un point</h2>
                    <span class="sheet-day">${dayLabel}</span>
                    <button class="sheet-close" data-focus-key="close" onclick="App.closePointSheet()" aria-label="Fermer"><i data-lucide="x"></i></button>
                </div>
                <section class="sheet-group" aria-labelledby="sheet-domain">
                    <h3 id="sheet-domain">La Foux d’Allos</h3>
                    ${domain.map(row).join('')}
                </section>
                <section class="sheet-group" aria-labelledby="sheet-mine">
                    <div class="sheet-group-head">
                        <h3 id="sheet-mine">Mes points</h3>
                        ${customs.length ? `<button class="sheet-edit" data-focus-key="edit" onclick="App.togglePointsEdit()">${this._pointsEditing ? 'Terminé' : 'Modifier'}</button>` : ''}
                    </div>
                    ${this._pointsEditing ? customs.map(editRow).join('') : customs.map(row).join('')}
                    ${!customs.length ? '<p class="sheet-empty">Ajoutez un endroit qui vous intéresse, même hors de la station.</p>' : ''}
                    ${canAdd ? `<button class="sheet-add" data-focus-key="add" onclick="App.addPointFromSheet()"><i data-lucide="plus"></i>Ajouter un point</button>` : ''}
                </section>
            </div>`;
        lucide.createIcons();
        // Le focus reste dans la feuille après un re-rendu (sinon Échap et le piège de Tab ne marchent
        // plus) : même bouton si possible, sinon "Modifier"/"Terminé", sinon "Fermer"
        // (bouton supprimé, ou flèche devenue inactive en bout de liste)
        if (hadFocus) {
            const usable = el => el && !el.disabled ? el : null;
            (usable(focusedKey && root.querySelector(`[data-focus-key="${focusedKey}"]`))
                || root.querySelector('[data-focus-key="edit"]')
                || root.querySelector('.sheet-close'))?.focus();
        }
    },

    // Échap ferme ; Tab reste dans la feuille
    onPointSheetKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            this.closePointSheet();
            return;
        }
        if (e.key !== 'Tab') return;
        const focusables = [...document.querySelectorAll('#point-sheet .sheet button:not([disabled])')];
        if (!focusables.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    },

    async choosePoint(key) {
        this.closePointSheet();
        if (key !== this.state.currentPoint) await this.selectPoint(key);
    },

    togglePointsEdit() {
        this._pointsEditing = !this._pointsEditing;
        this.renderPointSheet();
    },

    // Déplace un point personnel d'un cran parmi les points personnels
    movePoint(key, direction) {
        const customs = CONFIG.points.filter(p => p.custom);
        const i = customs.findIndex(p => p.key === key);
        const j = i + direction;
        if (i < 0 || j < 0 || j >= customs.length) return;
        // Échange sur place : la position des points du domaine (et donc le point affiché au
        // démarrage, le premier de la liste) ne bouge pas
        const a = CONFIG.points.indexOf(customs[i]), b = CONFIG.points.indexOf(customs[j]);
        [CONFIG.points[a], CONFIG.points[b]] = [CONFIG.points[b], CONFIG.points[a]];
        CustomPoints.saveOrder(CONFIG.points.map(p => p.key));
        this.renderPointSheet();
        // L'ordre des points perso est celui du balayage : pastilles du titre et voisins le suivent
        this.updateTopBar();
        this.scheduleNeighbors();
    },

    addPointFromSheet() {
        this.closePointSheet();
        this.openAddPointModal();
    },

    // === Custom Points Modal ===

    _leafletLoaded: false,
    _mapInstance: null,
    _mapMarker: null,

    async loadLeaflet() {
        if (this._leafletLoaded) return;
        // CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
        // JS
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
        this._leafletLoaded = true;
    },

    async openAddPointModal() {
        // Injecter le modal
        const modal = document.createElement('div');
        modal.id = 'add-point-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Ajouter un point</h3>
                    <button class="modal-close" onclick="App.closeAddPointModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="modal-field place-field">
                        <label for="place-search">Lieu ou adresse</label>
                        <input type="text" id="place-search" placeholder="Ex : Mont Pelat, 12 rue de la Paix Paris" autocomplete="off" enterkeyhint="search"
                            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="place-results"
                            oninput="App.onPlaceInput()" onkeydown="App.onPlaceKey(event)" onblur="App.renderPlaceResults([])">
                        <ul id="place-results" class="place-results" role="listbox" aria-label="Suggestions" hidden></ul>
                    </div>
                    <div class="modal-field">
                        <label for="point-name">Nom</label>
                        <input type="text" id="point-name" placeholder="Ex: Marseille, Col du Lautaret..." maxlength="30" autocomplete="off">
                    </div>
                    <div id="modal-map" class="modal-map"></div>
                    <div class="modal-coords" id="modal-coords">
                        Cliquez sur la carte pour placer un point
                    </div>
                    <div class="modal-error" id="modal-error"></div>
                    <div class="modal-gps-toggle">
                        <button class="btn-gps-toggle" onclick="App.toggleManualGPS()">&#9654; Saisie manuelle GPS</button>
                    </div>
                    <div class="modal-gps-fields" id="modal-gps-fields" style="display:none">
                        <div class="modal-field modal-field-inline">
                            <label for="point-lat">Lat</label>
                            <input type="number" id="point-lat" step="0.0001" min="41.3" max="51.1" placeholder="44.2902">
                        </div>
                        <div class="modal-field modal-field-inline">
                            <label for="point-lon">Lon</label>
                            <input type="number" id="point-lon" step="0.0001" min="-5.2" max="9.6" placeholder="6.5689">
                        </div>
                        <button class="btn-gps-apply" onclick="App.applyManualGPS()">Appliquer</button>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-cancel" onclick="App.closeAddPointModal()">Annuler</button>
                    <button class="modal-btn modal-btn-confirm" id="modal-btn-add" onclick="App.confirmAddPoint()" disabled>Ajouter</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Listener sur le nom pour activer/désactiver le bouton
        document.getElementById('point-name').addEventListener('input', () => {
            const name = document.getElementById('point-name').value.trim();
            document.getElementById('modal-btn-add').disabled = !name || !this._mapMarker;
        });

        // Charger Leaflet puis initialiser la carte
        try {
            await this.loadLeaflet();
            this.initMap();
        } catch (e) {
            console.error('Erreur chargement Leaflet:', e);
            document.getElementById('modal-map').innerHTML = '<p style="text-align:center;color:var(--muted);padding:2rem">Erreur de chargement de la carte</p>';
        }
    },

    initMap() {
        const map = L.map('modal-map', {
            maxBounds: L.latLngBounds([41.3, -5.2], [51.1, 9.6]),
            maxBoundsViscosity: 1.0
        }).setView([44.29, 6.57], 7);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OSM',
            maxZoom: 15
        }).addTo(map);

        // Afficher les points existants comme cercles
        CONFIG.points.forEach(p => {
            L.circleMarker([p.lat, p.lon], {
                radius: 6, color: p.color, fillColor: p.color, fillOpacity: 0.7, weight: 2
            }).addTo(map).bindTooltip(p.name, { permanent: false });
        });

        // Clic pour placer le marqueur
        map.on('click', (e) => {
            const { lat, lng } = e.latlng;
            if (!CustomPoints.isInFrance(lat, lng)) {
                document.getElementById('modal-error').textContent = 'Ce point est hors de la France métropolitaine';
                return;
            }
            document.getElementById('modal-error').textContent = '';
            this.placeMarker(map, lat, lng);
        });

        this._mapInstance = map;

        // Fix: Leaflet a besoin d'un invalidateSize après affichage
        setTimeout(() => map.invalidateSize(), 200);
    },

    placeMarker(map, lat, lng) {
        if (this._mapMarker) {
            this._mapMarker.setLatLng([lat, lng]);
        } else {
            this._mapMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
            this._mapMarker.on('dragend', () => {
                const pos = this._mapMarker.getLatLng();
                if (!CustomPoints.isInFrance(pos.lat, pos.lng)) {
                    document.getElementById('modal-error').textContent = 'Ce point est hors de la France métropolitaine';
                    // Replacer au dernier emplacement valide
                    this._mapMarker.setLatLng([this._lastValidLat, this._lastValidLng]);
                    return;
                }
                document.getElementById('modal-error').textContent = '';
                this._lastValidLat = pos.lat;
                this._lastValidLng = pos.lng;
                this.updateCoordsDisplay(pos.lat, pos.lng);
            });
        }
        this._lastValidLat = lat;
        this._lastValidLng = lng;
        this.updateCoordsDisplay(lat, lng);
    },

    updateCoordsDisplay(lat, lng) {
        document.getElementById('modal-coords').textContent = `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
        // Activer/désactiver le bouton
        const name = document.getElementById('point-name')?.value.trim();
        document.getElementById('modal-btn-add').disabled = !name;
    },

    // === Recherche d'un lieu (géocodage IGN Géoplateforme : gratuit, sans clé, France seule) ===

    _placeTimer: null,
    _placeAbort: null,
    _placeResults: [],
    _placeActive: -1,
    _autoName: '',  // dernier nom pré-rempli : remplacé au choix suivant, pas un nom tapé à la main

    onPlaceInput() {
        clearTimeout(this._placeTimer);
        this._placeAbort?.abort();  // une réponse en retard ne doit pas rouvrir la liste
        const text = document.getElementById('place-search').value.trim();
        if (text.length < 3) { this.renderPlaceResults([]); return; }
        this._placeTimer = setTimeout(() => this.searchPlace(text), 250);
    },

    async searchPlace(text) {
        this._placeAbort = new AbortController();
        try {
            const url = 'https://data.geopf.fr/geocodage/completion?maximumResponses=10&text=' + encodeURIComponent(text);
            const res = await fetch(url, { signal: this._placeAbort.signal });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const seen = new Set();
            const results = ((await res.json()).results || []).filter(r => {
                // Une commune revient deux fois (« administratif » et « municipality ») : un seul suffit
                const id = r.fulltext.split(', ')[0] + '|' + this.placeKind(r) + '|' + r.zipcode;
                if (seen.has(id) || !CustomPoints.isInFrance(r.y, r.x)) return false;
                seen.add(id);
                return true;
            }).slice(0, 6);
            this.renderPlaceResults(results, 'Aucun lieu trouvé');
        } catch (e) {
            if (e.name !== 'AbortError') this.renderPlaceResults([], 'Recherche indisponible pour le moment');
        }
    },

    // Catégorie affichée : celle de l'IGN quand elle est en français (sommet, refuge, lieu-dit habité…)
    placeKind(r) {
        const kinds = { housenumber: 'adresse', street: 'voie', municipality: 'commune', administratif: 'commune', locality: 'lieu-dit' };
        return kinds[r.kind] || r.kind || '';
    },

    renderPlaceResults(results, message = '') {
        const list = document.getElementById('place-results');
        const input = document.getElementById('place-search');
        if (!list) return;  // modale fermée entre-temps
        this._placeResults = results;
        this._placeActive = -1;
        input.removeAttribute('aria-activedescendant');
        list.innerHTML = results.map((r, i) => {
            const [title, ...rest] = r.fulltext.split(', ');
            const meta = [this.placeKind(r), rest.join(', ')].filter(Boolean).join(' · ');
            return `<li id="place-opt-${i}" role="option" aria-selected="false" onmousedown="event.preventDefault()" onclick="App.choosePlace(${i})">
                <span class="place-name">${Utils.escapeHtml(title)}</span>
                <span class="place-meta">${Utils.escapeHtml(meta)}</span>
            </li>`;
        }).join('') || (message ? `<li class="place-message" role="presentation">${message}</li>` : '');
        // Licence Ouverte de l'IGN : citer la source
        if (results.length) list.innerHTML += '<li class="place-source" role="presentation">Source : IGN</li>';
        list.hidden = !list.innerHTML;
        input.setAttribute('aria-expanded', String(results.length > 0));
    },

    onPlaceKey(e) {
        const n = this._placeResults.length;
        if (e.key === 'Escape') {
            this.renderPlaceResults([]);
        } else if (e.key === 'Enter') {
            // Une suggestion surlignée aux flèches est choisie ; sinon (touche « Rechercher » du
            // clavier mobile) la recherche part tout de suite, même liste fermée après un choix
            e.preventDefault();
            if (this._placeActive >= 0) { this.choosePlace(this._placeActive); return; }
            const text = e.target.value.trim();
            if (text.length < 3) return;
            clearTimeout(this._placeTimer);
            this._placeAbort?.abort();
            this.searchPlace(text);
        } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
            e.preventDefault();
            let a = this._placeActive + (e.key === 'ArrowDown' ? 1 : -1);
            if (a < 0) a = n - 1;
            if (a >= n) a = 0;
            this._placeActive = a;
            document.querySelectorAll('#place-results [role="option"]').forEach((el, k) => el.setAttribute('aria-selected', String(k === a)));
            document.getElementById('place-search').setAttribute('aria-activedescendant', `place-opt-${a}`);
            document.getElementById(`place-opt-${a}`).scrollIntoView({ block: 'nearest' });
        }
    },

    choosePlace(i) {
        const r = this._placeResults[i];
        if (!r) return;
        const input = document.getElementById('place-search');
        input.value = r.fulltext;
        input.blur();  // ferme le clavier mobile (le choix a gardé le focus dans le champ)
        this.renderPlaceResults([]);
        const nameInput = document.getElementById('point-name');
        if (!nameInput.value.trim() || nameInput.value === this._autoName) {
            nameInput.value = this._autoName = r.fulltext.split(', ')[0].slice(0, 30);
        }
        document.getElementById('modal-error').textContent = '';
        if (this._mapInstance) {
            this._mapInstance.setView([r.y, r.x], 13);
            this.placeMarker(this._mapInstance, r.y, r.x);  // active « Ajouter » : le nom est déjà rempli
        }
    },

    closeAddPointModal() {
        clearTimeout(this._placeTimer);
        this._placeAbort?.abort();
        this._autoName = '';
        if (this._mapInstance) {
            this._mapInstance.remove();
            this._mapInstance = null;
        }
        this._mapMarker = null;
        document.getElementById('add-point-modal')?.remove();
    },

    toggleManualGPS() {
        const fields = document.getElementById('modal-gps-fields');
        const btn = document.querySelector('.btn-gps-toggle');
        if (fields.style.display === 'none') {
            fields.style.display = '';
            btn.innerHTML = '&#9660; Saisie manuelle GPS';
        } else {
            fields.style.display = 'none';
            btn.innerHTML = '&#9654; Saisie manuelle GPS';
        }
    },

    applyManualGPS() {
        const lat = parseFloat(document.getElementById('point-lat').value);
        const lon = parseFloat(document.getElementById('point-lon').value);
        if (isNaN(lat) || isNaN(lon)) {
            document.getElementById('modal-error').textContent = 'Coordonnées invalides';
            return;
        }
        if (!CustomPoints.isInFrance(lat, lon)) {
            document.getElementById('modal-error').textContent = 'Ce point est hors de la France métropolitaine';
            return;
        }
        document.getElementById('modal-error').textContent = '';
        if (this._mapInstance) {
            this._mapInstance.setView([lat, lon], 10);
            this.placeMarker(this._mapInstance, lat, lon);
        }
    },

    async confirmAddPoint() {
        const name = document.getElementById('point-name')?.value.trim();
        if (!name) { document.getElementById('modal-error').textContent = 'Veuillez saisir un nom'; return; }
        if (!this._mapMarker) { document.getElementById('modal-error').textContent = 'Veuillez placer un point sur la carte'; return; }

        const pos = this._mapMarker.getLatLng();
        const result = CustomPoints.add(name, pos.lat, pos.lng);
        if (result.error) {
            document.getElementById('modal-error').textContent = result.error;
            return;
        }

        // Désactiver le bouton pendant le chargement
        const btn = document.getElementById('modal-btn-add');
        btn.disabled = true;
        btn.textContent = 'Chargement...';

        try {
            await DataService.loadSinglePoint(result.point);
            this.closeAddPointModal();
            this.state.currentPoint = result.point.key;
            localStorage.setItem('fmeteo_point', result.point.key);
            this.renderNavigation();
            this.render();
        } catch (e) {
            console.error('Erreur chargement point:', e);
            document.getElementById('modal-error').textContent = 'Erreur de chargement des données';
            btn.disabled = false;
            btn.textContent = 'Ajouter';
            // Rollback
            CustomPoints.remove(result.point.key);
        }
    },

    confirmDeletePoint(key) {
        const point = CONFIG.points.find(p => p.key === key);
        if (!point || !confirm(`Supprimer le point "${point.name}" ?`)) return;

        CustomPoints.remove(key);

        // Si on regarde le point supprimé, basculer sur le premier
        if (this.state.currentPoint === key) {
            this.state.currentPoint = CONFIG.points[0].key;
            localStorage.setItem('fmeteo_point', this.state.currentPoint);
        }

        this.renderNavigation();
        this.render();
        this.refreshPointSheet();
    },

    // Bouton "?" du verdict : déplie l'explication des trois modèles. L'état survit aux rendus
    // (choisir un modèle redessine la page) ; sur ordinateur, les autres jours suivent au prochain rendu
    toggleModelsHelp(btn) {
        this.state.modelsHelpOpen = !this.state.modelsHelpOpen;
        btn.setAttribute('aria-expanded', String(this.state.modelsHelpOpen));
        btn.closest('.verdict').querySelector('.verdict-help').hidden = !this.state.modelsHelpOpen;
        this.scheduleNeighbors();
    },

    // "Plus de détails" : ressenti, rafales et UV, pour tous les graphiques (séries et axes changent : on les refait)
    toggleChartDetails(btn) {
        this.state.chartDetails = !this.state.chartDetails;
        const day = btn.closest('.day-section')?.dataset.day;
        Charts.destroyAll();
        this.renderCharts();
        // La clé est régénérée : le focus revient sur le bouton du même jour
        document.querySelector(`.day-section[data-day="${day}"] .chart-details-btn`)?.focus({ preventScroll: true });
        this.scheduleNeighbors();
    },

    toggleMore(btn) {
        const block = btn.closest('.cards-grid');
        const hiddenCards = block.querySelectorAll('.hidden-card');
        const visibleExtraCards = block.querySelectorAll('.card.was-hidden');

        if (hiddenCards.length > 0) {
            // Déplier : montrer les cartes cachées
            hiddenCards.forEach(card => {
                card.classList.remove('hidden-card');
                card.classList.add('was-hidden');
            });
            btn.textContent = 'Replier les heures';
            this.state.todayHoursExpanded = true;
            block.querySelector('.rows').setAttribute('style', Components.rowsCount(block.querySelectorAll('.card').length));
        } else {
            // Replier : cacher les cartes qui étaient cachées
            visibleExtraCards.forEach(card => {
                card.classList.add('hidden-card');
                card.classList.remove('was-hidden');
            });
            const count = block.querySelectorAll('.hidden-card').length;
            btn.textContent = `Voir heures suivantes (${count}+)`;
            this.state.todayHoursExpanded = false;
            block.querySelector('.rows').setAttribute('style', Components.rowsCount(block.querySelectorAll('.card:not(.hidden-card)').length));
        }
        this.scheduleNeighbors();
    },

    toggleTomorrowView(btn, day) {
        const block = btn.closest('.cards-grid-tomorrow');
        const periodsGrid = block.querySelector('.grid-periods');
        const hourlyGrid = block.querySelector('.grid-hourly');

        const isShowingPeriods = periodsGrid.style.display !== 'none';

        if (isShowingPeriods) {
            // Basculer vers les heures
            periodsGrid.style.display = 'none';
            hourlyGrid.style.display = '';
            btn.textContent = 'Replier les heures';
            this.state.expandedDays.add(day);
        } else {
            // Basculer vers les périodes
            periodsGrid.style.display = '';
            hourlyGrid.style.display = 'none';
            const hourlyCount = hourlyGrid.querySelectorAll('.card').length;
            btn.textContent = `Voir toutes les heures (${hourlyCount})`;
            this.state.expandedDays.delete(day);
        }

        // Recréer les icônes Lucide pour les nouvelles cartes visibles
        lucide.createIcons();
        this.scheduleNeighbors();
    }
};

// Composants UI
const Components = {
    // Squelette de chargement : partials/skeleton.html, repris du <template> d'index.php (une seule
    // source pour le démarrage, le rafraîchissement et un point pas encore chargé)
    Skeleton() {
        return document.getElementById('skeleton-template').innerHTML;
    },

    // Format d'une quantité du verdict : cm de neige arrondis, mm de pluie au dixième
    verdictAmount(mode, v) {
        return mode === 'snow' ? String(Math.round(v)) : v.toFixed(1).replace('.', ',');
    },

    // Le gros chiffre du verdict : fourchette entre modèles de la grandeur qui décide de la journée
    // (températures un jour sec). Quand le plus faible est à zéro, "jusqu'à 18" plutôt que "0 à 18",
    // sauf si les modèles se contredisent : "0 à 17" montre alors les deux bouts
    // (prefix, à afficher avant value)
    verdictValue(verdict) {
        const deg = n => String(Math.round(n)).replace('-', '−');
        const { mode, range, basis } = verdict;
        if (mode === 'dry') return { prefix: '', value: `${deg(range.lo)} à ${deg(range.hi)}`, unit: '°C' };
        const lo = this.verdictAmount(mode, range.lo), hi = this.verdictAmount(mode, range.hi);
        const unit = mode === 'snow' ? 'cm' : 'mm';
        if (basis.length === 1 || lo === hi) return { prefix: '', value: hi, unit };
        const loIsZero = Number(lo.replace(',', '.')) === 0;
        if (loIsZero && !verdict.contradict) return { prefix: 'jusqu’à', value: hi, unit };
        return { prefix: '', value: `${loIsZero ? '0' : lo} à ${hi}`, unit };  // "0 à 26,8", pas "0,0 à 26,8"
    },

    // Bloc verdict en tête du jour : la grandeur qui décide de la journée selon les modèles,
    // puis une case par modèle (preuve du verdict et choix du modèle affiché en détail).
    // verdict = DataNormalizer.computeVerdict(), summaries = { source: daySummary | null },
    // available = sources présentes dans la réponse du proxy (une absente n'a pas répondu)
    // Nom d'une source pour un jour. La source "arome" est la chaîne Météo-France : AROME jusque
    // vers J+2, puis ARPEGE ; elle porte le nom du modèle qui a vraiment servi ce jour-là.
    // "openmeteo" (best_match) prend le nom d'ICON-D2 les jours où il le recopie (best_match_model)
    sourceLabel(key, summary) {
        const MODEL_LABELS = {
            arome: {
                meteofrance_arome_france_hd: 'AROME',
                meteofrance_arome_france: 'AROME',
                meteofrance_arpege_seamless: 'ARPEGE',
                meteofrance_seamless: 'Météo-France'
            },
            openmeteo: { icon_d2: 'ICON-D2' }
        };
        const SOURCE_LABELS = { openmeteo: 'Open-Meteo', arome: 'AROME', metno: 'MET.no' };
        return MODEL_LABELS[key]?.[summary?.model] || SOURCE_LABELS[key];
    },

    Verdict(verdict, summaries, selected, available) {
        if (!verdict) return '';
        const LABELS = {};
        // Ordre des cases : AROME d'abord, le modèle affiché par défaut
        for (const key of ['arome', 'openmeteo', 'metno']) LABELS[key] = this.sourceLabel(key, summaries[key]);
        const dec = n => n.toFixed(1).replace('.', ',');
        const deg = n => String(Math.round(n)).replace('-', '−');
        const hourLabel = (ms, isEnd) => {
            const h = new Date(ms).getHours();
            return `${isEnd && h === 0 ? 24 : h}h`;
        };
        const { mode, range, basis } = verdict;
        const { prefix, value, unit } = this.verdictValue(verdict);

        let what;
        if (mode === 'dry') {
            const cc = verdict.cloudCover;
            what = cc === null ? 'Sec' : `Sec, ${cc < 35 ? 'ensoleillé' : cc < 70 ? 'avec des éclaircies' : 'plutôt nuageux'}`;
        } else {
            const quality = { wet: ' humide', dry: ' sèche' }[verdict.snowQuality] || '';
            what = mode === 'snow' ? `de neige${quality}${verdict.alsoRain ? ', et de la pluie' : ''}` : 'de pluie';
        }
        // Affiché d'un bloc avec le « ? » (.nowrap) : la phrase se coupe après la virgule, jamais avant le « ? »
        const by = basis.length === 1 ? `selon ${LABELS[basis[0]]} seulement` : `selon les ${basis.length} modèles`;
        // Accord : une puce. Contradiction (0 contre 17 cm) : une alerte, la prévision est peu fiable.
        // Simple divergence : rien de plus, la fourchette et les cases juste en dessous la montrent déjà
        const agreeHtml = verdict.contradict
            ? '<span class="verdict-agree is-warn"><i data-lucide="triangle-alert"></i>Peu fiable : les modèles se contredisent</span>'
            : verdict.diverge === false
                ? '<span class="verdict-agree"><i data-lucide="check"></i>Les modèles s’accordent</span>' : '';
        const helpOpen = App.state.modelsHelpOpen;

        const facts = [];
        if (mode !== 'dry' && verdict.tempMin !== null) {
            facts.push(['thermometer', `${deg(verdict.tempMin)} à ${deg(verdict.tempMax)} °C`]);
        }
        if (mode === 'dry' && verdict.nightMin !== null) {
            facts.push(['moon', verdict.nightMin < 0 ? `Regel la nuit, jusqu’à ${deg(verdict.nightMin)} °C` : 'Pas de regel la nuit']);
        }
        if (mode === 'dry' && verdict.windMax !== null) {
            const kmh = Utils.msToKmh(verdict.windMax);
            facts.push(['wind', `Vent ${kmh < 20 ? 'faible' : kmh < 40 ? 'modéré' : 'fort'}, ${kmh} km/h au plus`]);
        }
        if (verdict.freezing.position) {
            // Isotherme 0 °C, en mots simples : l'altitude au-dessus de laquelle il gèle.
            // La conclusion d'abord (par rapport au point), les altitudes ensuite
            const pos = { above: 'plus haut que le point', below: 'plus bas que le point', around: 'à hauteur du point' }[verdict.freezing.position];
            const r10 = v => Math.round(v / 10) * 10;
            const lo = r10(verdict.freezing.min), hi = r10(verdict.freezing.max);
            facts.push(['thermometer-snowflake', `Limite du gel ${pos} (${lo === hi ? hi : `${lo}–${hi}`} m)`]);
        }

        const cells = Object.keys(LABELS).map(key => {
            const s = summaries[key];
            if (!s) {
                return `
                    <button class="model-cell is-${key}" disabled>
                        <span class="model-name">${LABELS[key]}</span>
                        <span class="model-value">—</span>
                        <span class="model-sub">${!available.includes(key) ? 'Ne répond pas'
                            : key === 'arome' ? 'Ne prévoit pas si loin' : 'Pas de prévision ce jour'}</span>
                    </button>`;
            }
            const amount = mode === 'snow' ? s.snow : s.rain;
            const valueHtml = mode === 'snow' ? `${dec(s.snow)} cm`
                : mode === 'rain' ? `${dec(s.rain)} mm`
                : `${deg(s.tempMin)}° à ${deg(s.tempMax)}°`;
            const barHtml = mode === 'dry' ? ''
                // Plafonnée à 100 % : une source partielle (hors fourchette) peut dépasser range.hi
                : `<span class="model-bar"><span style="width: ${range.hi > 0 ? Math.min(100, Math.max(3, Math.round(amount / range.hi * 100))) : 3}%"></span></span>`;
            const sub = s.period ? `${hourLabel(s.period.from, false)}–${hourLabel(s.period.to, true)} seulement`
                : s.sixHourly ? 'Toutes les 6 h'
                : mode === 'dry' ? (s.nightMin !== null ? `Nuit ${deg(s.nightMin)}°` : '')
                : `${deg(s.tempMin)}° à ${deg(s.tempMax)}°`;
            return `
                <button class="model-cell is-${key}" aria-pressed="${key === selected}" onclick="App.selectSource('${key}')">
                    <span class="model-name">${LABELS[key]}</span>
                    <span class="model-value">${valueHtml}</span>
                    ${barHtml}
                    <span class="model-sub">${sub}</span>
                </button>`;
        }).join('');

        return `
            <div class="verdict" data-mode="${mode}">
                <p class="verdict-main">${prefix ? `<span class="verdict-unit">${prefix}</span>` : ''}<span class="verdict-value">${value.replace(' à ', ' <span class="verdict-sep">à</span> ')}</span><span class="verdict-unit">${unit}</span></p>
                <p class="verdict-sub">
                    <span>${what}, <span class="nowrap">${by}<button class="verdict-help-btn" aria-expanded="${helpOpen}" aria-label="Qui sont ces modèles ?" title="Qui sont ces modèles ?" onclick="App.toggleModelsHelp(this)"><i data-lucide="circle-help"></i></button></span></span>
                    ${agreeHtml}
                </p>
                ${facts.length ? `<ul class="verdict-facts">${facts.map(([icon, text]) => `<li><i data-lucide="${icon}"></i>${text}</li>`).join('')}</ul>` : ''}
                <div class="verdict-models" role="group" aria-label="Modèle affiché en détail">${cells}</div>
                <div class="verdict-help"${helpOpen ? '' : ' hidden'}>
                    <p>Trois services de prévision, qui calculent chacun la météo à leur façon. Touchez une case pour voir ses heures en dessous.</p>
                    <ul>
                        <li><strong>AROME</strong> : Météo-France, le plus détaillé, sur environ 2 jours. Ensuite, son modèle plus large : <strong>ARPEGE</strong>.</li>
                        <li><strong>Open-Meteo</strong> : choisit lui-même ses modèles, sans dire lesquels. Quand il reprend tel quel le modèle allemand <strong>ICON-D2</strong>, la case porte ce nom.</li>
                        <li><strong>MET.no</strong> : l’institut météo norvégien. Heure par heure sur environ 2 jours, puis toutes les 6 h.</li>
                    </ul>
                </div>
            </div>
        `;
    },

    ChartSection(day, pointKey) {
        const chartIdPrefix = `chart-${day}-${pointKey}`;
        return `
            <div class="chart-wrapper chart-full">
                <div class="chart-head"></div>
                <div id="${chartIdPrefix}-unified" class="chart"></div>
            </div>
        `;
    },

    // Étiquette d'une carte de 6 h : la période et ses heures locales. Les pas sont calés sur l'heure
    // UTC (0/6/12/18 h) : "Matin" va de 7 à 13 h l'hiver, de 8 à 14 h l'été
    periodCardLabel(d) {
        const from = d.getHours(), to = (from + 6) % 24 || 24;
        return `${Utils.periodLabel(d.getUTCHours())} · ${from}–${to} h`;
    },

    // En-tête des colonnes d'une liste de bandes (les unités y sont, pas dans chaque bande).
    // Deux exemplaires : sur ordinateur la liste tient en deux colonnes, chacune a le sien
    rowsHead(isPeriod) {
        const head = extra => `<div class="rows-head${isPeriod ? ' is-period' : ''}${extra}" aria-hidden="true">
            ${isPeriod ? '' : '<span></span>'}<span></span><span class="col-temp">${isPeriod ? 'Min à max' : 'Temp.'}</span>
            <span>Neige, pluie</span><span class="col-num">Vent km/h</span><span class="col-num">Nuages</span>
        </div>`;
        return head('') + head(' is-second');
    },

    // Nombre de lignes de la grille sur ordinateur : l'en-tête + la moitié des bandes visibles,
    // pour que la liste se lise de haut en bas, colonne de gauche puis colonne de droite
    rowsCount(visible) {
        return `--n: ${Math.ceil(visible / 2) + 1}`;
    },

    CardsGrid(entries, isToday) {
        const visibleCount = Utils.visibleCardCount();
        const cardsHtml = entries.map((entry, index) => {
            const d = Utils.parseTime(entry.time);
            const label = isToday ? `${d.getHours()} h` : this.periodCardLabel(d);
            const cardData = DataNormalizer.toCardData(entry);
            const extraClass = (isToday && index >= visibleCount) ? 'hidden-card' : '';
            return this.WeatherCard(label, cardData, extraClass, !isToday);
        }).join('');

        const showMoreBtn = (isToday && entries.length > visibleCount)
            ? `<div class="show-more-wrapper">
                <button class="btn-more" onclick="App.toggleMore(this)">
                    Voir heures suivantes (${entries.length - visibleCount}+)
                </button>
               </div>`
            : '';

        return `
            <div class="cards-grid">
                <div class="rows" style="${this.rowsCount(isToday ? Math.min(visibleCount, entries.length) : entries.length)}">${this.rowsHead(!isToday)}${cardsHtml}</div>
                ${showMoreBtn}
            </div>
        `;
    },

    // Liste spéciale pour les jours suivants : périodes par défaut, toggle vers les heures
    CardsGridTomorrow(periodEntries, hourlyEntries, day) {
        const periodCardsHtml = periodEntries.map(entry => {
            const d = Utils.parseTime(entry.time);
            return this.WeatherCard(this.periodCardLabel(d), DataNormalizer.toCardData(entry), '', true);
        }).join('');

        const hourlyCardsHtml = hourlyEntries.map(entry => {
            const d = Utils.parseTime(entry.time);
            return this.WeatherCard(`${d.getHours()} h`, DataNormalizer.toCardData(entry), '', false);
        }).join('');

        return `
            <div class="cards-grid cards-grid-tomorrow" data-day="${day}">
                <div class="rows grid-periods" style="${this.rowsCount(periodEntries.length)}">${this.rowsHead(true)}${periodCardsHtml}</div>
                <div class="rows grid-hourly" style="display: none; ${this.rowsCount(hourlyEntries.length)}">${this.rowsHead(false)}${hourlyCardsHtml}</div>
                <div class="show-more-wrapper">
                    <button class="btn-more btn-toggle-tomorrow" onclick="App.toggleTomorrowView(this, '${day}')">
                        Voir toutes les heures (${hourlyEntries.length})
                    </button>
                </div>
            </div>
        `;
    },

    // Une bande : heure (ou période, au-dessus), icône, température, neige/pluie, vent, nuages
    WeatherCard(label, data, extraClass = '', isPeriod = false) {
        const { icon, temp, tempMin, tempMax, windDir, windSpeed, snow, rain, snowQuality, cloudCover } = data;

        const dec = n => n.toFixed(1).replace('.', ',');
        const deg = n => String(Math.round(n)).replace('-', '−');

        // Une heure : sa température. Un pas de 6 h : son minimum et son maximum
        const tempText = tempMin !== null && tempMax !== null
            ? (Math.round(tempMin) === Math.round(tempMax) ? `${deg(tempMax)}°` : `<span>${deg(tempMin)}° à</span> <span>${deg(tempMax)}°</span>`)
            : (temp !== null ? `${deg(temp)}°` : '--');

        let precipHtml = '';
        if (snow > 0) {
            // Même règle que la pluie : au dixième, "< 0,1" pour une trace
            const value = snow < 0.05 ? '<small>&lt; </small><strong>0,1</strong>' : `<strong>${dec(snow)}</strong>`;
            const quality = snowQuality === 'wet' ? 'humide' : snowQuality === 'dry' ? 'sèche' : '';
            precipHtml += `<span class="snow" title="Cumul de neige"><span class="precip-value">${value} <small>cm</small></span>${quality ? ` <span class="snow-quality">${quality}</span>` : ''}</span>`;
        }
        if (rain > 0) {
            const value = rain < 0.05 ? '<small>&lt; </small><strong>0,1</strong>' : `<strong>${dec(rain)}</strong>`;
            precipHtml += ` <span class="rain" title="Cumul de pluie"><span class="precip-value">${value} <small>mm</small></span></span>`;
        }

        const windKmh = Utils.msToKmh(windSpeed);
        const windText = (windDir !== null && windKmh !== null)
            ? `<small>${Utils.windDirection(windDir)}</small> ${windKmh}`
            : '--';

        return `
        <div class="card${isPeriod ? ' is-period' : ''} ${extraClass}">
            <time>${label}</time>
            <img class="icon" src="weather/svg/${icon}.svg" alt="${Utils.symbolLabel(icon)}">
            <div class="temp">${tempText}</div>
            <div class="card-precip">${precipHtml}</div>
            <div class="wind" title="Direction et vitesse du vent (km/h)">${windText}</div>
            <div class="cloud-cover" title="Couverture nuageuse">${cloudCover !== null ? `${Math.round(cloudCover)}<small>%</small>` : ''}</div>
        </div>`;
    }
};

// Démarrage
lucide.createIcons();
App.init();
