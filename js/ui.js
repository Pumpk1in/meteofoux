/**
 * MeteoFoux - UI Module
 * Graphiques, composants, gestion de l'application
 */

// Gestionnaire de graphiques ApexCharts
const Charts = {
    instances: {},

    // Couleurs des séries selon le thème (clair : ≥ 3:1 sur blanc). La neige est la série la plus
    // saturée : c'est la grandeur qui compte ici
    getSeriesColors(isDark) {
        return isDark
            ? { temp: '#f97316', feels: '#fdba74', wind: '#98dfb6', gusts: '#39b36c', uv: '#fbbf24', snow: '#22d3ee', rain: '#3b82f6' }
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
        const items = defs.map(d => {
            const mark = d.type === 'column'
                ? `<span class="chart-key-bar" style="background:${d.color}"></span>`
                : `<span class="chart-key-line${d.dash > 0 ? ' is-dashed' : ''}" style="border-color:${d.color}"></span>`;
            return `<span class="chart-key-item">${mark}${d.name}</span>`;
        }).join('');
        const t = this.getAxisTitleColors(isDark);
        const hasUv = defs.some(d => d.key === 'uv');
        return `<div class="chart-key">${items}<button class="chart-details-btn" aria-expanded="${details}" onclick="App.toggleChartDetails(this)">${details ? 'Moins de détails' : 'Plus de détails'}</button></div>
            <div class="chart-units${hasUv ? '' : ' no-uv'}" aria-hidden="true">
                <span style="color:${t.temp}">°C</span>
                <span class="chart-unit-wind" style="color:${t.wind}">km/h</span>
                ${hasUv ? `<span class="chart-unit-uv" style="color:${t.uv}">UV</span>` : ''}
            </div>`;
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
                // Données centrées dans la carte (la 1re heure n'en déborde plus) ; top : moins de vide sous les unités
                padding: { left: -9, right: -66, top: -12, bottom: 0 }
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
        const labelStyle = { colors: isDark ? '#94a3b8' : '#6b7280', fontSize: '9px' };
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
                    // Sous « km/h » (.chart-unit-wind), qui prend la place de « UV » quand l'UV est masqué.
                    // Axe opposé : plus négatif = plus à droite
                    offsetX: showUv ? -14 : 0
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
                    offsetX: -15 // Sous « UV » (.chart-unit-uv)
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
            // Sans l'axe UV, ApexCharts réserve moins de place à droite : sans ce réglage, le tracé déborde
            ...(showUv ? {} : { grid: { ...this.getBaseOptions(isDark).grid, padding: { left: -15, right: -25, top: -12, bottom: 0 } } }),
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
        todayHoursExpanded: false, // État du "Voir heures suivantes" pour aujourd'hui
        modelsHelpOpen: false,     // Explication des modèles (bouton "?" du verdict) dépliée
        chartDetails: false        // Graphique : ressenti, rafales et UV affichés ("Plus de détails")
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

            // "mis à jour il y a X min" reste juste si l'onglet reste ouvert
            setInterval(() => this.updateTopBar(), 60000);
        } catch (e) {
            console.error("Erreur chargement:", e);
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
        this.updateSourceAttribute();
        this.updateTopBar();

        lucide.createIcons();
    },

    // Barre des jours : "AUJ." puis les jours de la semaine, chacun avec l'indicateur du verdict
    // pour le point affiché (flocon + cm, goutte + mm, soleil + max). À refaire quand le point change.
    renderDayNav() {
        const pointData = DataService.state.data[this.state.currentPoint];
        const deg = n => String(Math.round(n)).replace('-', '−');
        const ICONS = { snow: 'snowflake', rain: 'cloud-rain', dry: 'sun' };
        const SPOKEN = { snow: ' de neige', rain: ' de pluie', dry: ', sec' };

        document.getElementById('day-nav').innerHTML = this.state.days.map((day, index) => {
            const isActive = day === this.state.currentDay;
            const label = index === 0 ? 'AUJ.' : CONFIG.dayLabels[Utils.getDayOfWeek(day)];
            const verdict = pointData ? DataNormalizer.dayVerdict(pointData, day).verdict : null;

            let indicatorHtml = '', spoken = '';
            if (verdict) {
                const { prefix, value, unit } = Components.verdictValue(verdict);
                spoken = ` : ${prefix ? `${prefix} ` : ''}${value} ${unit}${SPOKEN[verdict.mode]}`;
                let short;
                if (verdict.mode === 'dry') {
                    short = `${deg(verdict.tempMax)}°`;
                } else {
                    const lo = Math.round(verdict.range.lo), hi = Math.round(verdict.range.hi);
                    short = verdict.basis.length === 1 || lo === hi ? `${hi}` : `${lo}–${hi}`;
                }
                indicatorHtml = `<span class="day-indicator is-${verdict.mode}"><i data-lucide="${ICONS[verdict.mode]}"></i>${short}</span>`;
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
            const freshness = this.freshness(DataService.state.data[this.state.currentPoint]?.meta);
            dateEl.textContent = formatted.charAt(0).toUpperCase() + formatted.slice(1)
                + (freshness ? ` · ${freshness.text}` : '');
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

        this.renderDayNav();
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
        // Les graphiques sont recréés : séries ET titres d'axes changent de teinte avec le thème
        // (pas de rendu tant que le point n'a pas de données : chargement initial, écran d'erreur)
        if (DataService.state.data[this.state.currentPoint]) {
            const scrollY = window.scrollY;
            this.render();
            window.scrollTo(0, scrollY);
        }
        // Mettre à jour la couleur du navigateur mobile
        const themeColor = this.state.theme === 'dark' ? '#0f172a' : '#f8fafc';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
    },

    // Rafraîchit sans rien effacer : les prévisions restent affichées (estompées) jusqu'à la
    // nouvelle réponse ; en cas d'échec (réseau faible sur les pistes), elles sont conservées
    async refreshData() {
        const btn = document.getElementById('refresh-btn');
        const content = document.getElementById('content');
        // Un seul rafraîchissement à la fois, arrière-plan compris (sinon deux tournées forcées
        // de tous les points en parallèle : appels doublés vers les API, risque de 429)
        if (this._refreshing) return;
        this._refreshing = true;
        btn.classList.add('refreshing');
        content.classList.add('is-refreshing');
        content.setAttribute('aria-busy', 'true');

        const current = CONFIG.points.find(p => p.key === this.state.currentPoint);
        try {
            await DataService.loadSinglePoint(current, true);
            this.renderDayNav();
            this.render();
        } catch (e) {
            console.error('Rafraîchissement impossible :', e);
            const freshness = this.freshness(DataService.state.data[current.key]?.meta);
            this.showNotice(`Rafraîchissement impossible (réseau ou service météo indisponible). `
                + `Les prévisions affichées sont conservées${freshness ? ` (${freshness.text.replace('màj ', 'mises à jour ')})` : ''}.`);
        } finally {
            btn.classList.remove('refreshing');
            content.classList.remove('is-refreshing');
            content.removeAttribute('aria-busy');
        }

        // Les autres points, en arrière-plan ; un échec garde simplement leurs anciennes données
        for (const point of CONFIG.points.filter(p => p.key !== current.key)) {
            try {
                await DataService.loadSinglePoint(point, true);
                this.refreshPointSheet();
            } catch (e) {
                console.warn(`Rafraîchissement de ${point.key} impossible :`, e.message);
            }
        }
        this._refreshing = false;
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
        const { summaries, verdict } = DataNormalizer.dayVerdict(pointData, day);
        // Sources présentes dans la réponse du proxy : une absente n'a pas répondu (429, panne)
        const available = Object.keys(pointData.sources);
        const verdictHtml = Components.Verdict(verdict, summaries, source, available);

        // Créneaux du jour (chronologie commune), avec les données de la source choisie
        const dayEntries = series
            .filter(e => Utils.getLocalDay(e.time) === day)
            .map(e => ({ time: e.time, hourly: hourlyData[e.time] || null, sixHourly: sixHourlyData[e.time] || null }));

        // Pas de données de cette source pour ce jour (AROME couvre ~4-5 jours, source indisponible)
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
                    <div class="day-detail">
                        <div class="no-data-message">${message}</div>
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
            Charts.createUnifiedChart(`${chartIdPrefix}-unified`, formattedData, isDark, hasExtendedData, iconByHour,
                this.sharedChartScales(day, dataType), this.state.chartDetails);
        }
    },

    // Échelles communes aux modèles d'un jour : passer d'une case à l'autre ne change pas les axes,
    // une heure à 1 cm a la même hauteur chez les trois. Températures et vent : tous les modèles.
    // Neige et pluie : seulement ceux tracés au même pas (une barre de 6 h cumule six heures).
    sharedChartScales(day, dataType) {
        const pointData = DataService.state.data[this.state.currentPoint];
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

    // Bouton "?" du verdict : déplie l'explication des trois modèles. L'état survit aux rendus
    // (choisir un modèle redessine la page) ; sur ordinateur, les autres jours suivent au prochain rendu
    toggleModelsHelp(btn) {
        this.state.modelsHelpOpen = !this.state.modelsHelpOpen;
        btn.setAttribute('aria-expanded', String(this.state.modelsHelpOpen));
        btn.closest('.verdict').querySelector('.verdict-help').hidden = !this.state.modelsHelpOpen;
    },

    // "Plus de détails" : ressenti, rafales et UV, pour tous les graphiques (séries et axes changent : on les refait)
    toggleChartDetails(btn) {
        this.state.chartDetails = !this.state.chartDetails;
        const day = btn.closest('.day-section')?.dataset.day;
        Charts.destroyAll();
        this.renderCharts();
        // La clé est régénérée : le focus revient sur le bouton du même jour
        document.querySelector(`.day-section[data-day="${day}"] .chart-details-btn`)?.focus({ preventScroll: true });
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

    // Format d'une quantité du verdict : cm de neige arrondis, mm de pluie au dixième
    verdictAmount(mode, v) {
        return mode === 'snow' ? String(Math.round(v)) : v.toFixed(1).replace('.', ',');
    },

    // Le gros chiffre du verdict : fourchette entre modèles de la grandeur qui décide de la journée
    // (températures un jour sec). Quand le plus faible est à zéro, "jusqu'à 18" plutôt que "0 à 18"
    // (prefix, à afficher avant value)
    verdictValue(verdict) {
        const deg = n => String(Math.round(n)).replace('-', '−');
        const { mode, range, basis } = verdict;
        if (mode === 'dry') return { prefix: '', value: `${deg(range.lo)} à ${deg(range.hi)}`, unit: '°C' };
        const lo = this.verdictAmount(mode, range.lo), hi = this.verdictAmount(mode, range.hi);
        const unit = mode === 'snow' ? 'cm' : 'mm';
        if (basis.length === 1 || lo === hi) return { prefix: '', value: hi, unit };
        if (Number(lo.replace(',', '.')) === 0) return { prefix: 'jusqu’à', value: hi, unit };
        return { prefix: '', value: `${lo} à ${hi}`, unit };
    },

    // Bloc verdict en tête du jour : la grandeur qui décide de la journée selon les modèles,
    // puis une case par modèle (preuve du verdict et choix du modèle affiché en détail).
    // verdict = DataNormalizer.computeVerdict(), summaries = { source: daySummary | null },
    // available = sources présentes dans la réponse du proxy (une absente n'a pas répondu)
    Verdict(verdict, summaries, selected, available) {
        if (!verdict) return '';
        // La source "arome" est la chaîne Météo-France : AROME jusque vers J+2, puis ARPEGE.
        // La case porte le nom du modèle qui a vraiment servi ce jour-là.
        const MODEL_LABELS = {
            meteofrance_arome_france_hd: 'AROME',
            meteofrance_arome_france: 'AROME',
            meteofrance_arpege_seamless: 'ARPEGE',
            meteofrance_seamless: 'Météo-France'
        };
        const SOURCE_LABELS = { openmeteo: 'Open-Meteo', arome: 'AROME', metno: 'MET.no' };
        const LABELS = {};
        for (const key of Object.keys(SOURCE_LABELS)) {
            LABELS[key] = (key === 'arome' && MODEL_LABELS[summaries[key]?.model]) || SOURCE_LABELS[key];
        }
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
        const by = basis.length === 1 ? `selon ${LABELS[basis[0]]} seulement` : `selon les ${basis.length} modèles`;
        // Accord : une puce. Divergence : rien de plus, la fourchette et les cases juste en dessous la montrent déjà
        const agreeHtml = verdict.diverge === false
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
            // Isotherme 0 °C, en mots simples : l'altitude au-dessus de laquelle il gèle
            const pos = { above: 'plus haut que le point', below: 'plus bas que le point', around: 'à hauteur du point' }[verdict.freezing.position];
            const r10 = v => Math.round(v / 10) * 10;
            const lo = r10(verdict.freezing.min), hi = r10(verdict.freezing.max);
            facts.push(['thermometer-snowflake', `Limite du gel ${lo === hi ? `vers ${hi}` : `entre ${lo} et ${hi}`} m, ${pos}`]);
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
                <p class="verdict-main">${prefix ? `<span class="verdict-unit">${prefix}</span>` : ''}<span class="verdict-value">${value}</span><span class="verdict-unit">${unit}</span></p>
                <p class="verdict-sub">
                    <span>${what}, ${by}<button class="verdict-help-btn" aria-expanded="${helpOpen}" aria-label="Qui sont ces modèles ?" title="Qui sont ces modèles ?" onclick="App.toggleModelsHelp(this)"><i data-lucide="circle-help"></i></button></span>
                    ${agreeHtml}
                </p>
                ${facts.length ? `<ul class="verdict-facts">${facts.map(([icon, text]) => `<li><i data-lucide="${icon}"></i>${text}</li>`).join('')}</ul>` : ''}
                <div class="verdict-models" role="group" aria-label="Modèle affiché en détail">${cells}</div>
                <div class="verdict-help"${helpOpen ? '' : ' hidden'}>
                    <p>Trois services de prévision, qui calculent chacun la météo à leur façon. Touchez une case pour voir ses heures en dessous.</p>
                    <ul>
                        <li><strong>Open-Meteo</strong> : combine plusieurs modèles, à sa façon.</li>
                        <li><strong>AROME</strong> : Météo-France, le plus détaillé, sur environ 2 jours. Ensuite, son modèle plus large : <strong>ARPEGE</strong>.</li>
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

        const dec = n => n.toFixed(1).replace('.', ',');

        let snowQualityHtml = '';
        if (snow > 0 && snowQuality) {
            snowQualityHtml = snowQuality === 'wet'
                ? ` <span class="snow-quality snow-sticky">humide</span>`
                : ` <span class="snow-quality snow-dry">sèche</span>`;
        }

        let snowHtml = '';
        if (snow > 0) {
            const snowDisplay = snow <= DataNormalizer.MIN_PRECIP
                ? `<small>&lt; </small>${dec(DataNormalizer.MIN_PRECIP)} <small>cm</small>`
                : `<strong>${dec(snow)}</strong> <small>cm</small>`;
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
                <img class="icon" src="weather/svg/${icon}.svg" alt="${Utils.symbolLabel(icon)}">
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
                        <span>${rain < 0.05 ? '<small>&lt; </small><strong>0,1</strong>' : `<strong>${dec(rain)}</strong>`} <small>mm</small></span>
                    </div>` : ''}
            </div>
        </div>`;
    }
};

// Démarrage
lucide.createIcons();
App.init();
