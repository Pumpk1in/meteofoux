/**
 * MeteoFoux - Core Module
 * Configuration, utilitaires, services de données
 */

const CONFIG = {
    // Les points du domaine, du plus bas au plus haut : l'ordre de la feuille des points et du
    // balayage d'un point à l'autre (CONFIG.domain, ci-dessous)
    points: [
        { name: 'Station', lat: 44.2902, lon: 6.5689, key: 'station', color: '#309fcf' },
        { name: 'Marin-Pascal', lat: 44.2935, lon: 6.5904, key: 'marin-pascal', color: '#de9333' },
        { name: 'Vescal', lat: 44.3122, lon: 6.5743, key: 'vescal', color: '#866fcc' },
        { name: 'Observatoire', lat: 44.2848, lon: 6.5356, key: 'observatoire', color: '#d866a1' }
    ],
    dayLabels: ['DI', 'LU', 'MA', 'ME', 'JE', 'VE', 'SA'],
    charts: {
        maxDays: 7,            // Nombre max de jours avec graphique (0 = désactivé)
        minHourlyPoints: 12,   // Minimum de points hourly pour graphique détaillé
        minSixHourlyPoints: 3  // Minimum de points 6h pour graphique simplifié (4 créneaux max/jour)
    }
};

// Ordre du domaine, figé dès maintenant : CONFIG.points reçoit ensuite les points perso et suit
// l'ordre mémorisé (CustomPoints.applyOrder), qui peut dater d'un domaine rangé autrement
CONFIG.domain = CONFIG.points.map(p => p.key);

// Gestion des points personnalisés (localStorage)
const CustomPoints = {
    STORAGE_KEY: 'fmeteo_custom_points',
    MAX_CUSTOM: 6,
    COLORS: ['#26b763', '#e67e22', '#1abc9c', '#6c5ce7', '#00b894', '#fdcb6e', '#3498db', '#f39c12'],

    init() {
        const saved = this.getSaved();
        let needsSave = false;
        saved.forEach(p => {
            p.custom = true;
            // Migrer les couleurs hors palette (ex: ancien rouge)
            if (!this.COLORS.includes(p.color)) {
                p.color = this.nextColor(saved.filter(s => s !== p));
                needsSave = true;
            }
            CONFIG.points.push(p);
        });
        if (needsSave) this.save(saved);
        this.applyOrder();
    },

    getSaved() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || [];
        } catch { return []; }
    },

    save(points) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(points));
    },

    add(name, lat, lon) {
        if (!this.isInFrance(lat, lon)) return { error: 'Coordonnées hors France métropolitaine' };
        const saved = this.getSaved();
        if (saved.length >= this.MAX_CUSTOM) return { error: `Maximum ${this.MAX_CUSTOM} points personnalisés` };

        const key = this.generateKey(name, saved);
        const color = this.nextColor(saved);
        const point = { name, lat: parseFloat(lat), lon: parseFloat(lon), key, color, custom: true };

        saved.push(point);
        this.save(saved);
        CONFIG.points.push(point);
        return { point };
    },

    remove(key) {
        let saved = this.getSaved();
        saved = saved.filter(p => p.key !== key);
        this.save(saved);
        CONFIG.points = CONFIG.points.filter(p => p.key !== key);
        delete DataService.state.data[key];
    },

    generateKey(name, saved) {
        const base = 'custom-' + name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const allKeys = CONFIG.points.map(p => p.key).concat(saved.map(p => p.key));
        let key = base;
        let i = 2;
        while (allKeys.includes(key)) { key = base + '-' + i; i++; }
        return key;
    },

    nextColor(saved) {
        const usedColors = CONFIG.points.map(p => p.color).concat(saved.map(p => p.color));
        return this.COLORS.find(c => !usedColors.includes(c)) || this.COLORS[saved.length % this.COLORS.length];
    },

    isInFrance(lat, lon) {
        return lat >= 41.3 && lat <= 51.1 && lon >= -5.2 && lon <= 9.6;
    },

    ORDER_KEY: 'fmeteo_points_order',

    saveOrder(keys) {
        localStorage.setItem(this.ORDER_KEY, JSON.stringify(keys));
    },

    applyOrder() {
        try {
            const order = JSON.parse(localStorage.getItem(this.ORDER_KEY));
            if (!Array.isArray(order) || order.length === 0) return;
            CONFIG.points.sort((a, b) => {
                const ia = order.indexOf(a.key);
                const ib = order.indexOf(b.key);
                if (ia === -1 && ib === -1) return 0;
                if (ia === -1) return 1;
                if (ib === -1) return -1;
                return ia - ib;
            });
        } catch {}
    }
};

const Utils = {
    // Convertit les degrés en direction cardinale
    windDirection: (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(deg / 45) % 8],

    // Convertit m/s en km/h
    msToKmh: (ms) => ms !== null ? Math.round(ms * 3.6) : null,

    // Formate une date en label français complet
    formatDateLabel: (dateStr) => new Date(dateStr).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long'
    }),

    // Formate une date courte pour la top bar
    formatDateShort: (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
    },

    // Formate une heure
    formatTimeLabel: (date) => date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),

    // Label pour période 6h
    periodLabel: (hour) => ['Nuit', 'Matin', 'Midi', 'Soir'][hour / 6],

    // Nombre de cartes visibles avant le bouton "Voir heures suivantes"
    visibleCardCount: () => 4,

    // Description d'une icône MET.no (texte alternatif) : "lightsnowshowers_day" → "Averses de neige faibles"
    symbolLabel(code) {
        if (!code) return '';
        let base = code.replace(/_(day|night|polartwilight)$/, '');
        const thunder = base.includes('andthunder') ? ' et orage' : '';
        base = base.replace('andthunder', '');
        const SKY = { clearsky: 'Ciel dégagé', fair: 'Beau temps', partlycloudy: 'Éclaircies', cloudy: 'Nuageux', fog: 'Brouillard' };
        if (SKY[base]) return SKY[base];
        // "lights" : faute de frappe d'origine de MET.no (lightssleetshowers..., lightssnowshowers...)
        const m = base.match(/^(lights?|heavy)?(rain|sleet|snow)(showers)?$/);
        if (!m) return 'Temps prévu';
        const kind = { rain: 'pluie', sleet: 'pluie et neige mêlées', snow: 'neige' }[m[2]];
        const intensity = !m[1] ? '' : m[1].startsWith('light') ? ' faible' : ' forte';
        return m[3]
            ? `Averses de ${kind}${intensity && intensity + 's'}${thunder}`
            : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}${intensity}${thunder}`;
    },

    // Échappe le texte destiné à être injecté en HTML (noms de points saisis par l'utilisateur)
    escapeHtml: (str) => String(str).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),

    // Parse un timestamp GMT (ajoute Z si nécessaire pour interprétation UTC)
    parseTime: (timeStr) => new Date(timeStr.endsWith('Z') ? timeStr : timeStr + 'Z'),

    // Extrait la date locale (YYYY-MM-DD) d'un timestamp GMT
    getLocalDay: (timeStr) => {
        const date = Utils.parseTime(timeStr);
        return date.toLocaleDateString('fr-CA'); // Format YYYY-MM-DD
    },

    // Jour de la semaine (0=dimanche)
    getDayOfWeek: (dateStr) => new Date(dateStr).getDay(),

    isToday: (dateStr) => dateStr === new Date().toLocaleDateString('fr-CA'),

    // Détermine si on est sur mobile
    isMobile: () => window.innerWidth < 768,

    /**
     * Analyse les données disponibles pour un jour donné et retourne le type de graphique possible
     * @param {string} day - Date au format YYYY-MM-DD
     * @param {object} hourly - Données horaires de la source, indexées par heure
     * @param {object} sixHourly - Données 6h de la source, indexées par heure
     * @returns {{ type: 'hourly'|'sixhourly'|'none', count: number }}
     */
    getChartDataAvailability(day, hourly, sixHourly) {
        const hourlyCount = Object.keys(hourly || {}).filter(t => this.getLocalDay(t) === day).length;
        if (hourlyCount >= CONFIG.charts.minHourlyPoints) {
            return { type: 'hourly', count: hourlyCount };
        }

        // Fallback sur six_hourly
        const sixHourlyCount = Object.keys(sixHourly || {}).filter(t => this.getLocalDay(t) === day).length;
        if (sixHourlyCount >= CONFIG.charts.minSixHourlyPoints) {
            return { type: 'sixhourly', count: sixHourlyCount };
        }

        // Ni assez d'heures ni assez de pas de 6 h : un graphique horaire court plutôt que rien
        // (MET.no le soir : ses heures déjà passées ne sont pas connues)
        if (hourlyCount >= 2) {
            return { type: 'hourly', count: hourlyCount };
        }

        return { type: 'none', count: 0 };
    }
};

// Service de fetch des data
const DataService = {
    state: { data: {}, failed: {} },

    // Charge un seul point (le premier ou celui spécifié)
    async loadFirst(forceRefresh = false, pointKey = null) {
        const point = pointKey
            ? CONFIG.points.find(p => p.key === pointKey)
            : CONFIG.points[0];

        const rawData = await this.fetchPointData(point, forceRefresh);
        this.state.data[point.key] = this.processPointData(point, rawData);

        return this.state.data;
    },

    // Charge les points restants en arrière-plan (ceux pas encore chargés). Un point en échec ne
    // bloque pas les suivants : il est noté dans state.failed (la feuille des points l'affiche)
    async loadRemaining(forceRefresh = false, onPointLoaded = null) {
        const remaining = CONFIG.points.filter(p => !this.state.data[p.key]);

        for (let i = 0; i < remaining.length; i++) {
            const point = remaining[i];
            if (i > 0) await new Promise(r => setTimeout(r, 100));
            try {
                const rawData = await this.fetchPointData(point, forceRefresh);
                this.state.data[point.key] = this.processPointData(point, rawData);
                delete this.state.failed[point.key];
            } catch (e) {
                console.warn(`Chargement de ${point.key} impossible :`, e.message);
                this.state.failed[point.key] = true;
            }
            if (onPointLoaded) onPointLoaded(point.key);
        }

        return this.state.data;
    },

    // Charge tous les points (utilisé pour le refresh forcé)
    async loadAll(forceRefresh = false) {
        this.state.data = {};
        await this.loadFirst(forceRefresh);
        await this.loadRemaining(forceRefresh);
        return this.state.data;
    },

    async fetchPointData(point, forceRefresh = false, retryCount = 0) {
        const url = `/meteo-proxy.php?lat=${point.lat}&lon=${point.lon}${forceRefresh ? '&refresh=1' : ''}`;

        // Timeout de 35 secondes (le PHP peut être lent si cache expiré)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 35000);

        try {
            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!resp.ok) {
                throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
            }

            const text = await resp.text();
            try {
                return JSON.parse(text);
            } catch (parseError) {
                console.error('JSON parse error for', point.key, ':', text.substring(0, 200));
                throw new Error(`Invalid JSON response for ${point.key}`);
            }
        } catch (error) {
            clearTimeout(timeoutId);

            // Retry une fois après 2 secondes si erreur réseau ou timeout
            if (retryCount < 1 && (error.name === 'AbortError' || error.name === 'TypeError')) {
                console.warn(`Retry ${point.key} after error:`, error.message);
                await new Promise(r => setTimeout(r, 2000));
                return this.fetchPointData(point, forceRefresh, retryCount + 1);
            }

            if (error.name === 'AbortError') {
                throw new Error(`Timeout loading ${point.key} (35s)`);
            }
            throw error;
        }
    },

    processPointData(point, rawData) {
        const forecasts = rawData.forecasts || {};
        const elevation = rawData.elevation || null;

        // Fonction commune pour créer les données horaires
        const createHourlyData = (agg) => this.indexByTime(agg?.hourly, (data, idx) => {

            return {
                model: data.model?.[idx] ?? null,  // modèle qui a servi (la chaîne AROME passe à ARPEGE vers J+2)
                temp: data.temperature[idx],
                apparent_temperature: data.apparent_temperature?.[idx] ?? data.temperature[idx],
                dewPoint: data.dew_point[idx],
                humidity: data.humidity?.[idx] ?? 0,
                windSpeed: data.wind_speed[idx],
                wind_gusts: data.wind_gusts?.[idx] ?? data.wind_speed[idx],
                windDir: data.wind_direction[idx],
                snow: data.snowfall[idx] || 0,
                rain: data.rain[idx] || 0,
                precipProb: data.precipitation_probability[idx] || 0,
                freezingPoint: data.freezing_point[idx],
                freezingPointCorrected: data.freezing_point_corrected?.[idx] || false,
                icon: data.symbol_code[idx],
                snowQuality: data.snow_quality[idx],
                isDay: data.is_day[idx],
                uv_index: data.uv_index?.[idx] ?? 0,
                cloudCover: data.cloud_cover?.[idx] ?? null
            };
        });

        // Fonction commune pour créer les données 6h
        const createSixHourlyData = (agg) => this.indexByTime(agg?.six_hourly, (data, idx) => {
            return {
                tempMin: data.temperature_min[idx],
                tempMax: data.temperature_max[idx],
                windSpeed: data.wind_speed_max[idx],
                windDir: data.wind_direction[idx],
                snow: data.snowfall[idx] || 0,
                rain: data.rain[idx] || 0,
                precipProb: data.precipitation_probability[idx] || 0,
                freezingPoint: data.freezing_point[idx],
                freezingPointCorrected: data.freezing_point_corrected?.[idx] || false,
                icon: data.symbol_code[idx],
                snowQuality: data.snow_quality[idx],
                cloudCover: data.cloud_cover?.[idx] ?? null
            };
        });

        // Chaque source au même format (clé "forecasts" du proxy)
        const sources = {};
        for (const [key, agg] of Object.entries(forecasts)) {
            sources[key] = {
                hourly: createHourlyData(agg),
                sixHourly: createSixHourlyData(agg),
                // Ressenti et rafales : MET.no ne les fournit pas, son graphique s'en passe
                extended: (agg?.hourly?.apparent_temperature || []).some(v => v !== null)
            };
        }

        // Chronologie commune : toutes les heures et tous les pas de 6 h connus, toutes sources
        // confondues. Elle ne dépend plus de MET.no : l'app s'affiche même si une source manque.
        const times = new Set();
        Object.values(sources).forEach(src => {
            Object.keys(src.hourly).forEach(t => times.add(t));
            Object.keys(src.sixHourly).forEach(t => times.add(t));
        });
        const series = [...times].sort().map(time => ({ time }));

        // meta : generated_at (fraîcheur), stale (cache servi faute de sources), http_* (statuts)
        return { point, series, elevation, sources, meta: rawData.meta || {} };
    },

    indexByTime(data, mapper) {
        if (!data?.time) return {};
        const index = {};
        data.time.forEach((time, idx) => {
            // Normaliser la clé à YYYY-MM-DDTHH:MM (16 chars) pour matcher MET.no
            const key = time.substring(0, 16);
            index[key] = mapper(data, idx);
        });
        return index;
    },

    async loadSinglePoint(point, forceRefresh = false) {
        const now = Date.now();
        const rawData = await this.fetchPointData(point, forceRefresh);
        this.state.data[point.key] = this.processPointData(point, rawData, now);
        return this.state.data[point.key];
    },

    refresh() {
        location.reload();
    }
};

// Normalisation des data
const DataNormalizer = {
    toCardData(entry) {
        const d = entry.data;
        if (!d) return null;

        return {
            icon: d.icon || 'clearsky_day',
            temp: d.temp,
            // Pas de 6 h : la carte affiche "min à max" (une seule valeur cachait qu'il s'agit du max)
            tempMin: d.tempMin ?? null,
            tempMax: d.tempMax ?? null,
            windDir: d.windDir,
            windSpeed: d.windSpeed,
            snow: d.snow || 0,
            rain: d.rain || 0,
            precipProb: d.precipProb,
            freezingPoint: d.freezingPoint,
            snowQuality: d.snowQuality,
            isDay: d.isDay,
            cloudCover: d.cloudCover
        };
    },

    // Données d'un créneau pour une carte : l'heure (aujourd'hui, ou vue "toutes les heures"),
    // sinon le pas de 6 h. entry = { time, hourly, sixHourly } (données de la source choisie)
    prepareEntry(entry, isToday) {
        if (isToday) {
            return { time: entry.time, data: entry.hourly };
        }

        const six = entry.sixHourly;
        const hour = Utils.parseTime(entry.time).getUTCHours();
        return {
            time: entry.time,
            data: {
                temp: six.tempMax,
                tempMin: six.tempMin,
                tempMax: six.tempMax,
                windSpeed: six.windSpeed,
                windDir: six.windDir,
                snow: six.snow,
                rain: six.rain,
                precipProb: six.precipProb,
                freezingPoint: six.freezingPoint,
                icon: six.icon,
                snowQuality: six.snowQuality,
                dewPoint: null,
                isDay: hour >= 6 && hour < 18,
                cloudCover: six.cloudCover
            }
        };
    },

    // Normalise les données d'un jour en tableau prêt pour les charts, quelle que soit la source
    toChartData(day, sourceData, dataType) {
        const isHourly = dataType === 'hourly';
        const dataSource = isHourly ? sourceData.hourly : sourceData.sixHourly;
        if (!dataSource) return [];

        return Object.keys(dataSource)
            .filter(time => Utils.getLocalDay(time) === day)
            .sort()
            .map(time => {
                const d = dataSource[time];
                if (d.temp === null && d.tempMax === null) return null;
                const timestamp = new Date(time.endsWith('Z') ? time : time + ':00Z').getTime();
                return {
                    time: timestamp,
                    temp: isHourly ? d.temp : d.tempMax,
                    apparent_temperature: isHourly ? (d.apparent_temperature || d.temp) : d.tempMax,
                    windSpeed: d.windSpeed,
                    wind_gusts: isHourly ? (d.wind_gusts || d.windSpeed) : d.windSpeed,
                    snow: d.snow || 0,
                    rain: d.rain || 0,
                    uv_index: isHourly ? (d.uv_index || 0) : 0,
                    icon: d.icon || 'clearsky_day'
                };
            })
            .filter(d => d !== null);
    },

    // Seuils du verdict (bloc "selon les modèles") : valeurs de départ, à régler ici seulement
    VERDICT: {
        snowCm: 0.5,          // neige à partir de laquelle la journée est une journée de neige
        rainMm: 1,            // sinon, pluie à partir de laquelle c'est une journée de pluie
        divergeSnowCm: 2,     // écart minimal entre modèles pour dire qu'ils divergent (neige)
        divergeRainMm: 3,     // idem pour la pluie
        divergeRatio: 1.5,    // ... et rapport minimal entre le plus fort et le plus faible
        divergeTempC: 3,      // jour sec : écart de min ou de max entre modèles
        // Contradiction : les modèles ne racontent pas la même journée (0 contre 17 cm), prévision
        // peu fiable. Novembre 2026 : 7 jours de neige/pluie sur 26, les écarts du type 6 / 13 mm n'y sont pas
        contradictSnowCm: 5,  // écart minimal (neige)
        contradictRainMm: 10, // idem pour la pluie
        contradictRatio: 4    // ... et rapport minimal entre le plus fort et le plus faible
    },

    // Résumé d'un jour pour UNE source : totaux, isotherme 0 °C, et ce dont le verdict a besoin
    // (regel, vent, nuages, qualité de neige). null si la source n'a rien ce jour-là (AROME au-delà
    // de ~4 jours). sourceData = { hourly, sixHourly } indexés par heure, series = chronologie commune
    daySummary(day, series, sourceData) {
        const dayEntries = series
            .filter(e => Utils.getLocalDay(e.time) === day)
            .map(e => ({ time: e.time, hourly: sourceData.hourly[e.time] || null, sixHourly: sourceData.sixHourly[e.time] || null }));
        const hasData = dayEntries.some(e => (e.hourly && e.hourly.temp !== null) || (e.sixHourly && e.sixHourly.tempMax !== null));
        if (!hasData) return null;

        // TOUTE la journée : chaque heure de la source, et ses pas de 6 h là où elle n'a pas
        // d'heures (MET.no au-delà de J+2)
        const entries = dayEntries
            .map(e => e.hourly ? { time: e.time, data: e.hourly, hours: 1 }
                : e.sixHourly ? { time: e.time, data: e.sixHourly, hours: 6 } : null)
            .filter(e => e !== null);
        const totals = this.computeTotals(entries);

        // Isotherme 0 °C (MET.no ne le fournit pas)
        const freezing = { min: null, max: null };
        const dayFreezing = dayEntries.map(e => e.hourly).filter(v => v?.freezingPoint > 100);
        if (dayFreezing.length > 0) {
            freezing.min = Math.min(...dayFreezing.map(v => v.freezingPoint));
            freezing.max = Math.max(...dayFreezing.map(v => v.freezingPoint));
        }

        let nightMin = null, windMax = null;
        const clouds = [], qualities = [], models = {};
        entries.forEach(({ time, data, hours }) => {
            if (data.model && data.temp !== null && data.temp !== undefined) {
                models[data.model] = (models[data.model] || 0) + 1;
            }
            const low = hours === 6 ? data.tempMin : data.temp;
            if (low !== null && low !== undefined && Utils.parseTime(time).getHours() < 6) {
                nightMin = nightMin === null ? low : Math.min(nightMin, low);
            }
            if (data.windSpeed !== null && data.windSpeed !== undefined) {
                windMax = windMax === null ? data.windSpeed : Math.max(windMax, data.windSpeed);
            }
            if (data.cloudCover !== null && data.cloudCover !== undefined) clouds.push(data.cloudCover);
            if ((data.snow || 0) > 0 && data.snowQuality) qualities.push(data.snowQuality);
        });

        return {
            ...totals,
            freezing,
            nightMin,
            windMax,  // m/s
            cloudCover: clouds.length ? clouds.reduce((a, c) => a + c, 0) / clouds.length : null,
            snowQuality: qualities.length
                ? (qualities.filter(q => q === 'dry').length > qualities.length / 2 ? 'dry' : 'wet')
                : null,
            sixHourly: entries.some(e => e.hours === 6),
            // Modèle qui a servi le plus d'heures ce jour-là (null si la source ne le dit pas)
            model: Object.keys(models).sort((a, b) => models[b] - models[a])[0] || null
        };
    },

    // Résumés de chaque source et verdict d'un jour pour un point (pointData = DataService.state.data[key])
    dayVerdict(pointData, day) {
        const summaries = {};
        for (const key of ['openmeteo', 'arome', 'metno']) {
            const src = pointData.sources[key];
            summaries[key] = src ? this.daySummary(day, pointData.series, src) : null;
        }
        return { summaries, verdict: this.computeVerdict(summaries, pointData.elevation) };
    },

    // Verdict d'un jour selon les modèles disponibles. summaries = { source: daySummary | null }.
    // mode : 'snow' | 'rain' | 'dry' (la grandeur qui décide de la journée), range : fourchette de
    // cette grandeur entre modèles (températures pour un jour sec), diverge : null s'il n'y a
    // qu'un modèle. freezing.position situe l'isotherme par rapport au point.
    computeVerdict(summaries, elevation) {
        const T = this.VERDICT;
        const sources = Object.keys(summaries).filter(k => summaries[k]);
        if (!sources.length) return null;
        // Une source qui ne couvre qu'une partie de la journée (MET.no le soir) fausserait la
        // fourchette : ses 0 cm sur 4 h passeraient pour un désaccord. Elle ne compte que si
        // aucune source ne couvre toute la journée.
        const full = sources.filter(k => !summaries[k].period);
        const basis = full.length ? full : sources;
        const list = basis.map(k => summaries[k]);
        const spread = values => Math.max(...values) - Math.min(...values);

        const snow = list.map(s => s.snow), rain = list.map(s => s.rain);
        const mode = Math.max(...snow) >= T.snowCm ? 'snow'
            : Math.max(...rain) >= T.rainMm ? 'rain' : 'dry';

        const mins = list.map(s => s.tempMin).filter(v => v !== null);
        const maxs = list.map(s => s.tempMax).filter(v => v !== null);
        const tempMin = mins.length ? Math.min(...mins) : null;
        const tempMax = maxs.length ? Math.max(...maxs) : null;

        let range, diverge = null, contradict = false;
        if (mode === 'dry') {
            range = { lo: tempMin, hi: tempMax };
            if (list.length > 1) diverge = spread(mins) >= T.divergeTempC || spread(maxs) >= T.divergeTempC;
        } else {
            const values = mode === 'snow' ? snow : rain;
            range = { lo: Math.min(...values), hi: Math.max(...values) };
            if (list.length > 1) {
                diverge = (range.hi - range.lo) >= (mode === 'snow' ? T.divergeSnowCm : T.divergeRainMm)
                    && range.hi / Math.max(range.lo, 0.1) >= T.divergeRatio;
                contradict = (range.hi - range.lo) >= (mode === 'snow' ? T.contradictSnowCm : T.contradictRainMm)
                    && range.hi / Math.max(range.lo, 0.1) >= T.contradictRatio;
            }
        }

        const withFreezing = list.filter(s => s.freezing.min !== null);
        let freezing = { min: null, max: null, position: null };
        if (withFreezing.length && elevation) {
            const min = Math.min(...withFreezing.map(s => s.freezing.min));
            const max = Math.max(...withFreezing.map(s => s.freezing.max));
            freezing = { min, max, position: min > elevation ? 'above' : max < elevation ? 'below' : 'around' };
        }

        const qualities = list.map(s => s.snowQuality).filter(q => q);
        const nights = list.map(s => s.nightMin).filter(v => v !== null);
        const winds = list.map(s => s.windMax).filter(v => v !== null);
        const clouds = list.map(s => s.cloudCover).filter(v => v !== null);

        return {
            mode,
            sources,
            basis,  // sources retenues pour la fourchette et l'accord
            range,
            diverge,
            contradict,  // écart tel que la prévision est peu fiable (neige ou pluie seulement)
            tempMin,
            tempMax,
            freezing,
            snowQuality: qualities.length ? (qualities.includes('wet') ? 'wet' : 'dry') : null,
            alsoRain: mode === 'snow' && Math.max(...rain) >= T.rainMm,
            nightMin: nights.length ? Math.min(...nights) : null,
            windMax: winds.length ? Math.max(...winds) : null,  // m/s
            cloudCover: clouds.length ? clouds.reduce((a, c) => a + c, 0) / clouds.length : null,
            // Sources qui ne couvrent qu'une partie de la journée (MET.no le soir, AROME en fin d'horizon)
            partial: sources.filter(k => summaries[k].period)
        };
    },

    // entries = [{ time, data, hours }] : une heure (hours 1) ou un pas de 6 h (hours 6)
    computeTotals(entries) {
        let snow = 0, rain = 0;
        const temps = [];

        // Période réellement couverte : une source peut ne pas couvrir toute la journée
        // (MET.no ne renvoie pas les heures passées, AROME s'arrête en cours de journée)
        let from = null, to = null, hours = 0;
        const cover = (time, duration) => {
            const start = Utils.parseTime(time).getTime();
            const end = start + duration * 3600000;
            from = from === null ? start : Math.min(from, start);
            to = to === null ? end : Math.max(to, end);
            hours += duration;
        };

        entries.forEach(({ time, data, hours: duration }) => {
            snow += data.snow || 0;
            rain += data.rain || 0;

            // Un pas de 6 h apporte son minimum et son maximum, une heure sa température
            const values = (duration === 6 ? [data.tempMin, data.tempMax] : [data.temp])
                .filter(v => v !== null && v !== undefined);
            if (values.length) {
                temps.push(...values);
                cover(time, duration);
            }
        });

        return {
            snow,
            rain,
            tempMin: temps.length ? Math.min(...temps) : null,
            tempMax: temps.length ? Math.max(...temps) : null,
            // null si la journée est couverte (tolérance d'1 h pour le calage des pas de 6 h)
            period: from !== null && hours < 23 ? { from, to } : null
        };
    }
};
