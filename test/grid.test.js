'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const plugin = require('../index.js')
const { forecastAt, forecastTimes, gridAtTime, gridPoints } = plugin._private

test('creates a bounded, antimeridian-safe server grid', () => {
  assert.deepStrictEqual(
    gridPoints({ west: 179, south: 0, east: 181, north: 1, step: 1 }),
    [[0, 179], [0, -180], [0, -179], [1, 179], [1, -180], [1, -179]],
  )
})

test('refuses an oversized server grid', () => {
  assert.strictEqual(gridPoints({ west: -180, south: -90, east: 180, north: 90, step: 0.01 }), undefined)
})

test('reports the complete sorted forecast horizon for a grid', () => {
  assert.deepStrictEqual(forecastTimes([
    { data: [{ date: '2026-09-03T00:00:00.000Z' }, { date: '2026-09-01T00:00:00.000Z' }] },
    { data: [{ date: '2026-09-02T00:00:00.000Z' }, { date: 'not-a-date' }] },
  ]), [
    '2026-09-01T00:00:00.000Z',
    '2026-09-02T00:00:00.000Z',
    '2026-09-03T00:00:00.000Z',
  ])
})

test('projects a compact selected-time grid without losing its timeline', () => {
  const grid = {
    times: ['2026-09-01T00:00:00.000Z', '2026-09-01T03:00:00.000Z'],
    points: [{ lat: 1, lon: 2, data: [{ date: '2026-09-01T00:00:00.000Z' }, { date: '2026-09-01T03:00:00.000Z' }] }],
  }
  assert.equal(forecastAt(grid.points[0].data, '2026-09-01T02:00:00.000Z').date, '2026-09-01T03:00:00.000Z')
  assert.deepStrictEqual(gridAtTime(grid, '2026-09-01T03:00:00.000Z'), {
    ...grid,
    partial: true,
    format: 'weather-map-frame-v1',
    points: [[1, 2, '2026-09-01T03:00:00.000Z', null, null, null, null, null, null, null, null]],
  })
})
