---
name: MeteoFoux
description: Multi-source 7-day mountain forecast for La Foux d'Allos, colour-coded by source and by altitude.
colors:
  bleu-poudreuse: "#38bdf8"
  source-openmeteo: "#38bdf8"
  source-arome: "#a855f7"
  source-metno: "#f59f30"
  point-station: "#309fcf"
  point-observatoire: "#d866a1"
  point-marin-pascal: "#de9333"
  point-vescal: "#866fcc"
  ciel-avant-aube: "#020617"
  ciel-avant-aube-haut: "#0f172a"
  givre-texte: "#e5e7eb"
  ardoise-muted: "#94a3b8"
  panneau-givre: "rgba(255, 255, 255, 0.075)"
  panneau-givre-hover: "rgba(255, 255, 255, 0.09)"
  trait-givre: "rgba(255, 255, 255, 0.08)"
  jour-fond: "#e6e6e6"
  jour-fond-haut: "#f2f2f2"
  jour-texte: "#1e293b"
  jour-muted: "#596a81"
  neige: "#60a5fa"
  pluie: "#3b82f6"
  neige-seche: "#93c5fd"
  neige-humide: "#8dd7a5"
  serie-temperature: "#f97316"
  serie-ressenti: "#fdba74"
  serie-vent: "#98dfb6"
  serie-rafales: "#39b36c"
  serie-uv: "#fbbf24"
  serie-neige: "#e0f2fe"
  alerte: "#ef4444"
typography:
  display:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 700
    lineHeight: 1
  title:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 600
  body:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
  label:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
  micro:
    fontFamily: "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.62rem"
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
  point-pill:
    backgroundColor: "transparent"
    textColor: "{colors.ardoise-muted}"
    typography: "{typography.micro}"
    rounded: "{rounded.pill}"
    padding: "0.5rem 0.6rem"
  point-pill-active:
    backgroundColor: "{colors.point-station}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
  day-button:
    backgroundColor: "transparent"
    textColor: "{colors.ardoise-muted}"
    rounded: "{rounded.sm}"
    padding: "0.5rem 0.8rem"
  day-button-active:
    textColor: "{colors.bleu-poudreuse}"
  icon-button:
    backgroundColor: "rgba(30, 41, 59, 0.4)"
    rounded: "{rounded.sm}"
    size: "36px"
  source-toggle-arome:
    backgroundColor: "rgba(168, 85, 247, 0.25)"
    textColor: "{colors.source-arome}"
    rounded: "0.4rem"
    size: "36px"
  weather-card:
    backgroundColor: "{colors.panneau-givre}"
    textColor: "{colors.givre-texte}"
    rounded: "0.6rem"
    padding: "0.45rem 0.5rem"
  summary-bar:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.45rem 1rem"
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
puts Open-Meteo, AROME and MET.no, and the points of the ski area from Station to Observatoire, on
the same table, each with its own colour, so you can tell at a glance whose reading you are looking
at and where it applies. The colour is playful on purpose: it is the fun of a tool made by and for
a group of young skiers, and the user wants to keep it. But the room is a professional one. The
figures are the reason it exists, so the chrome stays quiet and the data reads as trustworthy.

Dark by default: a pre-dawn sky gradient behind translucent frosted panels, with a light theme as
an alternative. Information density is welcome as long as it stays legible; the user does not
object to dense screens, only to unreadable ones. The surface is read outdoors, in the cold and in
bright sunlight, by people wearing gloves.

Depth, component sizing and the presentation of sources are explicitly **open for the coming
redesign**: this document records the incumbent system, it does not freeze it.

**Key Characteristics:**
- Colour is identity: one hue per source, one hue per point, one hue per measured quantity.
- The data is the hero; buttons, pills and toggles must never pull the eye away from it.
- Clear, warm and personal rather than neutral; young, but never at the expense of clarity.
- Translucent layers on a dark gradient, almost no shadow.
- One self-hosted face, Fira Sans; hierarchy through size and weight on a fixed scale.

## Colors

A deep pre-dawn navy carrying a deliberately multicolour set of identity hues, where every colour
names something: a source, a point, or a weather quantity.

### Primary
- **Bleu poudreuse** (`bleu-poudreuse`): the single interface accent. Active day, loaders, focus
  border of inputs, the confirm button. Keyboard focus outlines use `--focus`: this blue in dark
  mode, its darker variant `#0369a1` in light mode (≥ 3:1 on white). It is also Open-Meteo's identity hue, which is why the
  default source and the interface accent read as one.

### Secondary: source identity
- **Open-Meteo** (`source-openmeteo`), **AROME** (`source-arome`), **MET.no** (`source-metno`):
  the model cell's label and border, and a tint of the day detail (chart and hourly rows). In dark
  mode the tint is assumed (`rgba(14,110,220,.3)`, `rgba(130,50,235,.3)`, `rgba(225,115,15,.26)`;
  `--muted` is one step lighter inside it to keep 4.5:1 on the rows). In light mode it stays faint
  (10-12%): a stronger tint muddied the reading in the sun (tested 2026-11-09; a neutral background
  with a thick border in the source colour is the idea to try next). When the source changes, the
  detail changes colour.

### Tertiary: point identity
- **Station**, **Observatoire**, **Marin-Pascal**, **Vescal** (`point-*`): the fill of the active
  point pill and of the dot before the point name in the top bar, injected as `--point-color`. Custom points draw from an
  8-colour palette in `js/core.js` (`#26b763 #e67e22 #1abc9c #6c5ce7 #00b894 #fdcb6e #3498db
  #f39c12`).

### Weather quantities
- **Neige** (`neige`) and **Pluie** (`pluie`): snowflake and rain icons in summaries and cards.
- **Neige sèche** (`neige-seche`) and **Neige humide** (`neige-humide`): the snow-quality label.
- **Chart series**: temperature orange (`serie-temperature`), apparent temperature light orange
  (`serie-ressenti`), wind mint (`serie-vent`), gusts green (`serie-rafales`), UV amber
  (`serie-uv`), snow ice-white columns (`serie-neige`), rain blue columns (`pluie`). The light
  theme uses darker variants of the same hues (`js/ui.js`, `getSeriesColors`). Wind icons are mint
  (`#bce5c8`), thermometer icons muted red (`#cd7272`).
- **Alerte** (`alerte`): errors and the delete badge only.

### Neutral
- **Ciel avant l'aube** (`ciel-avant-aube` → `ciel-avant-aube-haut`): the vertical body gradient
  in dark mode; the top bar and bottom nav sit on it at 95-98% opacity with a 10px blur.
- **Givre texte** (`givre-texte`): primary text. **Ardoise muted** (`ardoise-muted`): times,
  labels, inactive navigation, secondary readings.
- **Panneau givre** (`panneau-givre`, hover `panneau-givre-hover`) and **Trait givre**
  (`trait-givre`): the translucent panel fill and the hairline border.
- Light theme: `jour-fond` → `jour-fond-haut` background, `jour-texte`, `jour-muted`, opaque white
  panels.

### Named Rules
**The Colour Means Something Rule.** Every hue identifies a source, a point or a weather
quantity. A colour that names nothing does not get added.

**The One Accent Rule.** Interface state (active, focus, confirm, loading) uses Bleu poudreuse
only; identity hues never stand in for interface state, except the active point pill, which takes
its point's colour.

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
than its label. The label explains, the figure informs.

## Layout

A single column, centred, at most 900px wide (`main`, padding 1rem; 1.5rem from 768px; 0.8rem under
600px). A fixed top bar (60px) holds the date and three square icon controls; a fixed bottom nav
holds the scrollable point pills above the day buttons on mobile (100px tall), and both on one
centred row from 768px (60px tall).

Each day is a section: header (hidden under 600px), summary bar, chart (fits the column width; a
`.chart-scroll` horizontal-scroll style exists in the CSS but is not used), then the hourly rows: one row per hour (or per 6 h period), fixed
columns aligned across rows like a table (hour, icon, temperature, snow/rain, wind, clouds), units in
a header above the list. One column on mobile; two from 768px, filled top to bottom (first half of
the day on the left). Today shows 4 hours then "Voir heures suivantes"; future days show 4 periods
(Nuit, Matin, Midi, Soir, with their local hours) with a toggle to every hour. On mobile only the selected day renders; on desktop every
day stacks.

Spacing runs on a 4 px grid, as `--space-*` tokens in `style.css` (2, 4, 6, 8, 12, 16, 20, 24, 32,
48, 64 px; 6 px is the one half-step): tight inside rows, 6 px between rows, 16 px between blocks of
a section, 32 px between sections. Only negative margins tuned against ApexCharts stay raw.

## Elevation & Depth

The incumbent system is flat and layered: depth comes from stacked translucency, not shadow. The
page gradient, then the source-tinted day section, then the frosted row (`panneau-givre`). Fixed bars use a backdrop blur (10px),
the modal overlay a 4px blur.

The only shadow is functional: a dragged point pill (`0 4px 15px rgba(0,0,0,.4)`). Rows do not react
to hover: they are not clickable.

This is recorded as current practice, **not as a rule**: the user left depth open for the redesign.

## Shapes

Soft, friendly corners on four `--radius-*` tokens: `xs` 4 px for skeleton lines, `sm` 8 px for
buttons, inputs, model cells, day buttons and hourly rows, `md` 12 px for sheet rows and notices,
`lg` 16 px for day sections, the verdict, the sheet and the modal. "Show more" buttons and chips
are full pills (`--radius-pill`); dots are circles; the thin bars (model bars, chart key) keep a
2 px radius. Borders are 1px hairlines in `trait-givre`.

## Components

### Point pills (altitude tabs)
The signature navigation: one pill per point, scrollable horizontally.
- **Shape:** full pill (2rem), 1px hairline border.
- **Default:** transparent, muted uppercase micro text.
- **Active:** filled with the point's own colour, white text.
- **Custom points:** a red delete badge appears on the active pill (hover, or after a long
  press); a dashed "+" pill adds a point. A 400ms long press enters drag mode, where pills wobble
  and the dragged one gets the only shadow in the system.

### Day buttons
- **Style:** transparent, muted 0.8rem/600 day initials (DI, LU, MA...), today shown as an icon.
- **Active:** text turns Bleu poudreuse with a 5px dot below (mobile); the dot is hidden from 768px
  where icon and label sit on one row.

### Icon buttons (refresh, theme)
- **Shape:** 36px square, 0.5rem radius, hairline border, faint slate fill; 18px muted Lucide icon.
- **Hover:** fill lightens. Refresh spins its icon while loading.

### Source toggle
The one control that carries a source's colour: a 36px square with a two-line uppercase label
("Open / Meteo") and a tiny swap icon, tinted in the current source's hue (25% fill, 50% border,
full-strength label). Each tap cycles Open-Meteo → AROME → MET.no.

### Summary bar
A rounded strip (0.75rem) of icon + figure pairs: min/max temperature, snow, rain, freezing level,
and the covered period when the day is partial. Unavailable items fade to muted at 60% opacity.

### Hourly rows
- **Corner Style:** 0.6rem; rows 0.4rem apart, at least 48px tall.
- **Background:** `panneau-givre`, no border: the background is what separates the rows.
- **Content:** hour on the left ("14 h"), or the period name above the row ("Matin · 7–13 h");
  28px MET.no weather icon; temperature (display; a period shows "min° à max°"); snow in cyan
  and rain in blue, the chart bars' colours, to the tenth, then the snow quality; wind direction
  and speed; cloud cover. Units sit in the column header, except cm / mm.
- **Small screens:** everything fits at 320px; a long period range wraps after "à", the snow
  quality drops under its figure, a figure never leaves its unit.

### Chart panel
A frosted panel (0.75rem radius, hairline border) holding the ApexCharts multi-axis chart, with
the toolbar hidden and MET.no weather icons overlaid below the time axis.

### Buttons
- **Show more:** translucent pill, 0.8rem text, 0.6rem 1.2rem padding.
- **Confirm (modal):** Bleu poudreuse fill, white 600 text, 0.5rem radius; disabled at 40%
  opacity. **Cancel:** transparent, muted text.

### Inputs / Fields
- **Style:** page-background fill, hairline border, 0.5rem radius, 0.9rem text; uppercase muted
  label above.
- **Focus:** border turns Bleu poudreuse; the outline is removed.
- **Error:** red text line below the field.

### Missing data message
A dashed purple-tinted box ("Données <source> non disponibles") replaces a day's content when the
chosen source has nothing for it; the section drops to 70% opacity.

## Do's and Don'ts

### Do:
- **Do** give every source and every point its own hue, and keep it consistent everywhere it
  appears (toggle, section tint, pill, badge).
- **Do** make the reading (temperature, snow, wind) the most prominent element of any card or
  summary.
- **Do** keep controls large enough to hit with gloves while staying visually quieter than the
  data they control.
- **Do** keep Bleu poudreuse as the only interface-state accent.
- **Do** design both themes: dark is the default, light must work in direct sunlight.

### Don't:
- **Don't** let a button, pill or toggle draw the eye away from the data.
- **Don't** add colour that identifies nothing; the multicolour palette is a key, not decoration.
- **Don't** fall back to a neutral, corporate grey dashboard: the playful multi-source colour is a
  commitment.
- **Don't** let density cost legibility: dense is fine, unreadable is not.
