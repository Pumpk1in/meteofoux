---
name: MeteoFoux
description: Multi-source 7-day mountain forecast for La Foux d'Allos, colour-coded by source and by altitude.
colors:
  bleu-poudreuse: "#38bdf8"
  source-openmeteo: "#38bdf8"
  source-arome: "#a855f7"
  source-metno: "#f59f30"
  source-openmeteo-deep: "#0369a1"
  source-arome-deep: "#7e22ce"
  source-metno-deep: "#b45309"
  point-station: "#309fcf"
  point-observatoire: "#d866a1"
  point-marin-pascal: "#de9333"
  point-vescal: "#866fcc"
  ciel-avant-aube: "#020617"
  ciel-avant-aube-haut: "#0f172a"
  givre-texte: "#e5e7eb"
  ardoise-muted: "#94a3b8"
  panneau-givre: "rgba(255, 255, 255, 0.075)"
  trait-givre: "rgba(255, 255, 255, 0.08)"
  jour-fond: "#e6e6e6"
  jour-fond-haut: "#f2f2f2"
  jour-texte: "#1e293b"
  jour-muted: "#4a5568"
  neige: "#67e8f9"
  pluie: "#60a5fa"
  serie-temperature: "#f97316"
  serie-ressenti: "#fdba74"
  serie-vent: "#98dfb6"
  serie-rafales: "#39b36c"
  serie-uv: "#fbbf24"
  serie-neige: "#67e8f9"
  serie-pluie: "#3b82f6"
  avertissement: "#fbbf24"
  alerte: "#ef4444"
typography:
  display:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 800
    lineHeight: 1
  title:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  body:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
  micro:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0em"
rounded:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  pill: "999px"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "2rem"
components:
  point-title:
    backgroundColor: "transparent"
    textColor: "{colors.givre-texte}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
  icon-button:
    backgroundColor: "rgba(30, 41, 59, 0.4)"
    rounded: "{rounded.sm}"
    size: "44px"
  day-button:
    backgroundColor: "transparent"
    textColor: "{colors.ardoise-muted}"
    rounded: "{rounded.sm}"
    size: "48px"
  day-button-active:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.bleu-poudreuse}"
    rounded: "{rounded.sm}"
  verdict:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "{colors.givre-texte}"
    typography: "{typography.display}"
    rounded: "{rounded.lg}"
    padding: "1rem 0.75rem 0.75rem"
  model-cell:
    backgroundColor: "rgba(255, 255, 255, 0.03)"
    textColor: "{colors.givre-texte}"
    rounded: "{rounded.sm}"
    padding: "0.5rem"
  model-cell-pressed:
    backgroundColor: "rgba(168, 85, 247, 0.18)"
    textColor: "{colors.givre-texte}"
    rounded: "{rounded.sm}"
  day-detail:
    backgroundColor: "rgba(130, 50, 235, 0.3)"
    rounded: "{rounded.lg}"
    padding: "1rem"
  hourly-row:
    backgroundColor: "{colors.panneau-givre}"
    textColor: "{colors.givre-texte}"
    rounded: "{rounded.sm}"
    padding: "0.45rem 0.5rem"
  chart-details-pill:
    backgroundColor: "transparent"
    textColor: "{colors.bleu-poudreuse}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
  button-more:
    backgroundColor: "rgba(255, 255, 255, 0.1)"
    textColor: "{colors.givre-texte}"
    rounded: "{rounded.pill}"
    padding: "0.6rem 1.2rem"
  button-confirm:
    backgroundColor: "{colors.bleu-poudreuse}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "0.5rem 1.2rem"
  input:
    backgroundColor: "{colors.ciel-avant-aube}"
    textColor: "{colors.givre-texte}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.7rem"
---

# Design System: MeteoFoux

## Overview

**Creative North Star: "La salle des cartes"**

The map room is where you spread several readings side by side and decide for yourself. MeteoFoux
puts AROME, Open-Meteo and MET.no, and the points of the ski area from Station to Observatoire, on
the same table, each with its own colour, so you can tell at a glance whose reading you are looking
at and where it applies. The colour is playful on purpose: it is the fun of a tool made by and for
a group of young skiers, and the user wants to keep it. But the room is a professional one. The
figures are the reason it exists, so the chrome stays quiet and the data reads as trustworthy.

Dark by default: a pre-dawn sky gradient behind translucent frosted panels, with a light theme for
the sun. Information density is welcome as long as it stays legible; the user does not object to
dense screens, only to unreadable ones. The surface is read outdoors, in the cold and in bright
sunlight, by people wearing gloves.

This document records the system shipped after the November 2026 redesign (a verdict across the
models at the top of each day, the models as a row of cells that selects the detail, the point
chosen from the title) and the UI bench that followed (tokens, Fira Sans, touch feedback, chart
margins, loading skeleton). The confirmed screen brief is `.impeccable/surfaces/index-php.md`.

**Key Characteristics:**
- Colour is identity: one hue per source, one hue per point, one hue per measured quantity.
- The data is the hero; buttons, cells and toggles must never pull the eye away from it.
- Clear, warm and personal rather than neutral; young, but never at the expense of clarity.
- Translucent layers on a dark gradient, no shadow.
- One self-hosted face, Fira Sans; hierarchy through size and weight on a fixed scale.

## Colors

A deep pre-dawn navy carrying a deliberately multicolour set of identity hues, where every colour
names something: a source, a point, or a weather quantity.

### Primary
- **Bleu poudreuse** (`bleu-poudreuse`): the single interface accent. Active day, focus border of
  inputs, the confirm button, the "Plus de détails" pill, links. Keyboard focus outlines use
  `--focus`: this blue in dark mode, its darker variant `#0369a1` in light mode (≥ 3:1 on white).
  It is also Open-Meteo's identity hue.

### Secondary: source identity
- **Open-Meteo** (`source-openmeteo`), **AROME** (`source-arome`), **MET.no** (`source-metno`):
  the model cell's label and border, and the day detail (chart and hourly rows). In dark mode the
  detail takes an assumed tint (`rgba(14,110,220,.3)`, `rgba(130,50,235,.3)`, `rgba(225,115,15,.26)`;
  `--muted` is one step lighter inside it to keep 4.5:1 on the rows). In light mode a tint over the
  grey page muddied the reading in the sun, so the detail stays white and gets a 3px border in the
  model's deep hue (`source-*-deep`: `#0369a1`, `#7e22ce`, `#b45309`), the same as its selected
  cell; the model name in "Heures selon …" takes it too. Its rows take that hue at 6% on white
  (`#f0f6f9`, `#f7f2fc`, `#fbf5f0`): just enough to stand out from the white, every text stays
  ≥ 4.5:1. When the source changes, the detail changes colour.

### Tertiary: point identity
- **Station**, **Observatoire**, **Marin-Pascal**, **Vescal** (`point-*`): the dot before the point
  name in the top bar and in the point sheet, injected as `--point-color`. Custom points draw from an
  8-colour palette in `js/core.js` (`#26b763 #e67e22 #1abc9c #6c5ce7 #00b894 #fdcb6e #3498db
  #f39c12`).

### Weather quantities
- **Neige** (`neige`, cyan) and **Pluie** (`pluie`, blue): the snow and rain figures of the hourly
  rows, the same hues as the chart bars (light theme: `#0e7490` / `#1d4ed8`); the snowflake and
  drop of the day bar and the point sheet. Snow quality ("humide" / "sèche") is muted text.
- **Chart series**: temperature orange (`serie-temperature`), apparent temperature light orange
  (`serie-ressenti`), wind mint (`serie-vent`), gusts green (`serie-rafales`), UV amber
  (`serie-uv`), snow light cyan columns (`serie-neige`), rain mid-blue columns (`serie-pluie`):
  same family, a clear lightness gap (3:1 between them in dark mode). The light theme uses darker
  variants of the same hues, ≥ 3:1 on white (`js/ui.js`, `getSeriesColors`). Each axis unit takes
  the colour of the series it measures.
- **Avertissement** (`avertissement`, `--warn`; light `#b45309`): "Peu fiable : les modèles se
  contredisent", contradictory days in the day bar, stale data in the top bar, the refresh notice.
- **Alerte** (`alerte`): errors and the delete action of the point sheet only.

### Neutral
- **Ciel avant l'aube** (`ciel-avant-aube` → `ciel-avant-aube-haut`): the vertical body gradient
  in dark mode; the top bar and the day bar sit on it at 95% opacity with a 10px blur.
- **Givre texte** (`givre-texte`): primary text. **Ardoise muted** (`ardoise-muted`): times,
  labels, units, inactive navigation, secondary readings.
- **Panneau givre** (`panneau-givre`) and **Trait givre** (`trait-givre`): the translucent row fill
  and the hairline border.
- Light theme: `jour-fond` → `jour-fond-haut` background, `jour-texte`, `jour-muted`, opaque white
  panels (verdict, day detail), rows inside the detail faintly tinted by the model (see Secondary).

### Named Rules
**The Colour Means Something Rule.** Every hue identifies a source, a point or a weather
quantity. A colour that names nothing does not get added.

**The One Accent Rule.** Interface state (active, focus, confirm, loading) uses Bleu poudreuse
only; identity hues never stand in for interface state. The selected model cell is the one place
where state and identity meet: its border takes the model's colour, because the detail below does.

## Typography

**Font:** Fira Sans (400 to 800, latin subset), self-hosted in `fonts/` (OFL), so it works offline
and on a weak network; the system stack is the fallback. The same face is used in the chart.

**Character:** a humanist sans built for small screens, with clear figures; data columns use
tabular figures (`font-variant-numeric: tabular-nums`). Hierarchy is carried by size and weight,
with the verdict figure as the loudest text on the screen.

### Scale
Only the tokens of `:root` in `style.css` are used, never a raw size:
`--text-micro` 11 px (units, column headers, model names, day-bar indicators) ·
`--text-label` 12 px (times, labels) · `--text-small` 13 px (secondary text, buttons) ·
`--text-body` 14 px (body text, row figures) · `--text-title` 16 px (titles, temperatures,
values) · `--text-heading` 18 px (day header) · `--text-unit` 20 px (verdict unit) ·
`--text-display` 44 px (verdict figure). Chart axis labels stay at 10 px (SVG, set in `js/ui.js`).

### Named Rules
**The Figure First Rule.** A reading (temperature, snow, wind) is always set larger or heavier
than its label. The label explains, the figure informs. In "0 à 26 cm", the connector is smaller
and lighter than the figures.

## Layout

A single column, centred, at most 900px wide (`main`, padding 1rem; 1.5rem from 768px; 0.8rem under
600px). A fixed top bar (60px, plus the iPhone notch: `viewport-fit=cover`, `--safe-top`) holds the
point title and two square icon buttons; its side padding follows `main`, so the title lines up with
the content. A fixed day bar at the bottom holds the seven days (68px on mobile, 60px from 768px).

Each day is a section, in this order:
1. **Header** (desktop only, where every day stacks): the date, "Mardi 10 novembre".
2. **Verdict**: the day across the models, then the row of model cells.
3. **Detail** of the model selected in the cells: "Heures selon AROME", the chart, the hourly rows.

On mobile only the selected day renders; after 18:00 the app opens on tomorrow. The hourly rows are
one column on mobile, two from 768px, filled top to bottom (first half of the day on the left).
Today shows 4 hours then "Voir heures suivantes"; future days show 4 periods (Nuit, Matin, Midi,
Soir, with their local hours) with a toggle to every hour.

Spacing runs on a 4 px grid, as `--space-*` tokens in `style.css` (2, 4, 6, 8, 12, 16, 20, 24, 32,
48, 64 px; 6 px is the one half-step): tight inside rows, 6 px between rows, 16 px between blocks of
a section, 32 px between sections. Only negative margins tuned against ApexCharts stay raw.

## Elevation & Depth

Flat and layered: depth comes from stacked translucency, never from shadow (there is none). The page
gradient, then the verdict panel (a faint white layer) and the day detail (the model's tint in dark
mode, a white panel framed by the model's border in light mode), then the frosted rows. Fixed bars
use a 10px backdrop blur; the point sheet sits on a 55% black backdrop, the add-point modal on a 4px
blur. Rows do not react to hover: they are not clickable.

## Shapes

Soft, friendly corners on four `--radius-*` tokens: `xs` 4 px for skeleton lines, `sm` 8 px for
buttons, inputs, model cells, day buttons and hourly rows, `md` 12 px for sheet rows and notices,
`lg` 16 px for day sections, the verdict, the detail, the sheet and the modal. "Show more" buttons,
chips and the details pill are full pills (`--radius-pill`); dots are circles; the thin bars (model
bars, chart key) keep a 2 px radius. Borders are 1px hairlines in `trait-givre`, except the 1.5px
model cells and the 3px detail border in light mode.

## Components

### Top bar
- **Point title** (a button, opens the point sheet): the point's dot, "Observatoire · 2590 m", a
  chevron; under it, the date and the freshness ("màj il y a 5 min") on mobile, the freshness only on
  desktop (every day there has its own date). Stale data ("données d'il y a 2 h") turns amber.
- **Icon buttons** (refresh, theme): 44px squares, 8px radius, hairline border, faint slate fill,
  18px muted Lucide icon. Refresh spins its icon while loading.

### Day bar
Seven buttons ("AUJ." then the weekday initials), at least 48px tall: the day, then the verdict
indicator for the point shown (snowflake + cm range, drop + mm range, sun + max temperature), its
unit on its own line on mobile. The range turns amber when the models contradict. **Active:** Bleu
poudreuse text, a stronger hairline border and a faint fill.

### Verdict
The answer of the day, readable in one second.
- **Figure:** the decisive quantity across the models (snow, else rain, else temperatures), 44px /
  800, the unit at 20px. "0 à 26 cm" shows both ends when the models contradict, "jusqu'à 18 cm"
  when the lowest rounds to zero.
- **Sentence:** "de neige humide, et de la pluie, selon les 3 modèles", with a "?" that unfolds a
  plain-language note on the models; "selon les 3 modèles ?" never splits. A chip says "Les modèles
  s'accordent", or, in amber, "Peu fiable : les modèles se contredisent".
- **Facts:** temperatures and the freezing level relative to the point ("Limite du gel plus haut
  que le point (2980–3310 m)"); on a dry day, night refreeze and wind.
- **Model cells:** AROME, Open-Meteo, MET.no, one row; each shows its value, a bar against the
  highest model, and its temperatures, covered period or "Toutes les 6 h". They select the model
  shown in the detail. **Selected:** the model's tinted fill and border. **Missing:** dashed,
  "Ne répond pas" or "Ne prévoit pas si loin". The Météo-France cell is named after the model that
  served the day (AROME, ARPEGE), the Open-Meteo cell "ICON-D2" on days best_match copies it.

### Day detail
"Heures selon AROME" (or "Heures selon Open-Meteo · AROME ne prévoit pas si loin" on a relay day),
the chart, the hourly rows. Its colour is the model's (see Secondary).

### Chart
Bare inside the detail, no panel of its own.
- **Key** (HTML, above the plot): one mark per series shown; snow and rain only when the day has
  some. **Units row:** °C on the left, km/h (and UV) on the right, each in its series' colour.
- **Plot:** temperature, wind, snow and rain by default; "Plus de détails" (an outlined pill with a
  chevron, centred on the units row, 44px target) adds apparent temperature, gusts and UV. Axes are
  shared by the three models of the day. A "maintenant" line on today's chart; 22px MET.no weather
  icons under the hours (with a faint outline in light mode).
- **Tick columns** sit in the margins, outside the data, 9px from the edge on both sides; the plot
  stops just before them.

### Hourly rows
- **Shape:** 8px radius, 6px apart, at least 48px tall; `panneau-givre` (the model's hue at 6% in light mode), no
  border: the background is what separates the rows.
- **Content:** hour on the left ("14 h"), or the period name above the row ("Matin · 7–13 h");
  28px weather icon; temperature (a period shows "min° à max°"); snow in cyan and rain in blue, to
  the tenth, then the snow quality; wind direction and speed; cloud cover. Units sit in the column
  header ("Vent km/h" on one line), except cm / mm.
- **Small screens:** everything fits at 320px; a long period range wraps after "à", the snow
  quality drops under its figure, a figure never leaves its unit.

### Point sheet
A bottom sheet opened from the title: "La Foux d'Allos" points sorted by altitude, then "Mes
points", each row with its dot, altitude and the day's verdict ("Chargement…" while unknown); the
current point is highlighted. "Modifier" reveals up/down and delete for custom points; a dashed
"Ajouter un point" row opens the add-point modal (Leaflet map). Focus is trapped inside, Escape
closes it.

### Loading skeleton
`partials/skeleton.html`: the day built from the page's own classes, with pulsing blocks in place of
text, so the data lands where the skeleton was. It is used at startup, on refresh (instead of dimming
the page) and when a point is not loaded yet; the detail takes the chosen model's colour, and the day
bar shows seven placeholder buttons until it is built.

### Buttons and feedback
- **Press:** every button scales to 0.96 while pressed (0.98 for full-width rows), so a tap shows
  at once; hover backgrounds only apply to pointers that hover.
- **Show more:** translucent pill, 13px text.
- **Confirm (modal):** Bleu poudreuse fill, white 600 text; disabled at 40% opacity. **Cancel:**
  transparent, muted text.
- **Notice** (refresh failed): an amber-bordered box at the top of the content; the previous
  forecasts stay below.
- **Missing data:** a dashed box in the detail: "MET.no ne répond pas pour le moment" with
  "Réessayer", or "Météo-France n'a pas de prévision pour ce jour".

### Inputs / Fields
- **Style:** page-background fill, hairline border, 8px radius; uppercase muted label above.
- **Focus:** border turns Bleu poudreuse; the outline is removed.
- **Error:** red text line below the field.

## Do's and Don'ts

### Do:
- **Do** give every source and every point its own hue, and keep it consistent everywhere it
  appears (model cell, detail, title dot, sheet).
- **Do** make the reading (temperature, snow, wind) the most prominent element of any row or
  summary.
- **Do** keep controls large enough to hit with gloves (44px) while staying visually quieter than
  the data they control.
- **Do** keep Bleu poudreuse as the only interface-state accent.
- **Do** design both themes: dark is the default, light must work in direct sunlight.
- **Do** check a layout change against the real page: the skeleton and the chart margins were
  measured in headless Edge, not judged by eye.

### Don't:
- **Don't** let a button, cell or toggle draw the eye away from the data.
- **Don't** add colour that identifies nothing; the multicolour palette is a key, not decoration.
- **Don't** tint a large surface in light mode: over the grey page it muddies the reading; use a
  border.
- **Don't** fall back to a neutral, corporate grey dashboard: the playful multi-source colour is a
  commitment.
- **Don't** let density cost legibility: dense is fine, unreadable is not.
