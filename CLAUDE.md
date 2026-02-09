# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MeteoFoux is a weather forecasting application for La Foux d'Allos ski resort (French Alps, ~1794m). It provides 7-day forecasts by fusing data from multiple weather APIs, with special focus on snow conditions.

## Development

This is a static web application with a PHP backend proxy. No build step required.

**Local development:** Serve with any PHP-enabled web server (Apache, nginx+php-fpm, or `php -S localhost:8000`).

**Force cache refresh:** Add `?refresh=1` to the proxy URL or use the refresh button in the UI.

**Debug mode:** Set `DEBUG_MODE = true` in `js/core.js` to use local test data from `debug/` folder instead of API calls.

## Directory Structure

```
METEOFOUX/
├── index.html              # SPA entry point (HTML structure only)
├── meteo-proxy.php         # PHP API proxy, data fusion, caching
├── style.css               # Responsive CSS with dark/light themes
├── config.php              # Optional HTTP proxy settings
├── .htaccess               # Apache config
├── favicon.png
├── js/
│   ├── core.js             # CONFIG, CustomPoints, Utils, DataService, DataNormalizer
│   └── ui.js               # Charts, Components, App
├── cache/                  # 15-minute cached JSON responses (auto-generated)
├── debug/                  # Test data (data-station.json, etc.)
├── weather/
│   ├── png/                # PNG weather icons (MET.no)
│   ├── svg/                # SVG weather icons (MET.no)
│   ├── pdf/                # PDF weather icons
│   ├── legend.csv          # MET.no symbol code mapping
│   └── README.md
└── .claude/                # Claude settings
```

## Architecture

### Data Flow

```
Browser (index.html)
  └─ App.init()
     ├─ Load custom points from localStorage
     ├─ Restore theme & source from localStorage
     └─ DataService.loadAll()
        └─ For each CONFIG.point:
           └─ fetch(meteo-proxy.php?lat=&lon=&refresh=)
              └─ PHP:
                 ├─ MET.no API → timeseries (hourly 0-48h, then 6h)
                 └─ Open-Meteo API → hourly + daily (7 days)
              └─ PHP enriches & fuses:
                 ├─ Roebber SLR for snowfall calculation
                 ├─ Weather icon determination (WMO codes)
                 ├─ Freezing level correction (inversion handling)
                 └─ MET.no timeseries merging with cache
              └─ Returns JSON: {metno, openmeteo, openmeteo_aggregated, arome_aggregated, meta}
           └─ processPointData() → indexes by time, creates series
     └─ setupDays() + renderNavigation() + render()
        ├─ DataNormalizer → prepareEntry(), toCardData(), toChartData()
        ├─ Components → Summary(), CardsGrid(), WeatherCard()
        └─ Charts → createUnifiedChart() (ApexCharts)
```

### Key Files

| File | Purpose |
|------|---------|
| `meteo-proxy.php` | API proxy, data fusion, snow/rain classification, caching |
| `js/core.js` | CONFIG, CustomPoints, Utils, DataService, DataNormalizer |
| `js/ui.js` | Charts (ApexCharts), Components (HTML generators), App (state & rendering) |
| `index.html` | SPA HTML structure, external lib imports |
| `style.css` | Responsive styles with CSS custom properties for dark/light themes |
| `config.php` | Optional HTTP proxy settings (for API calls through a corporate proxy) |

---

## Backend — meteo-proxy.php

### Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `SNOW_TEMP_THRESHOLD` | 1.5°C | Max temp for snow classification |
| `SNOW_DEW_POINT_THRESHOLD` | 0.5°C | Max dew point for snow classification |
| `DRY_SNOW_TEMP_THRESHOLD` | -2°C | Dry snow temp limit |
| `DRY_SNOW_DEW_POINT_THRESHOLD` | -3°C | Dry snow dew point limit |
| `ROEBBER_BASE_SLR` | 14.0 | Base snow-to-liquid ratio (alpine) |
| `ROEBBER_TEMP_THRESHOLD_K` | 271.16 | -2°C in Kelvin |
| `ROEBBER_HUMIDITY_REF` | 75% | Reference humidity for SLR |
| `ROEBBER_WIND_THRESHOLD` | 3 m/s | Wind compaction threshold |
| `SLR_MIN` / `SLR_MAX` | 5.0 / 25.0 | SLR clamp range |
| `SNOW_LIGHT_THRESHOLD` | 1.0 cm | Light snow intensity |
| `SNOW_HEAVY_THRESHOLD` | 2.5 cm | Heavy snow intensity |
| `RAIN_LIGHT_THRESHOLD` | 2.5 mm | Light rain intensity |
| `RAIN_HEAVY_THRESHOLD` | 7.5 mm | Heavy rain intensity |
| `SLEET_LIGHT_THRESHOLD` | 1.0 mm | Light sleet intensity |
| `SLEET_HEAVY_THRESHOLD` | 2.5 mm | Heavy sleet intensity |
| `CACHE_DURATION` | 900s (15 min) | Cache TTL |
| `CACHE_MIN_SIZE` | 51200 (50 KB) | Minimum valid cache file size |

### Functions

#### Data Fetching
- **`get_curl_handle($url, $proxy_host, $proxy_port, $proxy_user, $proxy_pass)`** — Creates CURL handle with optional HTTP proxy support

#### Snow/Precipitation Detection
- **`is_snow_conditions($temp, $dew_point)`** — Returns true if temp ≤ 1.5°C AND dew_point ≤ 0.5°C
- **`get_snow_quality($snowfall, $temp, $dew_point)`** — Returns `'dry'`, `'wet'`, or `null`
- **`calculate_roebber_slr($temp, $humidity, $wind_speed)`** — Snow-to-Liquid Ratio (Roebber method, alpine calibration). Base 14:1, adjusted by temp (2x above -2°C), humidity (>90% = denser), wind (>3 m/s = compaction). Returns 5.0–25.0
- **`calculate_snowfall_from_slr($precipitation, $slr)`** — Converts precipitation mm to snowfall cm using SLR
- **`classify_precipitation($precip, $temp, $dew_point, $humidity, $wind_speed)`** — Full classification. Returns array: `{snowfall, rain, snow_quality, roebber_slr, snowfall_roebber}`

#### Calculations
- **`calculate_dew_point($temp, $humidity)`** — Magnus-Tetens formula (±0.4°C, range -40°C to +50°C)
- **`correct_freezing_level($freezing_level, $freezing_level_fallback, $temp, $elevation)`** — Handles temperature inversions. Validates freezing_level vs elevation+temp coherence. Falls back to meteoswiss_icon_seamless. Returns `{value, corrected, source}`

#### Weather Icon Resolution
- **`resolve_precip_icon($type, $showers, $thunder, $is_day, $suffix)`** — Maps precipitation type → MET.no icon code. Handles thunder/showers variants. Accounts for known MET.no typos (`lightssleet...`, `lightssnow...`)
- **`determine_symbol($snowfall, $rain, $wmo_code, $is_day)`** — Selects weather icon with priority: WMO sleet codes (56,57,66,67,68,69) → rain+snowfall sleet → snowfall only → rain only → WMO fallback → cloud cover codes

#### Data Enrichment
- **`enrich_openmeteo_hourly($openmeteo, $elevation, $priorities)`** — Multi-model fusion for Open-Meteo. Implements priority chains (best_match → AROME HD → seamless → AROME). Corrects weather_code ↔ precipitation inconsistencies. Applies Roebber SLR. Converts wind km/h → m/s. Returns enriched hourly array with 23+ keys
- **`aggregate_hourly_to_6h($hourly)`** — Converts hourly data to 6-hour blocks (0h, 6h, 12h, 18h). Min/max temps, max wind, dominant weather code, summed precipitation
- **`enrich_metno_timeseries($metno)`** — Enriches MET.no data with dew point calculation and Roebber classification for next_1_hours and next_6_hours periods

### Model Priority Chain

- **Default:** `best_match` → `meteofrance_arome_france_hd` → `meteofrance_arome_france` → `meteofrance_seamless` → `meteoswiss_icon_seamless`
- **Cloud cover:** Uses ARPEGE (better than AROME for clouds)
- **Precipitation probability:** `seamless` only

### Output Format

The proxy returns JSON with 5 keys:
- `metno` — Raw MET.no data + enriched timeseries
- `openmeteo` — Raw Open-Meteo data
- `openmeteo_aggregated` — Enriched best_match data (hourly + 6-hourly)
- `arome_aggregated` — AROME-only data (hourly + 6-hourly)
- `meta` — Metadata: sources, methods, timestamps

### Caching

- JSON files in `cache/` with 15-minute TTL
- Validated by minimum 50KB file size
- MET.no timeseries are merged with existing cache (keeps old entries, updates/adds new)

---

## Frontend — js/core.js

### CONFIG Object

```javascript
points: [
  { name: 'Station',       lat: 44.2902, lon: 6.5689, key: 'station',       color: '#309fcf' },
  { name: 'Observatoire',  lat: 44.2848, lon: 6.5356, key: 'observatoire',  color: '#d866a1' },
  { name: 'Marin-Pascal',  lat: 44.2935, lon: 6.5904, key: 'marin-pascal',  color: '#de9333' },
  { name: 'Vescal',        lat: 44.3122, lon: 6.5743, key: 'vescal',        color: '#866fcc' }
]
dayLabels: ['DI', 'LU', 'MA', 'ME', 'JE', 'VE', 'SA']
charts: { maxDays: 7, minHourlyPoints: 12, minSixHourlyPoints: 3 }
```

### CustomPoints Module

Manages user-added geographic points (stored in localStorage, max 6, France mainland only).

- **`init()`** — Load saved custom points, migrate colors if needed
- **`getSaved()`** — Retrieve from localStorage
- **`save(points)`** — Persist to localStorage
- **`add(name, lat, lon)`** — Add custom point (validation: max 6, France bounds)
- **`remove(key)`** — Delete custom point
- **`generateKey(name, saved)`** — Create unique key from name
- **`nextColor(saved)`** — Get next available color from palette
- **`isInFrance(lat, lon)`** — Validate coords (41.3–51.1°N, -5.2–9.6°E)
- **`saveOrder(keys)`** — Save drag-reordered point list
- **`applyOrder()`** — Apply saved order on init

### Utils Module

Formatting and calculation helpers.

- **`windDirection(deg)`** — Bearing → cardinal (N, NE, E, SE, S, SO, O, NO)
- **`msToKmh(ms)`** — m/s → km/h
- **`formatDateLabel(dateStr)`** — Full French date (e.g., "mercredi 12 février")
- **`formatDateShort(dateStr)`** — Short French date (e.g., "mer. 12 février")
- **`formatTimeLabel(date)`** — Time HH:MM
- **`formatHourShort(date)`** — Hour only (e.g., "14h")
- **`periodLabel(hour)`** — Maps hour → period: Nuit (0–5), Matin (6–11), Midi (12–17), Soir (18–23)
- **`visibleCardCount()`** — Returns 4 (number of cards shown initially)
- **`parseTime(timeStr)`** — Parse GMT timestamp, appends Z if needed
- **`getLocalDay(timeStr)`** — Extract YYYY-MM-DD local date
- **`getDayOfWeek(dateStr)`** — 0=Sunday
- **`isToday(dateStr)`** — Boolean check
- **`isMobile()`** — `window.innerWidth < 768`
- **`getChartDataAvailability(day, omHourly, omSixHourly, series, useOpenMeteo)`** — Returns `{type: 'hourly'|'sixhourly'|'none', count}`

### DataService Module

API calls and data processing. Stores state per point key.

- **`state`** — `{data[pointKey]: {point, series, elevation, omHourly, omSixHourly, omAvailableDays, aromeHourly, aromeSixHourly, aromeAvailableDays}}`
- **`loadAll(forceRefresh)`** — Sequential load of all CONFIG.points (100ms delay between calls). Uses debug JSON if `DEBUG_MODE = true`
- **`fetchPointData(point, forceRefresh, retryCount)`** — Calls meteo-proxy.php with 35s timeout, 1 retry on error
- **`processPointData(point, rawData, now)`** — Processes raw response: creates omHourly/omSixHourly indexed by `YYYY-MM-DDTHH:MM`, builds series with merged metno + openmeteo data
- **`indexByTime(data, mapper)`** — Array → object indexed by `time.substring(0,16)`
- **`loadSinglePoint(point, forceRefresh)`** — Load one point (used for custom points)

### DataNormalizer Module

Formats raw data for UI consumption.

- **`MIN_PRECIP`** — 0.5 (minimum displayable precipitation)
- **`toCardData(entry, isHourlyView)`** — Formats entry → card display object: `{icon, temp, windDir, windSpeed, snow, rain, precipProb, freezingPoint, snowQuality, isDay, cloudCover}`. Prefers `entry.om` (Open-Meteo) over `entry.metno`
- **`prepareEntry(entry, isToday, source)`** — Selects hourly (today) vs 6-hourly (future) data per source (`'openmeteo'|'arome'|'metno'`)
- **`toChartData(day, sourceData, pointData, useOMData, dataType)`** — Converts to ApexCharts format: array of `{time, temp, apparent_temperature, windSpeed, wind_gusts, snow, rain, uv_index, icon}`
- **`computeTotals(entries, isHourlyView)`** — Sums snow/rain, finds min/max temps across entries

---

## Frontend — js/ui.js

### Charts Module

ApexCharts wrapper for multi-axis weather charts.

- **`instances`** — Stores chart objects by containerId
- **`instanceMeta`** — Stores `{hasExtendedData}` per chart
- **`getSeriesColors(isDark, hasExtendedData)`** — Returns color array. Extended (Open-Meteo): 7 colors. Basic (MET.no): 5 colors
- **`getBaseOptions(isDark)`** — Base ApexCharts config: theme, grid, tooltip, legend, xaxis
- **`createUnifiedChart(containerId, data, isDark, hasExtendedData, iconByHour)`** — Creates multi-axis chart:
  - Y-axis 0: Température (°C, left, orange line)
  - Y-axis 1: Ressenti (°C, if extended, same axis as temp, line)
  - Y-axis 2: Vent (km/h, right, cyan line) + Rafales (if extended, line)
  - Y-axis 3: UV (right, opposite)
  - Y-axis 4: Neige (column, blue)
  - Y-axis 5: Pluie (column, blue)
  - Adds weather SVG icons below X-axis on animation end
- **`destroyAll()`** — Destroys all chart instances
- **`updateTheme(isDark)`** — Updates all charts' colors and theme
- **`addWeatherIcons(containerId, iconByHour)`** — Overlays weather SVG icons below X-axis labels

### Components Module

HTML generators (return HTML strings).

- **`Skeleton()`** — Loading skeleton with animated bars
- **`Summary(totals, freezing, elevation)`** — Summary bar: min/max temp, snow total, rain total, freezing min/max (if available & >100m)
- **`ChartSection(day, pointKey)`** — Empty chart div with unique ID
- **`CardsGrid(entries, isToday)`** — Grid of WeatherCards. Shows 4 initially, hides extras with "Voir heures suivantes" button for today
- **`CardsGridTomorrow(periodEntries, hourlyEntries, day)`** — Dual grid: 4 periods (default visible) + all hourly (hidden). Toggle button switches between views
- **`WeatherCard(label, data, extraClass)`** — Individual card: time label, weather icon (48x48 SVG), temperature, wind direction + speed, cloud cover %, snow amount + quality (`'sèche'`/`'hum.'`), rain amount

### App Module

Main application state & logic.

#### State
```javascript
{
  currentDay,                    // Selected day (YYYY-MM-DD)
  currentPoint,                  // Selected point key
  globalSource,                  // 'openmeteo' | 'arome' | 'metno'
  theme,                         // 'dark' | 'light'
  days,                          // Array of day strings
  expandedDays,                  // Set of expanded future days
  todayHoursExpanded             // Boolean: today's extra hours visible
}
```

#### Lifecycle
- **`init()`** — Load custom points, restore theme & source from localStorage, load all data via DataService, setup days, render navigation, render content
- **`setupDays()`** — Extract unique days from series, filter ≥ today, slice to 7 max
- **`render()`** — Main render: destroys old charts, renders currentDay only on mobile or all days on desktop, restores expanded states, calls renderCharts()

#### Navigation
- **`renderNavigation()`** — Generates HTML for day buttons + altitude tabs
- **`selectDay(day)`** — Switch active day, scroll to top, re-render
- **`selectPoint(pointKey)`** — Switch active point, re-render
- **`updateSourceToggle()`** — Updates button label & `data-source` attribute
- **`updateTopBar()`** — Updates header date display

#### Data Source & Theme
- **`toggleGlobalSource()`** — Cycles: openmeteo → arome → metno → openmeteo, saves to localStorage
- **`toggleTheme()`** — Switches dark ↔ light, updates charts, saves to localStorage

#### Rendering
- **`renderDayContent(day, pointData, isToday, useOMData, canToggle, source, sourceData)`** — Generates day section HTML: header, summary bar, chart div, cards grid, toggle buttons
- **`renderCharts()`** — Iterates days, calls renderChartForDay
- **`renderChartForDay(day, pointData, useOMData, dataType, sourceData)`** — Formats chart data, calls Charts.createUnifiedChart

#### Custom Points (Leaflet Map)
- **`loadLeaflet()`** — Dynamically loads Leaflet CSS/JS
- **`openAddPointModal()`** — Creates modal with: name input, Leaflet map (click-to-add, draggable marker), coords display, GPS manual input toggle
- **`initMap()`** — Setup Leaflet map (France bounds), OpenStreetMap tiles, circle markers for existing points
- **`placeMarker(map, lat, lng)`** — Place/update draggable marker on map
- **`updateCoordsDisplay(lat, lng)`** — Update modal coordinates display
- **`closeAddPointModal()`** — Cleanup Leaflet, remove modal
- **`toggleManualGPS()`** — Show/hide lat/lon input fields
- **`applyManualGPS()`** — Validate & apply manual coordinates
- **`confirmAddPoint()`** — Add point via CustomPoints, load data, update UI
- **`confirmDeletePoint(key)`** — Delete point, switch to Station if current, re-render

#### Interactions
- **`refreshData()`** — Force-refresh from PHP (shows skeleton loader)
- **`toggleMore(btn)`** — Expand "Voir heures suivantes" for today
- **`toggleTomorrowView(btn, day)`** — Toggle between 4 periods & all hourly for future days
- **`initDragReorder()`** — Touch/mouse drag to reorder altitude tabs (400ms long-press, vibration feedback, saves order via CustomPoints)

---

## CSS — style.css

### Theme Variables (Dark)

```css
--bg: #020617;           --bg-secondary: #0f172a;
--card: rgba(255,255,255, 0.075);  --card-hover: rgba(255,255,255, 0.09);
--text: #e5e7eb;         --muted: #94a3b8;
--accent: #38bdf8;       --accent2: #a78bfa;       --accent3: #f472b6;
--border: rgba(255,255,255, 0.08);
--top-bar-height: 60px;  --bottom-nav-height: 100px;
```

Light theme inverts colors (white bg, dark text, same accents adjusted).

### Key Layout Classes

| Class | Description |
|-------|-------------|
| `.top-bar` | Fixed 60px header, flex row, backdrop blur |
| `.bottom-nav` | Fixed bottom nav, altitude tabs + day navigation |
| `.altitude-tabs` | Horizontal scrollable flex, point selection |
| `.day-nav` | Centered flex row, day buttons |
| `main` | Max 900px, centered, 1rem padding |
| `.day-section` | Card with date header, summary, chart, cards grid |
| `.skeleton-loader` | Loading state with pulse animation |

### Source Color Indicators

| Class | Color | Source |
|-------|-------|--------|
| `.source-toggle.is-openmeteo` | Blue tint | Open-Meteo |
| `.source-toggle.is-arome` | Purple tint | AROME |
| `.source-toggle.is-metno` | Orange tint | MET.no |

Day sections also get subtle background tint per source via `data-source` attribute.

### Responsive Breakpoints

- **≥768px** — Desktop: bottom-nav horizontal, all days visible
- **≥600px** — Tablet: 4-column card grid
- **≥400px** — Mobile: 2-column card grid
- **<400px** — Small mobile: adjusted chart height, hidden day-header

### ApexCharts Layout Notes

- `labels.offsetX` : déplace les valeurs des axes (ex: les chiffres "10", "20" de km/h) sans changer l'espace graphe-légendes
- `grid.padding.left/right` : change l'espace entre le graphe et les légendes (rapproche ou éloigne les légendes du graphe)
- `title.offsetX` : déplace uniquement le titre de l'axe (ex: "km/h", "°C")
- **Pour rapprocher les légendes du graphe :** modifier `grid.padding` (valeurs négatives = plus proche)
- **Pour déplacer les légendes latéralement :** modifier `labels.offsetX`

---

## Key Algorithms

### Snow Detection & Classification

1. **Snow conditions:** temp ≤ 1.5°C AND dew_point ≤ 0.5°C → SNOW
2. **Snow quality:** dry if temp ≤ -2°C OR dew_point ≤ -3°C, otherwise wet
3. **Roebber SLR:** base 14:1 × temp_adj × humidity_adj × wind_adj, clamped 5–25
4. **Snowfall conversion:** `precip_mm × SLR / 10 = snowfall_cm`

### Weather Icon Selection (WMO Priority)

1. WMO sleet codes (56,57,66,67,68,69) → sleet icon
2. Both rain > 0 AND snowfall > 0 → sleet icon (intensity-based)
3. Snowfall > 0 only → snow icon (light/normal/heavy)
4. Rain > 0 only → rain icon (light/normal/heavy)
5. No precip → WMO fallback (codes 51–99)
6. Clear → WMO codes 0–3 (clearsky/fair/partlycloudy/cloudy)

### Freezing Level Correction

If model says freezing > elevation AND temp ≤ 0°C:
- Try meteoswiss_icon_seamless fallback
- If both fail, set to elevation + mark "corrected"

---

## Geographic Points

| Point | Latitude | Longitude | Color |
|-------|----------|-----------|-------|
| Station | 44.2902°N | 6.5689°E | `#309fcf` (blue) |
| Observatoire | 44.2848°N | 6.5356°E | `#d866a1` (pink) |
| Marin-Pascal | 44.2935°N | 6.5904°E | `#de9333` (orange) |
| Vescal | 44.3122°N | 6.5743°E | `#866fcc` (purple) |

Custom points: up to 6, France mainland only (41.3–51.1°N, -5.2–9.6°E), stored in localStorage.

## Weather Icons

Icons in `weather/` are from MET.no (Norwegian Meteorological Institute). Available in PNG, SVG, PDF formats with day/night/polar twilight variants. Symbol codes match MET.no Locationforecast API.

**Known typo:** `lightssleetshowersandthunder` and `lightssnowshowersandthunder` have an extra "s" after "light" (kept for API compatibility).

## External Libraries

- **ApexCharts** — Charting library for multi-axis weather charts
- **Lucide** — Icon library (wind, snowflake, thermometer, etc.)
- **Leaflet** — Map library for custom point selection (loaded on demand)

## localStorage Keys

| Key | Content |
|-----|---------|
| `meteo-theme` | `'dark'` or `'light'` |
| `meteo-source` | `'openmeteo'`, `'arome'`, or `'metno'` |
| `meteo-custom-points` | JSON array of custom geographic points |
| `meteo-points-order` | JSON array of point keys (drag-reorder) |
