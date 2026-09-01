'use strict'

const http = require('node:http')
const { gzip } = require('node:zlib')
const { promisify } = require('node:util')

const GRID_TTL_MS = 60 * 60 * 1000
const MAX_GRID_POINTS = 600
const MAX_GRID_ENTRIES = 16
const MAX_POINT_ENTRIES = 1_200
const POINT_CONCURRENCY = 6
const gzipAsync = promisify(gzip)

function finite(value, min, max) {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined
}

function gridPoints({ west, south, east, north, step }) {
  const points = []
  for (let lat = Math.floor(south / step) * step; lat <= north + 1e-9; lat += step) {
    for (let lon = Math.floor(west / step) * step; lon <= east + 1e-9; lon += step) {
      points.push([Number(lat.toFixed(4)), Number((((lon + 540) % 360) - 180).toFixed(4))])
      if (points.length > MAX_GRID_POINTS) return undefined
    }
  }
  return points
}

// The point API returns a complete forecast series for each cell.  Include the
// union separately so a client can establish its timeline before it has walked
// and cached every individual cell.
function forecastTimes(points) {
  const times = new Set()
  for (const point of points) {
    for (const forecast of point.data || []) {
      if (typeof forecast?.date === 'string' && Number.isFinite(Date.parse(forecast.date))) times.add(forecast.date)
    }
  }
  return Array.from(times).sort()
}

function forecastAt(data, at) {
  if (!Array.isArray(data) || data.length === 0) return undefined
  const target = Date.parse(at)
  let best = data[0]
  let bestDiff = Infinity
  for (const forecast of data) {
    const diff = Math.abs(Date.parse(forecast.date) - target)
    if (diff < bestDiff) { best = forecast; bestDiff = diff }
  }
  return best
}

// First paint only needs the selected forecast instant, while the timeline
// still needs to know the complete horizon. Keep full series in the server
// cache and project a compact one-row response when the client asks for `at`.
function gridAtTime(grid, at) {
  if (!at) return grid
  return {
    ...grid,
    partial: true,
    format: 'weather-map-frame-v1',
    points: grid.points.map(point => {
      const forecast = forecastAt(point.data, at)
      // Dense positional rows avoid repeating JSON property names and omit
      // provider-only fields (waves, descriptions, visibility, etc.) that the
      // map never draws. The browser expands this only when needed for a tip.
      return forecast ? [
        point.lat, point.lon, forecast.date,
        forecast.wind?.speedTrue ?? null, forecast.wind?.directionTrue ?? null, forecast.wind?.gust ?? null,
        forecast.outside?.temperature ?? null, forecast.outside?.cloudCover ?? null,
        forecast.outside?.precipitationVolume ?? null, forecast.outside?.pressure ?? null,
        forecast.outside?.relativeHumidity ?? null,
      ] : [point.lat, point.lon]
    }),
  }
}

async function sendGridJson(request, response, grid) {
  const json = JSON.stringify(grid)
  response.set('Server-Timing', `grid;dur=${grid.timings.totalMs}`)
  response.set('Vary', 'Accept-Encoding')
  if (/\bgzip\b/.test(request.headers['accept-encoding'] || '')) {
    response.set('Content-Encoding', 'gzip').type('json').send(await gzipAsync(json))
  } else {
    response.type('json').send(json)
  }
}

function jsonFromSignalK(path) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port: 3000, path, timeout: 15_000 }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) return reject(new Error(`weather API returned HTTP ${response.statusCode}`))
        try { resolve(JSON.parse(body)) } catch { reject(new Error('weather API returned invalid JSON')) }
      })
    })
    request.on('timeout', () => request.destroy(new Error('weather API timed out')))
    request.on('error', reject)
  })
}

function createGridCache() {
  const points = new Map()
  const grids = new Map()
  const evict = cache => { while (cache.size > MAX_GRID_ENTRIES) cache.delete(cache.keys().next().value) }

  async function point(lat, lon, provider, stats) {
    const key = `${provider || ''}|${lat.toFixed(4)},${lon.toFixed(4)}`
    const now = Date.now()
    const cached = points.get(key)
    if (cached && now - cached.createdAt < GRID_TTL_MS) {
      stats.pointCacheHits++
      return cached.value
    }
    stats.pointCacheMisses++
    const params = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) })
    if (provider) params.set('provider', provider)
    const value = jsonFromSignalK(`/signalk/v2/api/weather/forecasts/point?${params}`)
    points.set(key, { createdAt: now, value })
    while (points.size > MAX_POINT_ENTRIES) points.delete(points.keys().next().value)
    try {
      const resolved = await value
      points.set(key, { createdAt: now, value: resolved })
      return resolved
    } catch (error) {
      points.delete(key)
      throw error
    }
  }

  async function grid(bounds, provider) {
    const key = `${provider || ''}|${bounds.west},${bounds.south},${bounds.east},${bounds.north},${bounds.step}`
    const now = Date.now()
    const cached = grids.get(key)
    if (cached && now - cached.createdAt < GRID_TTL_MS) {
      const value = await cached.value
      return { ...value, cache: 'grid', timings: { totalMs: Date.now() - now, pointCacheHits: 0, pointCacheMisses: 0, pointFailures: 0 } }
    }
    const cells = gridPoints(bounds)
    if (!cells) throw new RangeError(`requested grid exceeds ${MAX_GRID_POINTS} cells`)
    let next = 0
    const result = []
    const stats = { pointCacheHits: 0, pointCacheMisses: 0, pointFailures: 0 }
    async function worker() {
      while (next < cells.length) {
        const [lat, lon] = cells[next++]
        try {
          const data = await point(lat, lon, provider, stats)
          if (Array.isArray(data) && data.length > 0) result.push({ lat, lon, data })
        } catch {
          // Preserve successful cells. One intermittent provider failure must
          // not make the browser retry the complete viewport point-by-point.
          stats.pointFailures++
        }
      }
    }
    const value = Promise.all(Array.from({ length: Math.min(POINT_CONCURRENCY, cells.length) }, worker))
      .then(() => ({
        points: result,
        times: forecastTimes(result),
        cachedAt: now,
        timings: { totalMs: Date.now() - now, ...stats },
      }))
    grids.set(key, { createdAt: now, value })
    evict(grids)
    try {
      const resolved = await value
      grids.set(key, { createdAt: now, value: resolved })
      return { ...resolved, cache: 'miss' }
    } catch (error) {
      grids.delete(key)
      throw error
    }
  }

  return { grid }
}

module.exports = function () {
  const cache = createGridCache()
  return {
    id: 'signalk-weather-map',
    name: 'Weather Map',
    description: 'Weather map webapp with server-cached forecast grids',
    start: function () {},
    stop: function () {},
    schema: null,
    registerWithRouter(router) {
      router.access('readonly').get('/grid', async (request, response) => {
        const query = request.query || {}
        const west = finite(query.west, -360, 360)
        const east = finite(query.east, -360, 360)
        const south = finite(query.south, -90, 90)
        const north = finite(query.north, -90, 90)
        const step = finite(query.step, 0.01, 10)
        const provider = typeof query.provider === 'string' && query.provider.length <= 200 ? query.provider : ''
        const at = typeof query.at === 'string' && Number.isFinite(Date.parse(query.at)) ? query.at : undefined
        if (west === undefined || east === undefined || south === undefined || north === undefined || step === undefined || east < west || north < south) {
          response.status(400).json({ error: 'west, south, east, north, and step must describe a valid grid' })
          return
        }
        try {
          const grid = gridAtTime(await cache.grid({ west, south, east, north, step }, provider), at)
          await sendGridJson(request, response, grid)
        } catch (error) {
          response.status(error instanceof RangeError ? 413 : 502).json({ error: error.message })
        }
      })
    },
  }
}

module.exports._private = { createGridCache, forecastAt, forecastTimes, gridAtTime, gridPoints }
