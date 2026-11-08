/**
 * MeteoFoux - UI Module
 * Graphiques, composants, gestion de l'application
 */

// Gestionnaire de graphiques ApexCharts
const Charts = {
    instances: {},
    instanceMeta: {}, // Stocke hasExtendedData par containerId

    // Couleurs des séries selon le thème
    getSeriesColors(isDark, hasExtendedData) {
        if (hasExtendedData) {
            return isDark
                ? ['#f97316', '#fdba74', '#98dfb6', '#39b36c', '#fbbf24', '#e0f2fe', '#3b82f6']  // dark
                : ['#ea580c', '#ff933e', '#16a34a', '#6abf70', '#fbbf24', '#0ea5e9', '#2563eb']; // light
        } else {
            return isDark
                ? ['#f97316', '#98dfb6', '#fbbf24', '#e0f2fe', '#3b82f6']  // dark
                : ['#ea580c', '#16a34a', '#fbbf24', '#0ea5e9', '#2563eb']; // light
        }
    },

    // Marqueurs de légende : cercle pointillé pour les séries dashed, plein pour les autres
    getLegendMarkers(colors, strokeDash) {
        const hasDashed = strokeDash.some(d => d > 0);
        if (!hasDashed) return { width: 10, height: 10 };
        return {
            width: 10,
            height: 10,
            fillColors: colors.map(() => 'transparent'),
            customHTML: strokeDash.map((dash, i) => {
                if (dash > 0) {
                    return function() {
                        return '<span style="display:block;width:10px;height:10px;border-radius:50%;border:1px dashed ' + colors[i] + ';box-sizing:border-box;"></span>';
                    };
                }
                return function() {
                    return '<span style="display:block;width:10px;height:10px;border-radius:50%;background:' + colors[i] + ';"></span>';
                };
            })
        };
    },

    // Options de base pour tous les graphiques (thème sombre)
    getBaseOptions(isDark = true) {
        return {
            chart: {
                background: 'transparent',
                toolbar: { show: false },
                zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
                animations: { enabled: true, speed: 400 },
                offsetX: 0,
                offsetY: 0,
                parentHeightOffset: 0
            },
            theme: { mode: isDark ? 'dark' : 'light' },
            grid: {
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                strokeDashArray: 3,
                padding: { left: -28, right: -70, top: 0, bottom: 0 }
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
                    style: { colors: isDark ? '#94a3b8' : '#6b7280' },
                    datetimeUTC: false,
                    datetimeFormatter: { hour: 'HH:mm' }
                },
                axisBorder: { show: false },
                axisTicks: { show: false },
                range: undefined // Pas de range fixe, utiliser les données
            },
            yaxis: {
                labels: { style: { colors: isDark ? '#94a3b8' : '#6b7280' } }
            }
        };
    },

    // Graphique unifié : Température, Vent, Précipitations, UV
    // hasExtendedData = true pour Open-Meteo (ressenti, rafales), false pour MET.no
    createUnifiedChart(containerId, data, isDark = true, hasExtendedData = true, iconByHour = {}) {
        // Couleurs selon le thème
        const colors = this.getSeriesColors(isDark, hasExtendedData);

        // Séries de base (toujours affichées)
        const series = [
            { name: 'Temp.', type: 'line', data: data.temp },
        ];

        // Séries étendues (Open-Meteo uniquement)
        if (hasExtendedData) {
            series.push({ name: 'T° ressentie', type: 'line', data: data.feels });
        }

        series.push({ name: 'Vent', type: 'line', data: data.speed });

        if (hasExtendedData) {
            series.push({ name: 'Rafales', type: 'line', data: data.gusts });
        }

        series.push(
            { name: 'UV', type: 'line', data: data.uv },
            { name: 'Neige', type: 'column', data: data.snow },
            { name: 'Pluie', type: 'column', data: data.rain }
        );

        // Stroke config selon les séries
        const strokeWidth = hasExtendedData ? [3, 1.5, 2, 1.5, 2, 0, 0] : [3, 2, 2, 0, 0];
        const strokeDash = hasExtendedData ? [0, 4, 0, 4, 0, 0, 0] : [0, 0, 0, 0, 0];

        // Stocker la métadonnée pour updateTheme
        this.instanceMeta[containerId] = { hasExtendedData, strokeDash };

        // YAxis config selon les séries
        // Pour MET.no avec peu de variation, forcer une plage min de 10°C
        let yTempConfig = { seriesName: 'Temp' };

        const temps = data.temp.filter(v => v !== null);
        const tempRange = Math.max(...temps) - Math.min(...temps);
        if (tempRange < 3) {
            const mid = (Math.max(...temps) + Math.min(...temps)) / 2;
            yTempConfig.min = Math.floor(mid - 5);
            yTempConfig.max = Math.ceil(mid + 5);
        }

        // OffsetY des titres d'axes selon la taille d'écran
        // < 480px : très petit (légende 2 lignes, graphique 260px)
        // 480-768px : intermédiaire (légende 1 ligne, graphique 260px)
        // >= 768px : PC (légende 1 ligne, graphique 300px)
        // MET.no (!hasExtendedData) : légende 5 items au lieu de 7, titres plus hauts
        const width = window.innerWidth;
        const baseTitleOffsetY = width < 480 ? -90 : (width < 768 ? -100 : -120);
        const titleOffsetY = hasExtendedData ? baseTitleOffsetY : baseTitleOffsetY - 10;

        const yaxis = [
            // Axe Température (gauche)
            {
                title: {
                    text: '°C',
                    rotate: 0,
                    offsetX: 20,
                    offsetY: titleOffsetY,
                    style: { color: '#f97316', fontSize: '10px' }
                },
                labels: {
                    formatter: v => Math.round(v) + '°',
                    style: { colors: isDark ? '#94a3b8' : '#6b7280', fontSize: '9px' },
                    offsetX: -35
                },
                showAlways: true,
                ...yTempConfig
            }
        ];

        if (hasExtendedData) {
            yaxis.push({ show: false, seriesName: 'Temp' }); // Ressenti même axe
        }

        // Axe Vent (droite)
        yaxis.push({
            opposite: true,
            axisBorder: { show: false },
            axisTicks: { show: false },
            title: {
                text: 'km/h',
                rotate: 0,
                offsetX: -25,
                offsetY: titleOffsetY,
                style: { color: '#06b6d4', fontSize: '10px' }
            },
            labels: {
                formatter: v => Math.round(v),
                style: { colors: isDark ? '#94a3b8' : '#6b7280', fontSize: '9px' },
                offsetX: -73
            },
            seriesName: 'Vent',
            min: 0,
            showAlways: true
        });

        if (hasExtendedData) {
            yaxis.push({ show: false, seriesName: 'Vent' }); // Rafales même axe
        }

        // Calculer max dynamique pour neige et pluie
        const snowValues = data.snow.map(d => d[1]).filter(v => v !== null);
        const rainValues = data.rain.map(d => d[1]).filter(v => v !== null);
        const snowMax = Math.max(1.9, ...snowValues) * 1.2; // Au moins 1.5, avec 20% de marge
        const rainMax = Math.max(10, ...rainValues) * 1.2; // Au moins 10, avec 20% de marge

        // Axes UV et Précipitations (ordre: UV, Neige, Pluie)
        yaxis.push(
            {
                opposite: true,
                axisBorder: { show: false },
                axisTicks: { show: false },
                title: {
                    text: 'UV',
                    rotate: 0,
                    offsetX: -20,
                    offsetY: titleOffsetY,
                    style: { color: '#fbbf24', fontSize: '10px' }
                },
                labels: {
                    formatter: v => v.toFixed(0),
                    style: { colors: isDark ? '#94a3b8' : '#6b7280', fontSize: '9px' },
                    offsetX: -30
                },
                seriesName: 'UV',
                min: 0,
                max: 10,
                showAlways: true
            },
            { show: false, min: 0, max: snowMax, showAlways: true }, // Axe Neige
            { show: false, min: 0, max: rainMax, showAlways: true }  // Axe Pluie
        );

        // Étendue de l'axe X : toute la plage de données du jour
        const timestamps = data.temp.map(d => d[0]);
        const xMinVisible = Math.min(...timestamps);
        const xMaxVisible = Math.max(...timestamps);

        const options = {
            ...this.getBaseOptions(isDark),
            chart: {
                ...this.getBaseOptions(isDark).chart,
                type: 'line',
                height: Utils.isMobile() ? 260 : 300,
                id: containerId,
                stacked: false,
                zoom: {
                    enabled: true,
                    type: 'x',
                    autoScaleYaxis: false
                },
                toolbar: {
                    show: true,
                    autoSelected: 'pan',
                    tools: {
                        download: false,
                        selection: false,
                        zoom: false,
                        zoomin: false,
                        zoomout: false,
                        pan: true,
                        reset: false
                    }
                },
                events: {
                    animationEnd: function() {
                        Charts.addWeatherIcons(containerId, iconByHour);
                    },
                    updated: function() {
                        setTimeout(() => Charts.addWeatherIcons(containerId, iconByHour), 100);
                    }
                }
            },
            series,
            colors,
            stroke: {
                width: strokeWidth,
                curve: 'smooth',
                dashArray: strokeDash
            },
            plotOptions: {
                bar: { columnWidth: '70%', borderRadius: 2 }
            },
            legend: {
                show: true,
                position: 'top',
                horizontalAlign: 'center',
                fontSize: '11px',
                markers: this.getLegendMarkers(colors, strokeDash),
                itemMargin: { horizontal: 9, vertical: 2 },
                labels: { colors: isDark ? '#94a3b8' : '#6b7280' },
                clusterGroupedSeries: false
            },
            xaxis: {
                type: 'datetime',
                min: xMinVisible,
                max: xMaxVisible,
                labels: {
                    style: { colors: isDark ? '#94a3b8' : '#6b7280' },
                    datetimeUTC: false,
                    datetimeFormatter: { hour: 'HH:mm' }
                },
                axisBorder: { show: false },
                axisTicks: { show: false }
            },
            yaxis
        };

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
        this.instanceMeta = {};
    },

    // Met à jour le thème de tous les graphiques
    updateTheme(isDark) {
        Object.entries(this.instances).forEach(([containerId, chart]) => {
            const meta = this.instanceMeta[containerId] || { hasExtendedData: true };
            const colors = this.getSeriesColors(isDark, meta.hasExtendedData);
            const strokeDash = meta.strokeDash || (meta.hasExtendedData ? [0, 4, 0, 4, 0, 0, 0] : [0, 0, 0, 0, 0]);
            chart.updateOptions({
                theme: { mode: isDark ? 'dark' : 'light' },
                grid: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
                tooltip: { theme: isDark ? 'dark' : 'light' },
                colors,
                legend: {
                    labels: { colors: isDark ? '#94a3b8' : '#6b7280' },
                    markers: this.getLegendMarkers(colors, strokeDash)
                },
                xaxis: { labels: { style: { colors: isDark ? '#94a3b8' : '#6b7280' } } }
            });
        });
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
            img.setAttribute('x', x - 6);
            img.setAttribute('y', y + 4);
            img.setAttribute('width', 18);
            img.setAttribute('height', 18);
            img.classList.add('weather-icon-annotation');

            xaxisGroup.appendChild(img);
        });
    }
};

const App = {
    state: {
        currentDay: null,
        currentPoint: 'station',
        globalSource: 'openmeteo',  // 'openmeteo', 'arome', ou 'metno'
        theme: 'dark',
        days: [],
        expandedDays: new Set(), // Jours avec vue horaire étendue
        todayHoursExpanded: false // État du "Voir heures suivantes" pour aujourd'hui
    },

    // Helper pour obtenir les données selon la source sélectionnée
    getSourceData(pointData) {
        return pointData.sources[this.state.globalSource] || { hourly: {}, sixHourly: {}, extended: false };
    },

    async init() {
        try {
            // Charger les points personnalisés avant tout
            CustomPoints.init();
            this.state.currentPoint = CONFIG.points[0].key;

            // Charger le thème sauvegardé
            const savedTheme = localStorage.getItem('fmeteo_theme') || 'dark';
            this.state.theme = savedTheme;
            document.documentElement.setAttribute('data-theme', savedTheme);
            // Mettre à jour la couleur du navigateur mobile
            const themeColor = savedTheme === 'dark' ? '#0f172a' : '#f8fafc';
            document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);

            // Charger la source sauvegardée
            const savedSource = localStorage.getItem('fmeteo_source') || 'openmeteo';
            this.state.globalSource = savedSource;

            // Charger le point initial et afficher immédiatement
            await DataService.loadFirst();
            this.setupDays();
            this.renderNavigation();
            this.render();

            // Charger les autres points en arrière-plan (la feuille des points se complète au fur et à mesure)
            DataService.loadRemaining(false, () => this.refreshPointSheet());
        } catch (e) {
            console.error("Erreur chargement:", e);
            document.getElementById('content').innerHTML = `
                <div class="error">
                    <p>Erreur de chargement: ${e.message}</p>
                    <button class="btn-more" onclick="location.reload()" style="margin-top: 1rem;">
                        Réessayer
                    </button>
                </div>`;
        }
    },

    setupDays() {
        const data = DataService.state.data;
        const now = new Date();
        const todayStr = now.toLocaleDateString('fr-CA');

        const allDays = [...new Set(Object.values(data)[0].series.map(s => Utils.getLocalDay(s.time)))];
        this.state.days = allDays.filter(day => day >= todayStr).slice(0, 7);
        this.state.currentDay = this.state.days[0];
    },

    renderNavigation() {
        // Navigation des jours
        const dayNavHtml = this.state.days.map((day, index) => {
            const dayOfWeek = Utils.getDayOfWeek(day);
            const label = CONFIG.dayLabels[dayOfWeek];
            const isActive = day === this.state.currentDay;
            const isToday = index === 0;

            return `
                <button class="day-btn ${isActive ? 'active' : ''}" data-day="${day}" onclick="App.selectDay('${day}')">
                    ${isToday ? '<i data-lucide="calendar-check" class="today-icon"></i>' : label}
                    <span class="day-dot"></span>
                </button>
            `;
        }).join('');

        document.getElementById('day-nav').innerHTML = dayNavHtml;

        this.updateSourceAttribute();
        this.updateTopBar();

        lucide.createIcons();
    },

    // data-source sur <html> : teinte du détail du jour selon le modèle choisi
    updateSourceAttribute() {
        document.documentElement.setAttribute('data-source', this.state.globalSource);
    },

    // Barre du haut : point choisi et son altitude (ouvre la feuille des points), puis la date
    updateTopBar() {
        const point = CONFIG.points.find(p => p.key === this.state.currentPoint);
        if (point) {
            const elevation = DataService.state.data[point.key]?.elevation;
            document.getElementById('point-title-text').textContent =
                elevation ? `${point.name} · ${Math.round(elevation)} m` : point.name;
            document.getElementById('point-title-dot').style.setProperty('--point-color', point.color);
        }
        const dateEl = document.getElementById('current-date');
        if (this.state.currentDay) {
            const formatted = Utils.formatDateShort(this.state.currentDay);
            dateEl.textContent = formatted.charAt(0).toUpperCase() + formatted.slice(1);
        }
    },

    selectDay(day) {
        this.state.currentDay = day;

        // Mettre à jour les boutons
        document.querySelectorAll('.day-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.day === day);
        });

        this.updateTopBar();
        this.render();

        // Sur desktop, scroll vers l'ancre
        if (!Utils.isMobile()) {
            const section = document.querySelector(`.day-section[data-day="${day}"]`);
            if (section) section.scrollIntoView({ behavior: 'smooth' });
        }
    },

    async selectPoint(pointKey) {
        this.state.currentPoint = pointKey;
        this.updateTopBar();

        // Si le point n'est pas encore chargé, afficher skeleton et attendre
        if (!DataService.state.data[pointKey]) {
            document.getElementById('content').innerHTML = Components.Skeleton();
            lucide.createIcons();
            const point = CONFIG.points.find(p => p.key === pointKey);
            await DataService.loadSinglePoint(point);
        }

        this.render();
    },

    // Modèle affiché en détail (cases du bloc verdict). Mémorisé, valable pour tous les jours.
    // Le rendu garde la position de défilement : seul le détail change.
    selectSource(source) {
        if (source === this.state.globalSource) return;
        this.state.globalSource = source;
        localStorage.setItem('fmeteo_source', source);
        this.updateSourceAttribute();
        const scrollY = window.scrollY;
        this.render();
        window.scrollTo(0, scrollY);
    },

    toggleTheme() {
        this.state.theme = this.state.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', this.state.theme);
        localStorage.setItem('fmeteo_theme', this.state.theme);
        Charts.updateTheme(this.state.theme === 'dark');
        // Mettre à jour la couleur du navigateur mobile
        const themeColor = this.state.theme === 'dark' ? '#0f172a' : '#f8fafc';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
    },

    async refreshData() {
        const btn = document.getElementById('refresh-btn');
        btn.classList.add('refreshing');

        // Afficher le skeleton pendant le chargement
        document.getElementById('content').innerHTML = Components.Skeleton();
        lucide.createIcons();

        try {
            DataService.state.data = {};
            await DataService.loadFirst(true, this.state.currentPoint);
            this.render();
            await DataService.loadRemaining(true, () => this.refreshPointSheet());
        } finally {
            btn.classList.remove('refreshing');
        }
    },

    render() {
        const data = DataService.state.data;
        const isToday = Utils.isToday(this.state.currentDay);
        const pointData = data[this.state.currentPoint];
        const source = this.state.globalSource;
        const sourceData = this.getSourceData(pointData);

        this.updateTopBar();

        // Détruire les anciens graphiques avant de recréer le DOM
        Charts.destroyAll();

        // Sur mobile : afficher uniquement le jour sélectionné
        // Sur desktop : afficher tous les jours en scroll
        if (Utils.isMobile()) {
            const html = this.renderDayContent(this.state.currentDay, pointData, isToday, source, sourceData);
            document.getElementById('content').innerHTML = html;
        } else {
            const html = this.state.days
                .map(day => this.renderDayContent(day, pointData, Utils.isToday(day), source, sourceData))
                .join('');
            document.getElementById('content').innerHTML = html;
        }

        lucide.createIcons();

        // Restaurer l'état du toggle aujourd'hui si nécessaire
        if (this.state.todayHoursExpanded) {
            const todayGrid = document.querySelector('.day-section[data-day="' + new Date().toLocaleDateString('fr-CA') + '"] .cards-grid:not(.cards-grid-tomorrow)');
            if (todayGrid) {
                todayGrid.querySelectorAll('.hidden-card').forEach(card => {
                    card.classList.remove('hidden-card');
                    card.classList.add('was-hidden');
                });
                const btn = todayGrid.querySelector('.btn-more');
                if (btn) btn.textContent = 'Replier les heures';
            }
        }

        // Restaurer l'état du toggle pour chaque jour étendu
        this.state.expandedDays.forEach(day => {
            const dayGrid = document.querySelector(`.cards-grid-tomorrow[data-day="${day}"]`);
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

        // Rendre les graphiques après le DOM
        requestAnimationFrame(() => this.renderCharts());
    },

    renderDayContent(day, pointData, isToday, source, sourceData) {
        const { point, series, elevation } = pointData;
        const hourlyData = sourceData.hourly;
        const sixHourlyData = sourceData.sixHourly;

        const dayHeaderHtml = `
            <h2 class="day-header">
                <span class="day-label">${Utils.formatDateLabel(day)}</span>
                <span class="point-badge" style="--point-color: ${point.color}">
                    ${Utils.escapeHtml(point.name)} ${elevation ? `(${Math.round(elevation)}m)` : ''}
                </span>
            </h2>`;

        // Verdict du jour selon tous les modèles disponibles (bloc en tête du jour)
        const summaries = {};
        for (const key of ['openmeteo', 'arome', 'metno']) {
            const src = pointData.sources[key];
            summaries[key] = src ? DataNormalizer.daySummary(day, series, src) : null;
        }
        const verdict = DataNormalizer.computeVerdict(summaries, elevation);
        const verdictHtml = Components.Verdict(verdict, summaries, source);

        // Créneaux du jour (chronologie commune), avec les données de la source choisie
        const dayEntries = series
            .filter(e => Utils.getLocalDay(e.time) === day)
            .map(e => ({ time: e.time, hourly: hourlyData[e.time] || null, sixHourly: sixHourlyData[e.time] || null }));

        // Pas de données de cette source pour ce jour (AROME couvre ~4-5 jours, source indisponible)
        if (!summaries[source]) {
            const label = { openmeteo: 'Open-Meteo', arome: 'AROME', metno: 'MET.no' }[source];
            const hint = source === 'arome' ? 'AROME ne prévoit qu’à 4 ou 5 jours. ' : '';
            return `
                <section class="day-section" data-day="${day}" id="day-${day}">
                    ${dayHeaderHtml}
                    ${verdictHtml}
                    <div class="day-detail">
                        <div class="no-data-message">
                            <p>${label} n’a pas de prévision pour ce jour</p>
                            <small>${hint}Choisissez un autre modèle ci-dessus.</small>
                        </div>
                    </div>
                </section>
            `;
        }

        // Préparer les données
        let displayEntries;
        let hourlyEntries = []; // Toutes les heures du jour, pour le toggle des jours suivants

        if (isToday) {
            const nowMs = new Date().getTime();
            displayEntries = dayEntries.filter(e => e.hourly && Utils.parseTime(e.time).getTime() >= nowMs - 3600000);
        } else {
            // Les 4 périodes (6h)
            displayEntries = dayEntries
                .filter(e => e.sixHourly && Utils.parseTime(e.time).getUTCHours() % 6 === 0)
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
            contentHtml = Components.ChartSection(day, this.state.currentPoint);

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
                <div class="day-detail">${contentHtml}</div>
            </section>
        `;
    },

    renderCharts() {
        const data = DataService.state.data;
        const pointData = data[this.state.currentPoint];
        const sourceData = this.getSourceData(pointData);

        // Déterminer quels jours ont besoin d'un graphique
        const daysToRender = Utils.isMobile() ? [this.state.currentDay] : this.state.days;

        daysToRender.forEach((day, dayIndex) => {
            // Vérifier si on dépasse le nombre max de jours avec graphique
            if (CONFIG.charts.maxDays === 0 || dayIndex >= CONFIG.charts.maxDays) return;

            const chartAvailability = Utils.getChartDataAvailability(day, sourceData.hourly, sourceData.sixHourly);

            // Ne pas rendre si pas assez de données
            if (chartAvailability.type === 'none') return;

            this.renderChartForDay(day, chartAvailability.type, sourceData);
        });
    },

    renderChartForDay(day, dataType, sourceData) {
        const chartData = DataNormalizer.toChartData(day, sourceData, dataType);
        if (chartData.length < 2) return;

        const isDark = this.state.theme === 'dark';
        const chartIdPrefix = `chart-${day}-${this.state.currentPoint}`;

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
            Charts.createUnifiedChart(`${chartIdPrefix}-unified`, formattedData, isDark, hasExtendedData, iconByHour);
        }
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
        const focusedKey = document.activeElement?.closest?.('#point-sheet [data-focus-key]')?.dataset.focusKey;
        const data = DataService.state.data;
        const day = this.state.currentDay;
        const elevationOf = p => data[p.key]?.elevation ?? null;

        // Verdict court du jour pour un point (s'il est chargé)
        const verdictHtml = point => {
            const pointData = data[point.key];
            if (!pointData) return '<span class="sheet-row-verdict is-loading">Chargement…</span>';
            const summaries = {};
            for (const key of ['openmeteo', 'arome', 'metno']) {
                const src = pointData.sources[key];
                summaries[key] = src ? DataNormalizer.daySummary(day, pointData.series, src) : null;
            }
            const verdict = DataNormalizer.computeVerdict(summaries, pointData.elevation);
            if (!verdict) return '<span class="sheet-row-verdict">—</span>';
            const { value, unit } = Components.verdictValue(verdict);
            const icon = { snow: 'snowflake', rain: 'cloud-rain', dry: 'sun' }[verdict.mode];
            return `<span class="sheet-row-verdict is-${verdict.mode}"><i data-lucide="${icon}"></i>${value} ${unit}</span>`;
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

        // Domaine : du plus bas au plus haut (altitude inconnue tant que le point charge : à la fin)
        const domain = CONFIG.points.filter(p => !p.custom)
            .sort((a, b) => (elevationOf(a) ?? Infinity) - (elevationOf(b) ?? Infinity));
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
        if (focusedKey) root.querySelector(`[data-focus-key="${focusedKey}"]`)?.focus();
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

    closeAddPointModal() {
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
        }

        this.renderNavigation();
        this.render();
        this.refreshPointSheet();
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
        } else {
            // Replier : cacher les cartes qui étaient cachées
            visibleExtraCards.forEach(card => {
                card.classList.add('hidden-card');
                card.classList.remove('was-hidden');
            });
            const count = block.querySelectorAll('.hidden-card').length;
            btn.textContent = `Voir heures suivantes (${count}+)`;
            this.state.todayHoursExpanded = false;
        }
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
    }
};

// Composants UI
const Components = {
    // Skeleton loader pour le chargement initial et refresh
    Skeleton() {
        // Générer des hauteurs variées pour les barres du graphique
        const barHeights = [40, 65, 55, 80, 70, 50, 75, 60, 45, 70, 85, 55, 40, 60, 75, 50, 65, 45, 55, 70, 60, 50, 65, 45];
        const barsHtml = barHeights.map(h => `<div class="skeleton-bar skeleton" style="height: ${h}%"></div>`).join('');

        // Générer 4 cartes skeleton
        const cardsHtml = Array(4).fill(null).map(() => `
            <div class="skeleton-card">
                <div class="skeleton-time skeleton"></div>
                <div class="skeleton-icon skeleton"></div>
                <div class="skeleton-temp skeleton"></div>
                <div class="skeleton-data">
                    <div class="skeleton-line skeleton" style="width: 85%"></div>
                    <div class="skeleton-line skeleton" style="width: 65%"></div>
                </div>
            </div>
        `).join('');

        return `
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
                    <div class="skeleton-chart">${barsHtml}</div>
                    <div class="skeleton-cards">${cardsHtml}</div>
                </div>
            </div>
        `;
    },

    // Le gros chiffre du verdict : fourchette entre modèles de la grandeur qui décide de la journée
    // (cm de neige arrondis, mm de pluie au dixième, températures un jour sec)
    verdictValue(verdict) {
        const deg = n => String(Math.round(n)).replace('-', '−');
        const { mode, range, basis } = verdict;
        if (mode === 'dry') return { value: `${deg(range.lo)} à ${deg(range.hi)}`, unit: '°C' };
        const fmt = mode === 'snow' ? v => String(Math.round(v)) : v => v.toFixed(1).replace('.', ',');
        const lo = fmt(range.lo), hi = fmt(range.hi);
        return {
            value: basis.length === 1 || lo === hi ? hi : `${lo} à ${hi}`,
            unit: mode === 'snow' ? 'cm' : 'mm'
        };
    },

    // Bloc verdict en tête du jour : la grandeur qui décide de la journée selon les modèles,
    // puis une case par modèle (preuve du verdict et choix du modèle affiché en détail).
    // verdict = DataNormalizer.computeVerdict(), summaries = { source: daySummary | null }
    Verdict(verdict, summaries, selected) {
        if (!verdict) return '';
        const LABELS = { openmeteo: 'Open-Meteo', arome: 'AROME', metno: 'MET.no' };
        const dec = n => n.toFixed(1).replace('.', ',');
        const deg = n => String(Math.round(n)).replace('-', '−');
        const hourLabel = (ms, isEnd) => {
            const h = new Date(ms).getHours();
            return `${isEnd && h === 0 ? 24 : h}h`;
        };
        const { mode, range, basis } = verdict;
        const { value, unit } = this.verdictValue(verdict);

        let what;
        if (mode === 'dry') {
            const cc = verdict.cloudCover;
            what = cc === null ? 'Sec' : `Sec, ${cc < 35 ? 'ensoleillé' : cc < 70 ? 'avec des éclaircies' : 'plutôt nuageux'}`;
        } else {
            const quality = { wet: ' humide', dry: ' sèche' }[verdict.snowQuality] || '';
            what = mode === 'snow' ? `de neige${quality}${verdict.alsoRain ? ', et de la pluie' : ''}` : 'de pluie';
        }
        const by = basis.length === 1 ? `selon ${LABELS[basis[0]]} seulement` : `selon les ${basis.length} modèles`;
        const agreeHtml = verdict.diverge === null ? ''
            : verdict.diverge
                ? '<span class="verdict-agree"><i data-lucide="split"></i>Les modèles divergent</span>'
                : '<span class="verdict-agree"><i data-lucide="check"></i>Les modèles s’accordent</span>';

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
            const pos = { above: 'au-dessus du point', below: 'sous le point', around: 'autour du point' }[verdict.freezing.position];
            const r10 = v => Math.round(v / 10) * 10;
            facts.push(['thermometer-snowflake', `Iso 0 °C entre ${r10(verdict.freezing.min)} et ${r10(verdict.freezing.max)} m, ${pos}`]);
        }

        const cells = Object.keys(LABELS).map(key => {
            const s = summaries[key];
            if (!s) {
                return `
                    <button class="model-cell is-${key}" disabled>
                        <span class="model-name">${LABELS[key]}</span>
                        <span class="model-value">—</span>
                        <span class="model-sub">${key === 'arome' ? 'Ne prévoit pas si loin' : 'Pas de données'}</span>
                    </button>`;
            }
            const amount = mode === 'snow' ? s.snow : s.rain;
            const valueHtml = mode === 'snow' ? `${dec(s.snow)} cm`
                : mode === 'rain' ? `${dec(s.rain)} mm`
                : `${deg(s.tempMin)} / ${deg(s.tempMax)}°`;
            const barHtml = mode === 'dry' ? ''
                : `<span class="model-bar"><span style="width: ${range.hi > 0 ? Math.max(3, Math.round(amount / range.hi * 100)) : 3}%"></span></span>`;
            const sub = s.period ? `${hourLabel(s.period.from, false)}–${hourLabel(s.period.to, true)} seulement`
                : s.sixHourly ? 'Par pas de 6 h'
                : mode === 'dry' ? (s.nightMin !== null ? `Nuit ${deg(s.nightMin)}°` : '')
                : `${deg(s.tempMin)} / ${deg(s.tempMax)}°`;
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
                <p class="verdict-main"><span class="verdict-value">${value}</span><span class="verdict-unit">${unit}</span></p>
                <p class="verdict-sub"><span>${what}, ${by}</span>${agreeHtml}</p>
                ${facts.length ? `<ul class="verdict-facts">${facts.map(([icon, text]) => `<li><i data-lucide="${icon}"></i>${text}</li>`).join('')}</ul>` : ''}
                <div class="verdict-models" role="group" aria-label="Modèle affiché en détail">${cells}</div>
            </div>
        `;
    },

    ChartSection(day, pointKey) {
        const chartIdPrefix = `chart-${day}-${pointKey}`;
        return `
            <div class="chart-wrapper chart-full">
                <div id="${chartIdPrefix}-unified" class="chart"></div>
            </div>
        `;
    },

    CardsGrid(entries, isToday) {
        const visibleCount = Utils.visibleCardCount();
        const cardsHtml = entries.map((entry, index) => {
            const d = Utils.parseTime(entry.time);
            const label = isToday ? Utils.formatTimeLabel(d) : Utils.periodLabel(d.getUTCHours());
            const cardData = DataNormalizer.toCardData(entry);
            const extraClass = (isToday && index >= visibleCount) ? 'hidden-card' : '';
            return this.WeatherCard(label, cardData, extraClass);
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
                <div class="grid">${cardsHtml}</div>
                ${showMoreBtn}
            </div>
        `;
    },

    // Grille spéciale pour demain : périodes par défaut, toggle vers hourly
    CardsGridTomorrow(periodEntries, hourlyEntries, day) {
        // Cartes périodes (Nuit, Matin, Midi, Soir)
        const periodCardsHtml = periodEntries.map(entry => {
            const d = Utils.parseTime(entry.time);
            const label = Utils.periodLabel(d.getUTCHours());
            const cardData = DataNormalizer.toCardData(entry);
            return this.WeatherCard(label, cardData, '');
        }).join('');

        // Cartes horaires (toutes les heures)
        const hourlyCardsHtml = hourlyEntries.map(entry => {
            const d = Utils.parseTime(entry.time);
            const label = Utils.formatTimeLabel(d);
            const cardData = DataNormalizer.toCardData(entry);
            return this.WeatherCard(label, cardData, '');
        }).join('');

        return `
            <div class="cards-grid cards-grid-tomorrow" data-day="${day}">
                <div class="grid grid-periods">${periodCardsHtml}</div>
                <div class="grid grid-hourly" style="display: none;">${hourlyCardsHtml}</div>
                <div class="show-more-wrapper">
                    <button class="btn-more btn-toggle-tomorrow" onclick="App.toggleTomorrowView(this, '${day}')">
                        Voir toutes les heures (${hourlyEntries.length})
                    </button>
                </div>
            </div>
        `;
    },

    WeatherCard(label, data, extraClass = '') {
        const { icon, temp, windDir, windSpeed, snow, rain, precipProb, snowQuality, cloudCover } = data;

        let snowQualityHtml = '';
        if (snow > 0 && snowQuality) {
            snowQualityHtml = snowQuality === 'wet'
                ? ` • <span class="snow-quality snow-sticky">hum.</span>`
                : ` • <span class="snow-quality snow-dry">sec.</span>`;
        }

        let snowHtml = '';
        if (snow > 0) {
            const snowDisplay = snow <= DataNormalizer.MIN_PRECIP
                ? `<small>< </small>${DataNormalizer.MIN_PRECIP}<small>cm</small>`
                : `<strong>${snow.toFixed(2)}<small>cm</small></strong>`;
            snowHtml = `<i data-lucide="snowflake"></i> ${snowDisplay}`;
        }

        const tempDisplay = temp !== null ? Math.round(temp) : '--';
        const windKmh = Utils.msToKmh(windSpeed);
        const windDisplay = (windDir !== null && windKmh !== null)
            ? `${Utils.windDirection(windDir)}. ${windKmh}`
            : '--';

        // Couverture nuageuse
        let cloudHtml = '';
        if (cloudCover !== null) {
            cloudHtml = `
                <div class="cloud-cover" title="Couverture nuageuse">
                    <i data-lucide="cloudy" class="lucide"></i>
                    <span>${Math.round(cloudCover)}<small>%</small></span>
                </div>`;
        }

        return `
        <div class="card ${extraClass}">
            <div class="time-icon">
                <time>${label}</time>
                <img class="icon" src="weather/svg/${icon}.svg" alt="icon">
            </div>
            <div class="temp">${tempDisplay}<span class="unit">°C</span></div>
            <div class="data">
                <div class="wind" title="Direction et vitesse vent">
                    <i data-lucide="wind" class="lucide"></i>
                    <span><strong>${windDisplay}</strong> <small>km/h</small></span>
                </div>
                ${cloudHtml}
                ${snow > 0 ? `
                    <div class="snow" title="Cumul de neige">
                        <span>${snowHtml}${snowQualityHtml}</span>
                    </div>` : ''}
                ${rain > 0 ? `
                    <div class="rain" title="Cumul de pluie">
                        <i data-lucide="cloud-rain-wind" class="lucide"></i>
                        <span><strong>${rain.toFixed(2)}</strong> <small>mm</small></span>
                    </div>` : ''}
            </div>
        </div>`;
    }
};

// Démarrage
lucide.createIcons();
App.init();
