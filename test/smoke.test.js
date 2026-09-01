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
  'renderHeatmap', 'renderMarker', 'doRefresh',
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
  assert.match(src, /const MAX_HEAT_PIXELS\s*=\s*160_000/, 'caps heatmap canvas pixels')
  assert.doesNotMatch(src, /Nearest-neighbour fallback/, 'avoids per-pixel full-grid nearest-neighbor scans')
})

test('memoizes selected forecast rows and derived heatmap values', () => {
  const src = inlineScripts()[0]
  assert.match(src, /const heatValueMemo = new Map\(\)/, 'keeps derived grid values by render state')
  assert.match(src, /data\._weatherMapSelectedTime === t/, 'reuses the selected forecast row')
  assert.match(src, /weatherDataGeneration\+\+/, 'invalidates derived values when forecast data changes')
  assert.match(src, /const CACHE_TTL = 60 \* 60 \* 1000/, 'retains forecast responses for an hour')
})

test('uses the server-cached grid endpoint before point fallback', () => {
  const src = inlineScripts()[0]
  assert.match(src, /\/plugins\/signalk-weather-map\/grid/, 'requests one server grid')
  assert.match(src, /await fetchGrid\(bounds, step, source, abortCtrl\.signal\)/, 'loads grid before fallback')
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
