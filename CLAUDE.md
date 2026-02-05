# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MeteoFoux is a weather forecasting application for La Foux d'Allos ski resort (French Alps, ~1794m). It provides 7-day forecasts by fusing data from multiple weather APIs, with special focus on snow conditions.

## Development

This is a static web application with a PHP backend proxy. No build step required.

**Local development:** Serve with any PHP-enabled web server (Apache, nginx+php-fpm, or `php -S localhost:8000`).

**Force cache refresh:** Add `?refresh=1` to the proxy URL or use the refresh button in the UI.

**Debug mode:** Set `DEBUG = true` in `index.html` to use local test data from `debug/` folder instead of API calls.

## Architecture

### Data Flow

1. Frontend (`index.html`) requests weather data for 3 geographic points
2. PHP proxy (`meteo-proxy.php`) fetches and fuses data from two APIs:
   - **Open-Meteo** (7 jours): Multi-model fusion prioritizing `best_match`, then Météo-France AROME models (hourly data)
   - **MET.no** (fallback): Norwegian Meteorological Institute API (hourly 0-48h, then 6h intervals)
3. Proxy returns merged JSON with normalized timestamps, cached for 15 minutes in `cache/`
4. Frontend normalizes data and renders with ApexCharts

### Key Files

| File | Purpose |
|------|---------|
| `meteo-proxy.php` | API proxy, data fusion, snow/rain classification, caching |
| `index.html` | Single-page app with all JS (CONFIG, Utils, DataService, DataNormalizer, Charts, Components, App) |
| `style.css` | Responsive styles with CSS variables for dark/light themes |
| `config.php` | Optional HTTP proxy settings (for API calls through a proxy) |

### Backend Data Processing (meteo-proxy.php)

**Snow detection logic:** Precipitation is classified as snow when temperature ≤ 1.5°C AND dew point ≤ 0.5°C.

**Snow quality:** Classified as "dry" when temperature ≤ -2°C OR dew point ≤ -3°C, otherwise "wet".

**Snow-to-Liquid Ratio (SLR):** Uses Roebber method (simplified) calibrated for the Alps. Base ratio 14:1 adjusted by temperature, humidity (>90% = denser snow), and wind speed (>3m/s = compaction). Original Kuchera method kept commented in code for reference.

**Model priority chain:** `best_match` → `meteofrance_arome_france_hd` → `meteofrance_arome_france` → `meteofrance_seamless` → `meteoswiss_icon_seamless`

**Caching:** JSON files in `cache/` with 15-minute TTL, validated by minimum 50KB size.

### Frontend JS Modules (in js/)

- **core.js**: CONFIG, Utils, DataService, DataNormalizer - data fetching and normalization
- **ui.js**: Charts (ApexCharts), Components, App - rendering and state management

### ApexCharts Layout (js/ui.js)

**Différence entre labels offsetX et grid padding :**
- `labels.offsetX` : déplace les valeurs des axes (ex: les chiffres "10", "20" de km/h) sans changer l'espace graphe-légendes
- `grid.padding.left/right` : change l'espace entre le graphe et les légendes (rapproche ou éloigne les légendes du graphe)
- `title.offsetX` : déplace uniquement le titre de l'axe (ex: "km/h", "°C")

**Pour rapprocher les légendes du graphe :** modifier `grid.padding` (valeurs négatives = plus proche)
**Pour déplacer les légendes latéralement :** modifier `labels.offsetX`

### Geographic Points

- Station: 44.2902°N, 6.5689°E
- Vescal: 44.3122°N, 6.5743°E
- Observatoire: 44.2848°N, 6.5356°E

## Weather Icons

Icons in `weather/` are from MET.no (Norwegian Meteorological Institute). Available in PNG, SVG, PDF formats with day/night/polar twilight variants. Symbol codes match MET.no Locationforecast API.

**Known typo:** `lightssleetshowersandthunder` and `lightssnowshowersandthunder` have an extra "s" after "light" (kept for API compatibility).
