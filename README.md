# signalk-weather-map

A [SignalK](https://signalk.org) webapp that displays forecast data on an interactive map, including wind barbs, surface-current vectors, temperature, cloudiness, precipitation, pressure, and gusts, powered by any compatible Signal K weather provider.

<details>
<summary><strong>How this fork differs from upstream</strong></summary>

This repository is a fork of Jean-Laurent Girod's
[signalk-weather-map](https://github.com/macjl/signalk-weather-map). Thank you to Jean-Laurent and
the upstream contributors for the original lightweight weather map and Signal K integration.

I am happy to upstream changes that prove useful beyond this fork. I have been iterating here first
to learn which ideas hold up and what shape makes sense before proposing them upstream.

This inventory compares the fork with
[`upstream/main` at `3e296bb`](https://github.com/macjl/signalk-weather-map/commit/3e296bbfd08276dcf18928a8494ee4b3e5b7c96f).
The fork changes began after
[`c8e9c15`](https://github.com/macjl/signalk-weather-map/commit/c8e9c152fee91dc875e00e18b444191b5fce0704),
and upstream has continued to advance independently.

## Major features and changes

| Difference | Commits |
| --- | --- |
| Surface-current forecasts add speed coloring, set-direction arrows, timeline playback, legend values, and tooltip readouts | `f97d03c` |
| Forecasts follow Signal K unit preferences and can play across every returned forecast step | `51228d2` |
| GRIB-backed providers are preferred when available, while partial grids remain usable during progressive loading | `295dc59` |

## UI improvements

| Difference | Commits |
| --- | --- |
| Forecast playback interpolates between model steps instead of jumping from frame to frame | `82d796c` |
| The forecast timeline is directly seekable across the full returned horizon | `05253b2` |
| Progressive color refinement shows a useful map quickly and sharpens it as background data arrives | `265ebeb` |

## Performance optimizations

| Difference | Commits |
| --- | --- |
| Rendering work is bounded, future frames are deferred, and forecast-step and heatmap derivations are memoized | `8514513`, `9dbbc73`, `d76f5e7` |
| Forecast grids are served from a server cache, and browser requests are batched instead of fanning out into hundreds of point requests | `7a7d34b`, `8514513` |
| Heatmap rendering is profiled and streamlined with structured server and browser timing diagnostics | `6bef86e`, `3121698` |
| Current forecasts stream before background hydration, and map frames use compact payloads with progressive refinement | `862cb46`, `265ebeb` |

</details>

![Weather Map screenshot](screenshots/weather-map.png)

## Features

- **Wind barbs** — standard meteorological notation (½ bar = 5 kt, bar = 10 kt, pennant = 50 kt)
- **Gusts** — same barb display based on gust speed
- **Surface currents:** color-coded speed with arrows pointing toward the modeled current set
- **Temperature** — colour-coded cells with numeric label (blue → green → yellow → red)
- **Cloudiness** — transparency-based grey overlay (0 % = transparent, 100 % = dark grey)
- **Precipitation** — colour-coded intensity (transparent → light blue → blue → purple → red)
- **Pressure** — colour-coded cells with numeric hPa label (dark blue = storm/low < 960 → cyan → green ≈ 1013 → orange → dark red = anticyclone > 1022)
- **Bounded rendering** — adaptive grid density, capped Leaflet markers, and a bounded-resolution canvas keep pan and zoom responsive
- **Forecast timeline:** request up to 240 forecast steps, typically seven to ten days, and browse or play through every step the provider returns
- **Multi-provider support** — select any registered SignalK weather provider; set a default with one click
- **Collapsible panel** — panel and legend collapse to a one-line summary (model + layer) for mobile use; state persisted across sessions
- **Vessel position** — boat marker oriented to true heading (falls back to north if unavailable)
- **Client-side cache** — one-hour localStorage + memory cache with memoized forecast-step and heatmap-value derivation; bounded batch fetching (6 concurrent)
- **Signal K units** — reads the per-user Unit Preferences preset, then the active server preset, for wind, temperature, pressure, and precipitation displays
- **i18n** — UI language detected from the browser (French and English supported)

## Requirements

- Signal K server with at least one weather provider plugin installed and enabled
  (for example, [signalk-grib-weather-provider](https://github.com/macjl/signalk-grib-weather-provider) or an Open-Meteo provider). Current rendering appears only when the selected provider exposes a standard current field.
- Node.js ≥ 12

## Installation

### From npm (recommended)

In the SignalK server's app store, search for **signalk-weather-map** and install it.

Or from the command line inside the SignalK data directory:

```sh
npm install signalk-weather-map
```

Then restart the SignalK server.

### Manual / development

```sh
cd ~/.signalk/   # or your SignalK data directory
mkdir -p local-plugins
git clone https://github.com/macjl/signalk-weather-map local-plugins/signalk-weather-map
# Add to package.json dependencies:
#   "signalk-weather-map": "file:./local-plugins/signalk-weather-map"
npm install
```

## Usage

Once installed, the webapp is available at:

```
http://<signalk-host>:<port>/signalk-weather-map/
```

Or open it from the SignalK dashboard → **Webapps**.

### Layer selector

| Layer | Description |
|---|---|
| Wind | Barbs based on true wind speed |
| Gusts | Barbs based on gust speed |
| Currents | Color-coded surface-current speed with arrows pointing toward the set |
| Temperature | Colour-coded cell fill with °C label |
| Cloudiness | Grey transparency proportional to cloud cover |
| Precipitation | Colour intensity proportional to rain volume |
| Pressure | Colour-coded cell fill with hPa label (blue = low, red = high) |

### Tooltip

Hover over any cell to see full data: wind speed and direction, current speed and set, gusts, temperature, MSLP, humidity, cloud cover, and precipitation.

### Provider selector

If multiple weather providers are registered, select one from the **Source** dropdown. Click **Set as default** to make it the server-wide default.

## Weather API

This plugin uses the standard SignalK v2 Weather API:

```
GET /signalk/v2/api/weather/forecasts/point?lat=&lon=&provider=<pluginId>&maxCount=240
GET /signalk/v2/api/weather/_providers
POST /signalk/v2/api/weather/_providers/_default/:id
GET /plugins/signalk-weather-map/grid?west=&south=&east=&north=&step=&provider=
```

Any provider that implements this API is compatible.

### GRIB and performance

This webapp deliberately does not download or parse GRIB files in the browser. A GRIB-backed
weather provider should download, decode, and cache its model data on the Signal K server, then
answer the Weather API from that prepared cache. Weather Map's `/grid` route turns the provider's
point API into one server-cached grid response for the browser, so panning no longer fans out into
hundreds of browser requests. The map retains a short client cache for redraws and panning.

## Development

```sh
git clone https://github.com/macjl/signalk-weather-map
cd signalk-weather-map
# Edit public/index.html — no build step required (vanilla JS + Leaflet CDN)
```

## License

MIT © Jean-Laurent Girod
