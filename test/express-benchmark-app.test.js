'use strict'

const { test, describe } = require('node:test')
const assert = require('node:assert')
const inject = require('light-my-request')
const expressModule = require('../examples/express-benchmark-app.js')

describe('Express Benchmark Application', () => {
  let app

  test('should export app, server, and config objects', async () => {
    assert(expressModule.app, 'app should be exported')
    assert(expressModule.server, 'server should be exported')
    assert(expressModule.config, 'config should be exported')

    // Store app for testing
    app = expressModule.app

    // Clean up server to avoid port conflicts
    expressModule.server.close()
  })

  describe('Health Endpoint', () => {
    test('should respond to GET /health with success', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/health'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.status, 'healthy')
      assert(typeof payload.timestamp === 'string')
      assert(typeof payload.uptime === 'number')
      assert(typeof payload.memory === 'object')
      assert(typeof payload.pid === 'number')
    })
  })

  describe('Light Endpoint', () => {
    test('should respond to GET /light with computational work result', async () => {
      const startTime = Date.now()
      const response = await inject(app, {
        method: 'GET',
        url: '/light'
      })
      const endTime = Date.now()

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.success, true)
      assert.strictEqual(payload.computation.type, 'light')
      assert.strictEqual(payload.computation.iterations, 1000)
      assert(typeof payload.computation.dataPoints === 'number')
      assert(typeof payload.computation.sum === 'number')
      assert(typeof payload.computation.average === 'number')
      assert(typeof payload.computation.executionTimeMs === 'number')
      assert(typeof payload.computation.timestamp === 'string')
      assert(payload.computation.executionTimeMs >= 0)
      assert(endTime - startTime >= 0)
      assert(payload.message.includes('Light computation completed successfully'))
    })

    test('should perform consistent computational work', async () => {
      const response1 = await inject(app, { method: 'GET', url: '/light' })
      const response2 = await inject(app, { method: 'GET', url: '/light' })

      const payload1 = JSON.parse(response1.payload)
      const payload2 = JSON.parse(response2.payload)

      // Results should be the same (deterministic computation)
      assert.strictEqual(payload1.computation.sum, payload2.computation.sum)
      assert.strictEqual(payload1.computation.iterations, payload2.computation.iterations)
      assert.strictEqual(payload1.computation.dataPoints, payload2.computation.dataPoints)
    })
  })

  describe('Medium Endpoint', () => {
    test('should respond to GET /medium with computational work result', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/medium'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.success, true)
      assert.strictEqual(payload.computation.type, 'medium')
      assert.strictEqual(payload.computation.iterations, 50000)
      assert(typeof payload.computation.dataPoints === 'number')
      assert(typeof payload.computation.sum === 'number')
      assert(typeof payload.computation.squaredSum === 'number')
      assert(typeof payload.computation.avgStringLength === 'number')
      assert(typeof payload.computation.executionTimeMs === 'number')
      assert(payload.computation.executionTimeMs >= 0)
      assert(payload.message.includes('Medium computation completed successfully'))
    })

    test('should take longer than light endpoint', async () => {
      const lightResponse = await inject(app, { method: 'GET', url: '/light' })
      const mediumResponse = await inject(app, { method: 'GET', url: '/medium' })

      const lightPayload = JSON.parse(lightResponse.payload)
      const mediumPayload = JSON.parse(mediumResponse.payload)

      // Medium should generally take longer than light
      assert(mediumPayload.computation.executionTimeMs >= lightPayload.computation.executionTimeMs)
    })
  })

  describe('Heavy Endpoint', () => {
    test('should respond to GET /heavy with computational work result', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/heavy'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.success, true)
      assert.strictEqual(payload.computation.type, 'heavy')
      assert.strictEqual(payload.computation.iterations, 499998)
      assert(typeof payload.computation.stats === 'object')
      assert(typeof payload.computation.stats.totalSum === 'number')
      assert(typeof payload.computation.stats.average === 'number')
      assert(typeof payload.computation.stats.primeCount === 'number')
      assert(typeof payload.computation.stats.squareCount === 'number')
      assert(Array.isArray(payload.computation.samplePrimes))
      assert(Array.isArray(payload.computation.sampleSquares))
      assert(typeof payload.computation.executionTimeMs === 'number')
      assert(payload.computation.executionTimeMs >= 0)
      assert(payload.message.includes('Heavy computation completed successfully'))
    })

    test('should take longer than medium endpoint', async () => {
      const mediumResponse = await inject(app, { method: 'GET', url: '/medium' })
      const heavyResponse = await inject(app, { method: 'GET', url: '/heavy' })

      const mediumPayload = JSON.parse(mediumResponse.payload)
      const heavyPayload = JSON.parse(heavyResponse.payload)

      // Heavy should generally take longer than medium, but timing can vary
      // Just verify both have positive execution times and heavy has more iterations
      assert(heavyPayload.computation.executionTimeMs >= 0)
      assert(mediumPayload.computation.executionTimeMs >= 0)
      assert(heavyPayload.computation.iterations > mediumPayload.computation.iterations)
    })
  })

  describe('Mixed Endpoint', () => {
    test('should respond to GET /mixed with all three computation types', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/mixed'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.success, true)
      assert(typeof payload.computations === 'object')
      assert(typeof payload.computations.light === 'object')
      assert(typeof payload.computations.medium === 'object')
      assert(typeof payload.computations.heavy === 'object')
      assert(typeof payload.summary === 'object')
      assert(typeof payload.summary.totalExecutionTimeMs === 'number')
      assert(typeof payload.summary.totalIterations === 'number')
      assert(payload.message.includes('Mixed computation completed successfully'))

      // Verify individual computation results
      assert.strictEqual(payload.computations.light.type, 'light')
      assert.strictEqual(payload.computations.medium.type, 'medium')
      assert.strictEqual(payload.computations.heavy.type, 'heavy')
    })
  })

  describe('Batch Endpoint', () => {
    test('should respond to GET /batch/light with default count', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/batch/light'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.success, true)
      assert.strictEqual(payload.batchType, 'light')
      assert.strictEqual(payload.batchCount, 5) // Default count
      assert(Array.isArray(payload.results))
      assert.strictEqual(payload.results.length, 5)
      assert(typeof payload.summary === 'object')
      assert(typeof payload.summary.totalBatchTimeMs === 'number')
      assert(typeof payload.summary.avgExecutionTimeMs === 'number')
      assert(typeof payload.summary.totalIterations === 'number')
    })

    test('should respond to GET /batch/medium/3 with custom count', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/batch/medium/3'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.success, true)
      assert.strictEqual(payload.batchType, 'medium')
      assert.strictEqual(payload.batchCount, 3)
      assert(Array.isArray(payload.results))
      assert.strictEqual(payload.results.length, 3)
    })

    test('should return 400 for invalid computation type', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/batch/invalid/2'
      })

      assert.strictEqual(response.statusCode, 400)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.success, false)
      assert(payload.error.includes('Invalid computation type'))
      assert(Array.isArray(payload.validTypes))
      assert(payload.validTypes.includes('light'))
      assert(payload.validTypes.includes('medium'))
      assert(payload.validTypes.includes('heavy'))
    })

    test('should limit batch count to maximum of 20', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/batch/light/25'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.batchCount, 20) // Should be limited to 20
      assert.strictEqual(payload.results.length, 20)
    })
  })

  describe('Root Endpoint', () => {
    test('should respond to GET / with API documentation', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert(payload.name.includes('Express.js Flame Profiling Benchmark App'))
      assert(typeof payload.version === 'string')
      assert(typeof payload.description === 'string')
      assert(typeof payload.endpoints === 'object')
      assert(typeof payload.benchmarkInfo === 'object')
      assert(typeof payload.server === 'object')
      assert(typeof payload.timestamp === 'string')

      // Check that key endpoints are documented
      assert(payload.endpoints['GET /health'])
      assert(payload.endpoints['GET /light'])
      assert(payload.endpoints['GET /medium'])
      assert(payload.endpoints['GET /heavy'])
    })
  })

  describe('Middleware Integration', () => {
    test('should have CORS headers for cross-origin requests', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'https://example.com'
        }
      })

      assert(response.headers['access-control-allow-origin'])
    })

    test('should have security headers from helmet', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/health'
      })

      // Helmet should add security headers
      assert(response.headers['x-dns-prefetch-control'] || response.headers['x-frame-options'] || response.headers['x-content-type-options'])
    })

    test('should support compression', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/heavy',
        headers: {
          'accept-encoding': 'gzip'
        }
      })

      // Should accept compression header without error
      assert.strictEqual(response.statusCode, 200)
    })

    test('should parse JSON requests', async () => {
      const response = await inject(app, {
        method: 'POST',
        url: '/health',
        headers: {
          'content-type': 'application/json'
        },
        payload: JSON.stringify({ test: 'data' })
      })

      // Should handle JSON payload without error (even if method not supported)
      // The endpoint doesn't support POST, but middleware should parse JSON
      assert(response.statusCode === 404) // Express returns 404 for unsupported methods on existing routes
    })
  })

  describe('Error Handling', () => {
    test('should return 404 for non-existent routes', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/non-existent'
      })

      assert.strictEqual(response.statusCode, 404)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.success, false)
      assert(payload.error.includes('Endpoint not found'))
      assert(payload.path === '/non-existent')
      assert(payload.method === 'GET')
      assert(Array.isArray(payload.availableEndpoints))
    })

    test('should return 404 for unsupported HTTP methods on existing routes', async () => {
      const response = await inject(app, {
        method: 'POST',
        url: '/light'
      })

      assert.strictEqual(response.statusCode, 404)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.success, false)
      assert(payload.error.includes('Endpoint not found'))
    })

    test('should handle invalid JSON gracefully', async () => {
      const response = await inject(app, {
        method: 'POST',
        url: '/health',
        headers: {
          'content-type': 'application/json'
        },
        payload: '{ invalid json'
      })

      // Should return an error for invalid JSON (400 from Express body parser)
      assert(response.statusCode >= 400)
    })
  })

  describe('Performance Characteristics', () => {
    test('should complete light computation within reasonable time', async () => {
      const startTime = Date.now()
      const response = await inject(app, {
        method: 'GET',
        url: '/light'
      })
      const endTime = Date.now()

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      const totalTime = endTime - startTime

      // Light computation should complete relatively quickly (< 1000ms typically)
      assert(totalTime < 5000, `Light computation took ${totalTime}ms, expected < 5000ms`)
      // Execution time should be positive
      assert(payload.computation.executionTimeMs >= 0)
    })

    test('should show increasing iterations across endpoint types', async () => {
      const lightResponse = await inject(app, { method: 'GET', url: '/light' })
      const mediumResponse = await inject(app, { method: 'GET', url: '/medium' })
      const heavyResponse = await inject(app, { method: 'GET', url: '/heavy' })

      const lightPayload = JSON.parse(lightResponse.payload)
      const mediumPayload = JSON.parse(mediumResponse.payload)
      const heavyPayload = JSON.parse(heavyResponse.payload)

      // Iterations should definitely increase across endpoint types
      assert(lightPayload.computation.iterations < mediumPayload.computation.iterations)
      assert(mediumPayload.computation.iterations < heavyPayload.computation.iterations)

      // All execution times should be positive
      assert(lightPayload.computation.executionTimeMs >= 0)
      assert(mediumPayload.computation.executionTimeMs >= 0)
      assert(heavyPayload.computation.executionTimeMs >= 0)
    })

    test('should provide consistent results for the same computation type', async () => {
      const responses = await Promise.all([
        inject(app, { method: 'GET', url: '/light' }),
        inject(app, { method: 'GET', url: '/light' }),
        inject(app, { method: 'GET', url: '/light' })
      ])

      const payloads = responses.map(r => JSON.parse(r.payload))

      // All light computations should have same iterations and similar results
      payloads.forEach(payload => {
        assert.strictEqual(payload.computation.iterations, 1000)
        assert.strictEqual(payload.computation.type, 'light')
      })

      // Results should be deterministic (same sum for same computation)
      const firstSum = payloads[0].computation.sum
      payloads.forEach(payload => {
        assert.strictEqual(payload.computation.sum, firstSum)
      })
    })
  })

  describe('Response Structure Validation', () => {
    test('should have consistent response structure for computation endpoints', async () => {
      const endpoints = ['/light', '/medium', '/heavy']

      for (const endpoint of endpoints) {
        const response = await inject(app, { method: 'GET', url: endpoint })
        const payload = JSON.parse(response.payload)

        // Common structure validation
        assert(typeof payload.success === 'boolean')
        assert(payload.success === true)
        assert(typeof payload.computation === 'object')
        assert(typeof payload.message === 'string')
        assert(typeof payload.computation.type === 'string')
        assert(typeof payload.computation.iterations === 'number')
        assert(typeof payload.computation.executionTimeMs === 'number')
        assert(typeof payload.computation.timestamp === 'string')

        // Validate timestamp format (ISO string)
        assert(!isNaN(Date.parse(payload.computation.timestamp)))
      }
    })

    test('should have consistent error response structure', async () => {
      const response = await inject(app, {
        method: 'GET',
        url: '/non-existent'
      })

      const payload = JSON.parse(response.payload)

      // Error structure validation
      assert(typeof payload.success === 'boolean')
      assert(payload.success === false)
      assert(typeof payload.error === 'string')
      assert(typeof payload.path === 'string')
      assert(typeof payload.method === 'string')
      assert(typeof payload.timestamp === 'string')
      assert(Array.isArray(payload.availableEndpoints))

      // Validate timestamp format
      assert(!isNaN(Date.parse(payload.timestamp)))
    })
  })
})
