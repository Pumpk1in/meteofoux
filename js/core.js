/**
 * MeteoFoux - Core Module
 * Configuration, utilitaires, services de données
 */

const CONFIG = {
    points: [
        { name: 'Station', lat: 44.2902, lon: 6.5689, key: 'station', color: '#309fcf' },
        { name: 'Vescal', lat: 44.3122, lon: 6.5743, key: 'vescal', color: '#866fcc' },
        { name: 'Observatoire', lat: 44.2848, lon: 6.5356, key: 'observatoire', color: '#d866a1' },
    ],
    cacheDuration: 10 * 60 * 1000,  // 10 minutes
    cachePrefix: 'fmeteo_cache_',
    dayLabels: ['DI', 'LU', 'MA', 'ME', 'JE', 'VE', 'SA'],
    charts: {
        maxDays: 7,            // Nombre max de jours avec graphique (0 = désactivé)
        minHourlyPoints: 12,   // Minimum de points hourly pour graphique détaillé
        minSixHourlyPoints: 3  // Minimum de points 6h pour graphique simplifié (4 créneaux max/jour)
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
        const omRaw = rawData.openmeteo?.hourly; // Données brutes pour UV (pas encore dans agrégé)
        const elevation = rawData.elevation || rawData.openmeteo?.elevation || null;

        // Index des données brutes par temps pour lookup UV
        const rawUvIndex = {};
        if (omRaw?.time && omRaw?.uv_index_best_match) {
            omRaw.time.forEach((t, i) => {
                rawUvIndex[t.substring(0, 16)] = omRaw.uv_index_best_match[i] ?? 0;
            });
        }

        const omHourly = this.indexByTime(omAgg?.hourly, (data, idx) => {
            const timeKey = data.time[idx].substring(0, 16);
            // Utiliser Roebber si plus élevé que Open-Meteo (calibré pour les Alpes)
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

        const omSixHourly = this.indexByTime(omAgg?.six_hourly, (data, idx) => {
            // Utiliser Roebber si plus élevé que Open-Meteo (calibré pour les Alpes)
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
        }; });

        // Calculer les jours avec données Open-Meteo complètes (au moins 4 créneaux 6h)
        const omDayCounts = {};
        if (omAgg?.six_hourly?.time) {
            omAgg.six_hourly.time.forEach(t => {
                const day = Utils.getLocalDay(t);
                omDayCounts[day] = (omDayCounts[day] || 0) + 1;
            });
        }
        const omAvailableDays = new Set(
            Object.entries(omDayCounts)
                .filter(([_, count]) => count >= 4)
                .map(([day]) => day)
        );

        const metnoSeries = rawData.metno?.properties?.timeseries || [];
        const series = metnoSeries.map(entry => {
            const timeKey = entry.time.substring(0, 16);
            const dayStr = Utils.getLocalDay(entry.time);
            const isWithinOM = omAvailableDays.has(dayStr);

            return {
                time: entry.time,
                metno: entry,
                om: isWithinOM ? omHourly[timeKey] || null : null,
                om6h: isWithinOM ? omSixHourly[timeKey] || null : null
            };
        });

        return { point, series, omHourly, omSixHourly, elevation, omAvailableDays };
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

    refresh() {
        CONFIG.points.forEach(p => localStorage.removeItem(CONFIG.cachePrefix + p.key));
        setTimeout(() => location.reload(), 150);
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

    prepareEntry(entry, isToday, useOpenMeteo) {
        const prepared = { time: entry.time };

        if (useOpenMeteo) {
            if (isToday && entry.om) {
                prepared.om = entry.om;
            } else if (!isToday && entry.om6h) {
                const hour = Utils.parseTime(entry.time).getUTCHours();
                const isDay = hour >= 6 && hour < 18;

                prepared.om = {
                    temp: entry.om6h.tempMax,
                    windSpeed: entry.om6h.windSpeed,
                    windDir: entry.om6h.windDir,
                    snow: entry.om6h.snow,
                    rain: entry.om6h.rain,
                    precipProb: entry.om6h.precipProb,
                    freezingPoint: entry.om6h.freezingPoint,
                    icon: entry.om6h.icon,
                    snowQuality: entry.om6h.snowQuality,
                    dewPoint: null,
                    isDay: isDay,
                    cloudCover: entry.om6h.cloudCover
                };
            } else {
                prepared.metno = entry.metno;
            }
        } else {
            prepared.metno = entry.metno;
        }

        return prepared;
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
