'use strict'

// Smoketest for the webapp: public/index.html is vanilla JS with no build
// step, so we can only assert it parses and that the helpers the UI relies
// on are still defined. Extract the main inline script and compile it with
// vm.Script (parse only — never executed, so Leaflet/DOM absence is fine).

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const htmlPath = path.join(__dirname, '..', 'public', 'index.html')

// All inline <script> blocks (no src= attribute), longest first.
function inlineScripts() {
  const html = fs.readFileSync(htmlPath, 'utf-8')
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1])
    .sort((a, b) => b.length - a.length)
  return blocks
}

test('inline script parses as JavaScript', () => {
  const blocks = inlineScripts()
  assert.ok(blocks.length > 0, 'at least one inline <script> block found')
  new vm.Script(blocks[0])  // throws SyntaxError on parse failure
})

// Helpers wired into UI lifecycle — renaming any of these without updating
// the listeners should fail here rather than in the browser.
const HELPERS = [
  'lsGet', 'lsSet', 'lsRemove', 'lsFlush', 'lsEvictForSpace',  // localStorage cache
  'getCached', 'setCached', 'purgeLs',
  'computeGrid', 'autoStep', 'fetchGrid', 'fetchPoint', 'fetchBatch',
  'renderHeatmap', 'renderMarker', 'doRefresh', 'prewarmForecastFrames', 'ingestTimeline',
  'loadDisplayUnits', 'formatSpeed', 'formatTemperature', 'formatPressure', 'formatPrecipitation',
  'toggleForecastPlayback', 'stopForecastPlayback',
]

test('cache and render helpers are defined', () => {
  const src = inlineScripts()[0]
  for (const fn of HELPERS) {
    assert.match(src, new RegExp(`function ${fn}\\s*\\(`), `function ${fn}() defined`)
  }
})

test('uses Signal K unit preferences and provider-driven forecast playback', () => {
  const src = inlineScripts()[0]
  const html = fs.readFileSync(htmlPath, 'utf-8')
  assert.match(src, /\/signalk\/v1\/unitpreferences\/active/, 'reads the active server preset')
  assert.match(src, /\/signalk\/v1\/applicationData\/user\/unitpreferences\/1\.0\.0/, 'prefers the user preset')
  assert.match(html, /id="btn-time-play"/, 'offers forecast playback')
  assert.match(src, /curTimeIdx >= allTimes\.length - 1/, 'playback stops at the provider data boundary')
})

test('bounds Leaflet and canvas work for a viewport refresh', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const CONC\s*=\s*6/, 'limits point-forecast concurrency')
  assert.match(src, /const MAX_INTERACTIVE_CELLS\s*=\s*180/, 'caps Leaflet hit targets and markers')
  assert.match(src, /quality === 'preview' \? 90_000 : 360_000/, 'uses bounded preview and full heatmap resolutions')
  assert.match(src, /const HeatCanvasOverlay = L\.Layer\.extend/, 'keeps the raster in a direct canvas layer')
  assert.doesNotMatch(src, /heatCanvas\.toDataURL\(\)/, 'avoids PNG encode/decode on every update')
  assert.doesNotMatch(src, /Nearest-neighbour fallback/, 'avoids per-pixel full-grid nearest-neighbor scans')
  assert.match(src, /function enhanceHeatmapInBackground\(/, 'refines color after an immediate preview')
})

test('records separate viewport load stages for zoom-level diagnosis', () => {
  const src = inlineScripts()[0]
  assert.match(src, /window\.__weatherMapPerformance/, 'exposes a short local timing history')
  assert.match(src, /perf\.gridFetchMs/, 'records server and transfer wait separately')
  assert.match(src, /perf\.gridCommitMs/, 'records cache and Leaflet marker work')
  assert.match(src, /perf\.finalHeatmapMs/, 'records bounded canvas work')
})

test('memoizes selected forecast rows and derived heatmap values', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const heatValueMemo = new Map\(\)/, 'keeps derived grid values by render state')
  assert.match(src, /const forecastSelectionCache = new WeakMap\(\)/, 'reuses rows without persisting derived fields')
  assert.match(src, /function prewarmForecastFrames\(/, 'prepares future frames only in idle time')
  assert.match(src, /requestIdleCallback/, 'does not compete with the first paint')
  assert.match(src, /weatherDataGeneration\+\+/, 'invalidates derived values when forecast data changes')
  assert.match(src, /const CACHE_TTL = 60 \* 60 \* 1000/, 'retains forecast responses for an hour')
})

test('uses the server-cached grid endpoint before point fallback', () => {
  const src = inlineScripts()[0]
  assert.match(src, /\/plugins\/signalk-weather-map\/grid/, 'requests one server grid')
  assert.match(src, /await fetchGrid\(bounds, step, source, abortCtrl\.signal, curTime\(\) \?\? new Date\(\)\.toISOString\(\)\)/, 'loads compact grid before fallback')
  assert.match(src, /ingestTimeline\(grid\.times\)/, 'uses the backend GRIB horizon for the timeline')
  assert.match(src, /hydrateGridInBackground/, 'hydrates the full forecast after first paint')
  assert.match(src, /weather-map-frame-v1/, 'decodes the compact server frame format')
})

test('prefers a local GRIB provider and preserves partial grid results', () => {
  const src = inlineScripts()[0]
  const server = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf-8')
  assert.match(src, /preferredGribId/, 'chooses GRIB over a remote default when available')
  assert.match(server, /stats\.pointFailures\+\+/, 'counts individual provider failures')
  assert.match(server, /Preserve successful cells/, 'does not fail the entire grid')
})

test('deferred localStorage writes are flushed at end of lifecycle', () => {
  const src = inlineScripts()[0]
  // After a completed fetch batch…
  assert.match(src, /lsFlush\(\)\s*\n\s*if \(gen !== refreshGen\)/,
    'lsFlush() called after fetchBatch completes')
  // …and when leaving the page.
  assert.match(src, /addEventListener\('pagehide', lsFlush\)/,
    'pagehide listener flushes pending writes')
})
