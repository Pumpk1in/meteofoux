/**
 * MeteoFoux - Core Module
 * Configuration, utilitaires, services de données
 */

const CONFIG = {
    points: [
        { name: 'Station', lat: 44.2902, lon: 6.5689, key: 'station', color: '#309fcf' },
        { name: 'Observatoire', lat: 44.2848, lon: 6.5356, key: 'observatoire', color: '#d866a1' },
        { name: 'Marin-Pascal', lat: 44.2935, lon: 6.5904, key: 'marin-pascal', color: '#de9333' },
        { name: 'Vescal', lat: 44.3122, lon: 6.5743, key: 'vescal', color: '#866fcc' }
    ],
    dayLabels: ['DI', 'LU', 'MA', 'ME', 'JE', 'VE', 'SA'],
    charts: {
        maxDays: 7,            // Nombre max de jours avec graphique (0 = désactivé)
        minHourlyPoints: 12,   // Minimum de points hourly pour graphique détaillé
        minSixHourlyPoints: 3  // Minimum de points 6h pour graphique simplifié (4 créneaux max/jour)
    }
};

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

    // Formate heure courte (ex: "14h")
    formatHourShort: (date) => date.getHours() + 'h',

    // Label pour période 6h
    periodLabel: (hour) => ['Nuit', 'Matin', 'Midi', 'Soir'][hour / 6],

    // Nombre de cartes visibles selon l'écran
    visibleCardCount: () => window.innerWidth >= 1024 ? 4 : 4,

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
     * @param {object} omHourly - Données horaires Open-Meteo indexées
     * @param {object} omSixHourly - Données 6h Open-Meteo indexées
     * @param {array} series - Série MET.no
     * @param {boolean} useOpenMeteo - Si on utilise Open-Meteo ou MET.no
     * @returns {{ type: 'hourly'|'sixhourly'|'none', count: number }}
     */
    getChartDataAvailability(day, omHourly, omSixHourly, series, useOpenMeteo) {
        if (useOpenMeteo) {
            // Compter les données hourly Open-Meteo
            const hourlyCount = omHourly
                ? Object.keys(omHourly).filter(t => this.getLocalDay(t) === day).length
                : 0;

            if (hourlyCount >= CONFIG.charts.minHourlyPoints) {
                return { type: 'hourly', count: hourlyCount };
            }

            // Fallback sur six_hourly
            const sixHourlyCount = omSixHourly
                ? Object.keys(omSixHourly).filter(t => this.getLocalDay(t) === day).length
                : 0;

            if (sixHourlyCount >= CONFIG.charts.minSixHourlyPoints) {
                return { type: 'sixhourly', count: sixHourlyCount };
            }
        } else {
            // MET.no : compter next_1_hours
            const hourlyCount = series.filter(e => {
                if (!e.metno?.data?.next_1_hours) return false;
                return this.getLocalDay(e.time) === day;
            }).length;

            if (hourlyCount >= CONFIG.charts.minHourlyPoints) {
                return { type: 'hourly', count: hourlyCount };
            }

            // Fallback sur next_6_hours
            const sixHourlyCount = series.filter(e => {
                if (!e.metno?.data?.next_6_hours) return false;
                return this.getLocalDay(e.time) === day;
            }).length;

            if (sixHourlyCount >= CONFIG.charts.minSixHourlyPoints) {
                return { type: 'sixhourly', count: sixHourlyCount };
            }
        }

        return { type: 'none', count: 0 };
    }
};

// === MODE DEBUG : Charger data.json au lieu du PHP ===
const DEBUG_MODE = false; // Mettre à false pour utiliser le PHP

// Service de fetch des data
const DataService = {
    state: { data: {} },

    async loadAll(forceRefresh = false) {
        const now = Date.now();

        if (DEBUG_MODE) {
            // Mode debug : charger un JSON par point (data-{key}.json)
            await Promise.all(CONFIG.points.map(async (point) => {
                try {
                    const resp = await fetch(`debug/data-${point.key}.json`);
                    const rawData = await resp.json();
                    this.state.data[point.key] = this.processPointData(point, rawData, now);
                } catch (e) {
                    // Fallback sur data.json si le fichier spécifique n'existe pas
                    const rawData = await this.fetchDebugData();
                    this.state.data[point.key] = this.processPointData(point, rawData, now);
                }
            }));
        } else {
            // Mode normal : appeler le PHP pour chaque point avec délai
            for (let i = 0; i < CONFIG.points.length; i++) {
                const point = CONFIG.points[i];
                if (i > 0) await new Promise(r => setTimeout(r, 100));
                const rawData = await this.fetchPointData(point, forceRefresh);
                this.state.data[point.key] = this.processPointData(point, rawData, now);
            }
        }

        return this.state.data;
    },

    async fetchDebugData() {
        const resp = await fetch('data.json');
        return await resp.json();
    },

    async fetchPointData(point, forceRefresh = false, retryCount = 0) {
        const url = `https://lafoux.igloo.ovh/meteo-proxy.php?lat=${point.lat}&lon=${point.lon}${forceRefresh ? '&refresh=1' : ''}`;

        // Timeout de 45 secondes (le PHP peut être lent si cache expiré)
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
                throw new Error(`Timeout loading ${point.key} (45s)`);
            }
            throw error;
        }
    },

    processPointData(point, rawData, now) {
        const omAgg = rawData.openmeteo_aggregated;
        const aromeAgg = rawData.arome_aggregated;
        const omRaw = rawData.openmeteo?.hourly; // Données brutes pour UV (pas encore dans agrégé)
        const elevation = rawData.elevation || rawData.openmeteo?.elevation || null;

        // Index des données brutes par temps pour lookup UV
        const rawUvIndex = {};
        if (omRaw?.time && omRaw?.uv_index_best_match) {
            omRaw.time.forEach((t, i) => {
                rawUvIndex[t.substring(0, 16)] = omRaw.uv_index_best_match[i] ?? 0;
            });
        }

        // Fonction commune pour créer les données horaires
        const createHourlyData = (agg) => this.indexByTime(agg?.hourly, (data, idx) => {
            const timeKey = data.time[idx].substring(0, 16);
            const snowOM = data.snowfall[idx] || 0;
            const snowRoebber = data.snowfall_roebber?.[idx] || 0;

            return {
                temp: data.temperature[idx],
                apparent_temperature: data.apparent_temperature?.[idx] ?? data.temperature[idx],
                dewPoint: data.dew_point[idx],
                humidity: data.humidity?.[idx] ?? 0,
                windSpeed: data.wind_speed[idx],
                wind_gusts: data.wind_gusts?.[idx] ?? data.wind_speed[idx],
                windDir: data.wind_direction[idx],
                snow: Math.max(snowOM, snowRoebber),
                rain: data.rain[idx] || 0,
                precipProb: data.precipitation_probability[idx] || 0,
                freezingPoint: data.freezing_point[idx],
                freezingPointCorrected: data.freezing_point_corrected?.[idx] || false,
                icon: data.symbol_code[idx],
                snowQuality: data.snow_quality[idx],
                isDay: data.is_day[idx],
                uv_index: data.uv_index?.[idx] ?? rawUvIndex[timeKey] ?? 0,
                cloudCover: data.cloud_cover?.[idx] ?? null
            };
        });

        // Fonction commune pour créer les données 6h
        const createSixHourlyData = (agg) => this.indexByTime(agg?.six_hourly, (data, idx) => {
            const snowOM = data.snowfall[idx] || 0;
            const snowRoebber = data.snowfall_roebber?.[idx] || 0;
            return {
                tempMin: data.temperature_min[idx],
                tempMax: data.temperature_max[idx],
                windSpeed: data.wind_speed_max[idx],
                windDir: data.wind_direction[idx],
                snow: Math.max(snowOM, snowRoebber),
                rain: data.rain[idx] || 0,
                precipProb: data.precipitation_probability[idx] || 0,
                freezingPoint: data.freezing_point[idx],
                freezingPointCorrected: data.freezing_point_corrected?.[idx] || false,
                icon: data.symbol_code[idx],
                snowQuality: data.snow_quality[idx],
                cloudCover: data.cloud_cover?.[idx] ?? null
            };
        });

        // Fonction pour calculer les jours disponibles (au moins 4 créneaux 6h)
        const calculateAvailableDays = (agg) => {
            const dayCounts = {};
            if (agg?.six_hourly?.time) {
                agg.six_hourly.time.forEach(t => {
                    const day = Utils.getLocalDay(t);
                    dayCounts[day] = (dayCounts[day] || 0) + 1;
                });
            }
            return new Set(
                Object.entries(dayCounts)
                    .filter(([_, count]) => count >= 4)
                    .map(([day]) => day)
            );
        };

        // Données Open-Meteo (best_match)
        const omHourly = createHourlyData(omAgg);
        const omSixHourly = createSixHourlyData(omAgg);
        const omAvailableDays = calculateAvailableDays(omAgg);

        // Données AROME (Météo-France uniquement)
        const aromeHourly = createHourlyData(aromeAgg);
        const aromeSixHourly = createSixHourlyData(aromeAgg);
        const aromeAvailableDays = calculateAvailableDays(aromeAgg);

        const metnoSeries = rawData.metno?.properties?.timeseries || [];
        const series = metnoSeries.map(entry => {
            const timeKey = entry.time.substring(0, 16);
            const dayStr = Utils.getLocalDay(entry.time);
            const isWithinOM = omAvailableDays.has(dayStr);
            const isWithinArome = aromeAvailableDays.has(dayStr);

            return {
                time: entry.time,
                metno: entry,
                om: isWithinOM ? omHourly[timeKey] || null : null,
                om6h: isWithinOM ? omSixHourly[timeKey] || null : null,
                arome: isWithinArome ? aromeHourly[timeKey] || null : null,
                arome6h: isWithinArome ? aromeSixHourly[timeKey] || null : null
            };
        });

        return {
            point, series, elevation,
            omHourly, omSixHourly, omAvailableDays,
            aromeHourly, aromeSixHourly, aromeAvailableDays
        };
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
    // Seuil minimum pour afficher les précipitations
    MIN_PRECIP: 0.5,

    toCardData(entry, isHourlyView) {
        if (entry.om) {
            return {
                icon: entry.om.icon || 'clearsky_day',
                temp: entry.om.temp,
                windDir: entry.om.windDir,
                windSpeed: entry.om.windSpeed,
                snow: entry.om.snow || 0,
                rain: entry.om.rain || 0,
                precipProb: entry.om.precipProb,
                freezingPoint: entry.om.freezingPoint,
                snowQuality: entry.om.snowQuality,
                isDay: entry.om.isDay,
                cloudCover: entry.om.cloudCover
            };
        }

        if (entry.metno) {
            const details = entry.metno.data.instant.details;
            // Utiliser next_1_hours si dispo, sinon fallback sur next_6_hours
            const forecast = entry.metno.data.next_1_hours || entry.metno.data.next_6_hours;

            const hour = Utils.parseTime(entry.metno.time).getUTCHours();
            const isDay = hour >= 7 && hour < 17;

            return {
                icon: forecast?.summary?.symbol_code || 'clearsky_day',
                temp: details.air_temperature,
                windDir: details.wind_from_direction,
                windSpeed: details.wind_speed,
                snow: forecast?.details?.snowfall || 0,
                rain: forecast?.details?.rain || 0,
                precipProb: 0,
                snowQuality: forecast?.details?.snow_quality || null,
                isDay: isDay,
                cloudCover: details.cloud_area_fraction ?? null
            };
        }

        return null;
    },

    prepareEntry(entry, isToday, source) {
        const prepared = { time: entry.time };

        // source peut être 'openmeteo', 'arome', ou 'metno'
        // Pour compatibilité, true = 'openmeteo', false = 'metno'
        if (source === true) source = 'openmeteo';
        if (source === false) source = 'metno';

        if (source === 'openmeteo' || source === 'arome') {
            // Sélectionner les bonnes données selon la source
            const hourlyData = source === 'arome' ? entry.arome : entry.om;
            const sixHourlyData = source === 'arome' ? entry.arome6h : entry.om6h;

            if (isToday && hourlyData) {
                prepared.om = hourlyData;
            } else if (!isToday && sixHourlyData) {
                const hour = Utils.parseTime(entry.time).getUTCHours();
                const isDay = hour >= 6 && hour < 18;

                prepared.om = {
                    temp: sixHourlyData.tempMax,
                    windSpeed: sixHourlyData.windSpeed,
                    windDir: sixHourlyData.windDir,
                    snow: sixHourlyData.snow,
                    rain: sixHourlyData.rain,
                    precipProb: sixHourlyData.precipProb,
                    freezingPoint: sixHourlyData.freezingPoint,
                    icon: sixHourlyData.icon,
                    snowQuality: sixHourlyData.snowQuality,
                    dewPoint: null,
                    isDay: isDay,
                    cloudCover: sixHourlyData.cloudCover
                };
            } else {
                prepared.metno = entry.metno;
            }
        } else {
            prepared.metno = entry.metno;
        }

        return prepared;
    },

    // Normalise les données d'un jour en tableau prêt pour les charts,
    // quelle que soit la source (Open-Meteo, AROME, MET.no)
    toChartData(day, sourceData, pointData, useOMData, dataType) {
        const hourlyData = sourceData?.hourly || pointData.omHourly;
        const sixHourlyData = sourceData?.sixHourly || pointData.omSixHourly;
        const isHourly = dataType === 'hourly';

        if (useOMData) {
            const dataSource = isHourly ? hourlyData : sixHourlyData;
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
        }

        // MET.no
        const { series } = pointData;
        return series
            .filter(entry => {
                if (!entry.metno) return false;
                if (Utils.getLocalDay(entry.time) !== day) return false;
                return isHourly
                    ? !!entry.metno.data?.next_1_hours
                    : !!entry.metno.data?.next_6_hours;
            })
            .map(entry => {
                const m = entry.metno;
                const details = m.data?.instant?.details || {};
                const forecastObj = isHourly ? m.data?.next_1_hours : m.data?.next_6_hours;
                const forecast = forecastObj?.details || {};
                const timestamp = Utils.parseTime(m.time).getTime();
                return {
                    time: timestamp,
                    temp: details.air_temperature ?? null,
                    apparent_temperature: details.air_temperature ?? null,
                    windSpeed: details.wind_speed ?? null,
                    wind_gusts: details.wind_speed_of_gust ?? details.wind_speed ?? null,
                    snow: forecast.snowfall || 0,
                    rain: forecast.rain || 0,
                    uv_index: details.ultraviolet_index_clear_sky ?? 0,
                    icon: forecastObj?.summary?.symbol_code || 'clearsky_day'
                };
            });
    },

    computeTotals(entries, isHourlyView) {
        let snow = 0, rain = 0;
        const temps = [];

        entries.forEach(entry => {
            if (entry.om) {
                snow += entry.om.snow || 0;
                rain += entry.om.rain || 0;
                if (entry.om.temp !== null) temps.push(entry.om.temp);
            } else if (entry.metno) {
                const details = entry.metno.data?.instant?.details;
                // Utiliser next_1_hours si dispo, sinon fallback sur next_6_hours
                const forecast = entry.metno.data.next_1_hours || entry.metno.data.next_6_hours;

                if (details) {
                    temps.push(details.air_temperature);
                }

                // Utiliser les valeurs enrichies par le PHP (en cm avec méthode Roebber)
                snow += forecast?.details?.snowfall || 0;
                rain += forecast?.details?.rain || 0;
            }
        });

        return {
            snow,
            rain,
            tempMin: temps.length ? Math.min(...temps) : null,
            tempMax: temps.length ? Math.max(...temps) : null
        };
    }
};
