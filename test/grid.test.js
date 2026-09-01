'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const plugin = require('../index.js')
const { gridPoints } = plugin._private

test('creates a bounded, antimeridian-safe server grid', () => {
  assert.deepStrictEqual(
    gridPoints({ west: 179, south: 0, east: 181, north: 1, step: 1 }),
    [[0, 179], [0, -180], [0, -179], [1, 179], [1, -180], [1, -179]],
  )
})

test('refuses an oversized server grid', () => {
  assert.strictEqual(gridPoints({ west: -180, south: -90, east: 180, north: 90, step: 0.01 }), undefined)
})
