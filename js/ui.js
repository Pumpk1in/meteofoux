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
                : ['#ea580c', '#f97316', '#16a34a', '#15803d', '#d97706', '#0ea5e9', '#2563eb']; // light
        } else {
            return isDark
                ? ['#f97316', '#98dfb6', '#fbbf24', '#e0f2fe', '#3b82f6']  // dark
                : ['#ea580c', '#16a34a', '#d97706', '#0ea5e9', '#2563eb']; // light
        }
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
                padding: { left: 0, right: -25, top: 0, bottom: 0 }
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
    createUnifiedChart(containerId, data, isDark = true, hasExtendedData = true) {
        // Stocker la métadonnée pour updateTheme
        this.instanceMeta[containerId] = { hasExtendedData };

        // Couleurs selon le thème
        const colors = this.getSeriesColors(isDark, hasExtendedData);

        // Séries de base (toujours affichées)
        const series = [
            { name: 'Temp', type: 'line', data: data.temp },
        ];

        // Séries étendues (Open-Meteo uniquement)
        if (hasExtendedData) {
            series.push({ name: 'Ressenti', type: 'line', data: data.feels });
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
        const strokeWidth = hasExtendedData ? [3, 2, 2, 2, 2, 0, 0] : [3, 2, 2, 0, 0];
        const strokeDash = hasExtendedData ? [0, 4, 0, 4, 0, 0, 0] : [0, 0, 0, 0, 0];

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

        const yaxis = [
            // Axe Température (gauche)
            {
                title: { text: '°C', style: { color: '#f97316', fontSize: '10px' }, offsetX: 5 },
                labels: {
                    formatter: v => Math.round(v) + '°',
                    style: { colors: isDark ? '#94a3b8' : '#6b7280', fontSize: '9px' },
                    offsetX: -15
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
            axisBorder: { show: false, offsetX: -20 },
            axisTicks: { show: false },
            title: { text: 'km/h', style: { color: '#06b6d4', fontSize: '10px' }, offsetX: -10 },
            labels: {
                formatter: v => Math.round(v),
                style: { colors: isDark ? '#94a3b8' : '#6b7280', fontSize: '9px' },
                offsetX: -35
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
                axisBorder: { show: false, offsetX: -20 },
                axisTicks: { show: false },
                title: { text: 'UV', style: { color: '#fbbf24', fontSize: '10px' }, offsetX: -10 },
                labels: {
                    formatter: v => v.toFixed(0),
                    style: { colors: isDark ? '#94a3b8' : '#6b7280', fontSize: '9px' },
                    offsetX: -15
                },
                seriesName: 'UV',
                min: 0,
                max: 10,
                showAlways: true
            },
            { show: false, min: 0, max: snowMax, showAlways: true }, // Axe Neige
            { show: false, min: 0, max: rainMax, showAlways: true }  // Axe Pluie
        );

        // Calculer min/max des timestamps pour l'axe X
        const timestamps = data.temp.map(d => d[0]);
        const xMin = Math.min(...timestamps);
        const xMax = Math.max(...timestamps);

        // Sur mobile : afficher 10h de données à partir de maintenant
        const isMobile = Utils.isMobile();
        const visibleRange = 10 * 60 * 60 * 1000; // 10 heures en ms
        const now = Date.now();
        // Commencer à l'heure actuelle (ou au début si maintenant est avant les données)
        const xMinVisible = xMin; // 30 min avant maintenant
        const xMaxVisible = xMax;

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
                markers: { width: 8, height: 8 },
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
            chart.updateOptions({
                theme: { mode: isDark ? 'dark' : 'light' },
                grid: { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
                tooltip: { theme: isDark ? 'dark' : 'light' },
                colors,
                legend: { labels: { colors: isDark ? '#94a3b8' : '#6b7280' } },
                xaxis: { labels: { style: { colors: isDark ? '#94a3b8' : '#6b7280' } } }
            });
        });
    }
};

const App = {
    state: {
        currentDay: null,
        currentPoint: 'station',
        globalSource: 'openmeteo',
        theme: 'dark',
        days: [],
        expandedDays: new Set(), // Jours avec vue horaire étendue
        todayHoursExpanded: false // État du "Voir heures suivantes" pour aujourd'hui
    },

    async init() {
        try {
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

            await DataService.loadAll();
            this.setupDays();
            this.renderNavigation();
            this.render();
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

        // Tabs altitudes
        const altitudeTabsHtml = CONFIG.points.map(point => {
            const isActive = point.key === this.state.currentPoint;
            return `
                <button class="altitude-btn ${isActive ? 'active' : ''}"
                        data-point="${point.key}"
                        onclick="App.selectPoint('${point.key}')"
                        style="--point-color: ${point.color}">
                    ${point.name.split(' ')[0]}
                </button>
            `;
        }).join('');

        document.getElementById('altitude-tabs').innerHTML = altitudeTabsHtml;

        // Mettre à jour le toggle source global
        this.updateSourceToggle();

        lucide.createIcons();
    },

    updateSourceToggle() {
        const toggle = document.getElementById('global-source-toggle');
        const isOM = this.state.globalSource === 'openmeteo';
        toggle.className = `source-toggle ${isOM ? 'is-openmeteo' : 'is-metno'}`;
        toggle.querySelector('.source-label').innerHTML = isOM ? 'Open<br>Meteo' : 'Met<br>.no';
    },

    updateTopBar() {
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

    selectPoint(pointKey) {
        this.state.currentPoint = pointKey;

        // Mettre à jour les boutons
        document.querySelectorAll('.altitude-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.point === pointKey);
        });

        this.render();
    },

    toggleGlobalSource() {
        const data = DataService.state.data;
        const omAvailableDays = Object.values(data)[0].omAvailableDays;
        const canToggle = omAvailableDays.has(this.state.currentDay);

        if (!canToggle) return;

        this.state.globalSource = this.state.globalSource === 'openmeteo' ? 'metno' : 'openmeteo';
        localStorage.setItem('fmeteo_source', this.state.globalSource);
        this.updateSourceToggle();
        this.render();
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
            await DataService.loadAll(true);
            this.render();
        } finally {
            btn.classList.remove('refreshing');
        }
    },

    render() {
        const data = DataService.state.data;
        const isToday = Utils.isToday(this.state.currentDay);
        const pointData = data[this.state.currentPoint];
        const omAvailableDays = Object.values(data)[0].omAvailableDays;
        const canToggle = omAvailableDays.has(this.state.currentDay);
        const useOpenMeteo = this.state.globalSource === 'openmeteo' && canToggle;

        this.updateTopBar();

        // Détruire les anciens graphiques avant de recréer le DOM
        Charts.destroyAll();

        // Sur mobile : afficher uniquement le jour sélectionné
        // Sur desktop : afficher tous les jours en scroll
        if (Utils.isMobile()) {
            const html = this.renderDayContent(this.state.currentDay, pointData, isToday, useOpenMeteo, canToggle);
            document.getElementById('content').innerHTML = html;
        } else {
            const html = this.state.days.map(day => {
                const isDayToday = Utils.isToday(day);
                const dayCanToggle = omAvailableDays.has(day);
                const dayUseOM = this.state.globalSource === 'openmeteo' && dayCanToggle;
                return this.renderDayContent(day, pointData, isDayToday, dayUseOM, dayCanToggle);
            }).join('');
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

    renderDayContent(day, pointData, isToday, useOpenMeteo, canToggle) {
        const { point, series, omHourly, elevation } = pointData;
        // Filtrer par jour local uniquement
        const dayEntries = series.filter(e => Utils.getLocalDay(e.time) === day);
        const now = new Date();

        // Préparer les données
        let displayEntries;
        let hourlyEntriesForTomorrow = []; // Cartes horaires pour les jours avec données hourly

        if (isToday) {
            const nowMs = now.getTime();
            displayEntries = dayEntries.filter(e => Utils.parseTime(e.time).getTime() >= nowMs - 3600000);
        } else {
            // Préparer les 4 périodes (6h)
            displayEntries = dayEntries.filter(e => Utils.parseTime(e.time).getUTCHours() % 6 === 0).slice(0, 4);
            // ET toutes les heures (pour le toggle) - pour tous les jours avec données hourly
            if (useOpenMeteo && omHourly) {
                // Open-Meteo : construire les entrées directement depuis omHourly (pas depuis series)
                hourlyEntriesForTomorrow = Object.keys(omHourly)
                    .filter(time => Utils.getLocalDay(time) === day)
                    .sort()
                    .map(time => ({ time, om: omHourly[time], metno: null }));
            } else {
                // MET.no : filtrer les entrées avec données next_1_hours, par jour local uniquement
                hourlyEntriesForTomorrow = dayEntries.filter(e =>
                    Utils.getLocalDay(e.time) === day &&
                    e.metno?.data?.next_1_hours !== undefined
                );
            }
        }

        if (!displayEntries.length) return '';

        const preparedEntries = displayEntries.map(e => DataNormalizer.prepareEntry(e, isToday, useOpenMeteo));

        // Préparer les entrées horaires pour tous les jours avec données hourly
        const preparedHourlyEntries = hourlyEntriesForTomorrow.length > 0
            ? hourlyEntriesForTomorrow.map(e => DataNormalizer.prepareEntry(e, true, useOpenMeteo))
            : [];

        // Calculer le résumé sur TOUTE la journée (pas seulement les cartes affichées)
        let summaryEntries;
        if (useOpenMeteo && omHourly) {
            // Open-Meteo : utiliser toutes les heures de la journée
            summaryEntries = Object.keys(omHourly)
                .filter(time => Utils.getLocalDay(time) === day)
                .map(time => ({ time, om: omHourly[time] }));
        } else {
            // MET.no : utiliser toutes les entrées du jour (pas seulement displayEntries)
            summaryEntries = dayEntries
                .filter(e => e.metno?.data?.next_1_hours || e.metno?.data?.next_6_hours)
                .map(e => DataNormalizer.prepareEntry(e, true, false));
        }
        const totals = DataNormalizer.computeTotals(summaryEntries, true);

        // Calculer l'isotherme 0°C
        let freezing = { min: null, max: null };
        if (useOpenMeteo && omHourly) {
            const dayData = Object.keys(omHourly)
                .filter(t => Utils.getLocalDay(t) === day)
                .map(t => omHourly[t])
                .filter(v => v?.freezingPoint > 100);

            if (dayData.length > 0) {
                freezing.min = Math.min(...dayData.map(v => v.freezingPoint));
                freezing.max = Math.max(...dayData.map(v => v.freezingPoint));
            }
        }

        // Construire le HTML
        const summaryHtml = Components.Summary(totals, freezing, elevation);

        // Déterminer si on peut afficher un graphique pour ce jour
        const { omSixHourly } = pointData;
        const dayIndex = this.state.days.indexOf(day);
        const chartAvailability = Utils.getChartDataAvailability(day, omHourly, omSixHourly, series, useOpenMeteo);
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
            // Pas de graphique, seulement les cartes
            contentHtml = Components.CardsGrid(preparedEntries, false);
        }

        return `
            <section class="day-section" data-day="${day}" id="day-${day}">
                <h2 class="day-header">
                    <span class="day-label">${Utils.formatDateLabel(day)}</span>
                    <span class="point-badge" style="--point-color: ${CONFIG.points.find(p => p.key === this.state.currentPoint).color}">
                        ${CONFIG.points.find(p => p.key === this.state.currentPoint).name} ${elevation ? `(${Math.round(elevation)}m)` : ''}
                    </span>
                </h2>
                ${summaryHtml}
                ${contentHtml}
            </section>
        `;
    },

    renderCharts() {
        const data = DataService.state.data;
        const pointData = data[this.state.currentPoint];
        const { omHourly, omSixHourly, series } = pointData;
        const omAvailableDays = Object.values(data)[0].omAvailableDays;

        // Déterminer quels jours ont besoin d'un graphique
        const daysToRender = Utils.isMobile() ? [this.state.currentDay] : this.state.days;

        daysToRender.forEach((day, dayIndex) => {
            // Vérifier si on dépasse le nombre max de jours avec graphique
            if (CONFIG.charts.maxDays === 0 || dayIndex >= CONFIG.charts.maxDays) return;

            const useOpenMeteo = this.state.globalSource === 'openmeteo' && omAvailableDays.has(day);

            // Utiliser la nouvelle fonction pour déterminer le type de données disponibles
            const chartAvailability = Utils.getChartDataAvailability(day, omHourly, omSixHourly, series, useOpenMeteo);

            // Ne pas rendre si pas assez de données
            if (chartAvailability.type === 'none') return;

            // Rendre le graphique avec le type de données approprié
            this.renderChartForDay(day, pointData, useOpenMeteo, chartAvailability.type);
        });
    },

    renderChartForDay(day, pointData, useOpenMeteo, dataType = 'hourly') {
        const { omHourly, omSixHourly, series } = pointData;

        let chartData = [];
        const isHourly = dataType === 'hourly';

        if (useOpenMeteo) {
            // Données Open-Meteo
            const dataSource = isHourly ? omHourly : omSixHourly;
            if (!dataSource) return;

            chartData = Object.keys(dataSource)
                .filter(time => Utils.getLocalDay(time) === day)
                .sort()
                .map(time => {
                    const d = dataSource[time];
                    const timestamp = new Date(time.endsWith('Z') ? time : time + ':00Z').getTime();
                    return {
                        time: timestamp,
                        temp: isHourly ? d.temp : d.tempMax,
                        tempMin: isHourly ? d.temp : d.tempMin,
                        apparent_temperature: isHourly ? (d.apparent_temperature || d.temp) : d.tempMax,
                        windSpeed: isHourly ? d.windSpeed : d.windSpeed,
                        wind_gusts: isHourly ? (d.wind_gusts || d.windSpeed) : d.windSpeed,
                        snow: d.snow || 0,
                        rain: d.rain || 0,
                        uv_index: isHourly ? (d.uv_index || 0) : 0
                    };
                });
        } else {
            // Données MET.no
            chartData = series
                .filter(entry => {
                    if (!entry.metno) return false;
                    const localDay = Utils.getLocalDay(entry.time);
                    if (localDay !== day) return false;
                    // Filtrer selon le type de données requis
                    return isHourly
                        ? !!entry.metno.data?.next_1_hours
                        : !!entry.metno.data?.next_6_hours;
                })
                .map(entry => {
                    const m = entry.metno;
                    const details = m.data?.instant?.details || {};
                    const forecast = isHourly
                        ? (m.data?.next_1_hours?.details || {})
                        : (m.data?.next_6_hours?.details || {});
                    const timestamp = Utils.parseTime(m.time).getTime();
                    return {
                        time: timestamp,
                        temp: details.air_temperature ?? null,
                        tempMin: isHourly ? details.air_temperature : (forecast.air_temperature_min ?? details.air_temperature),
                        apparent_temperature: details.air_temperature ?? null,
                        windSpeed: details.wind_speed ?? null,
                        wind_gusts: details.wind_speed_of_gust ?? details.wind_speed ?? null,
                        snow: forecast.snowfall || 0,
                        rain: forecast.rain || 0,
                        uv_index: details.ultraviolet_index_clear_sky ?? 0
                    };
                });
        }

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

        // Créer le graphique unifié
        // hasExtendedData = true seulement pour Open-Meteo hourly (ressenti, rafales disponibles)
        const hasExtendedData = useOpenMeteo && isHourly;
        if (document.getElementById(`${chartIdPrefix}-unified`)) {
            Charts.createUnifiedChart(`${chartIdPrefix}-unified`, formattedData, isDark, hasExtendedData);
        }
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
    },

    refresh() {
        DataService.refresh();
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

    Summary(totals, freezing, elevation) {
        const tempHtml = `
            <span class="summary-item" title="Température min/max">
                <i data-lucide="thermometer"></i>
                <span>${Math.round(totals.tempMin)}° / ${Math.round(totals.tempMax)}°</span>
            </span>
        `;

        const snowHtml = totals.snow > 0
            ? `<span class="summary-item snow" title="Neige cumulée">
                <i data-lucide="snowflake"></i>
                <span>${totals.snow.toFixed(1)} cm</span>
               </span>`
            : `<span class="summary-item muted"><i data-lucide="snowflake"></i> --</span>`;

        const rainHtml = totals.rain > 0
            ? `<span class="summary-item rain" title="Pluie cumulée">
                <i data-lucide="cloud-rain-wind"></i>
                <span>${totals.rain.toFixed(1)} mm</span>
               </span>`
            : `<span class="summary-item muted"><i data-lucide="cloud-rain-wind"></i> --</span>`;

        const freezingHtml = (freezing.min && freezing.max && freezing.min > 100)
            ? `<span class="summary-item" title="Isotherme 0°C">
                <i data-lucide="thermometer-snowflake"></i>
                <span class="biline"><span>${Math.round(freezing.min)}m</span><span>${Math.round(freezing.max)}m</span></span>
               </span>`
            : '';

        return `
            <div class="summary-bar">
                ${tempHtml}
                ${snowHtml}
                ${rainHtml}
                ${freezingHtml}
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
            const cardData = DataNormalizer.toCardData(entry, isToday);
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
            const cardData = DataNormalizer.toCardData(entry, false);
            return this.WeatherCard(label, cardData, '');
        }).join('');

        // Cartes horaires (toutes les heures)
        const hourlyCardsHtml = hourlyEntries.map(entry => {
            const d = Utils.parseTime(entry.time);
            const label = Utils.formatTimeLabel(d);
            const cardData = DataNormalizer.toCardData(entry, true);
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
        const { icon, temp, windDir, windSpeed, snow, rain, precipProb, snowQuality } = data;

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
