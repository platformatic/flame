import { test, describe } from 'node:test'
import assert from 'node:assert'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const benchmarkAppPath = path.join(__dirname, '..', 'examples', 'fastify-benchmark-app.js')

describe('Fastify Benchmark Application', () => {
  test('should export a function to create the Fastify app', async () => {
    const { createBenchmarkApp } = await import(benchmarkAppPath)
    assert.strictEqual(typeof createBenchmarkApp, 'function')
  })

  test('should create app with default configuration', async () => {
    const { createBenchmarkApp } = await import(benchmarkAppPath)
    const app = await createBenchmarkApp()

    assert(app)
    assert.strictEqual(typeof app.inject, 'function')
    assert.strictEqual(typeof app.listen, 'function')

    await app.close()
  })

  test('should create app with custom configuration', async () => {
    const { createBenchmarkApp } = await import(benchmarkAppPath)
    const config = {
      port: 4000,
      host: '127.0.0.1',
      logger: { level: 'debug' }
    }

    const app = await createBenchmarkApp(config)
    assert(app)
    await app.close()
  })

  describe('Health Endpoint', () => {
    test('should respond to GET /health with success', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.status, 'healthy')
      assert(typeof payload.timestamp === 'string')
      assert(typeof payload.uptime === 'number')

      await app.close()
    })
  })

  describe('Light Endpoint', () => {
    test('should respond to GET /light with computational work result', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const startTime = Date.now()
      const response = await app.inject({
        method: 'GET',
        url: '/light'
      })
      const endTime = Date.now()

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.endpoint, 'light')
      assert.strictEqual(payload.iterations, 1000)
      assert(typeof payload.result === 'number')
      assert(typeof payload.computeTime === 'number')
      assert(typeof payload.timestamp === 'string')
      assert(payload.computeTime >= 0)
      assert(endTime - startTime >= payload.computeTime)

      await app.close()
    })

    test('should perform consistent computational work', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const response1 = await app.inject({ method: 'GET', url: '/light' })
      const response2 = await app.inject({ method: 'GET', url: '/light' })

      const payload1 = JSON.parse(response1.payload)
      const payload2 = JSON.parse(response2.payload)

      // Results should be the same (deterministic computation)
      assert.strictEqual(payload1.result, payload2.result)
      assert.strictEqual(payload1.iterations, payload2.iterations)

      await app.close()
    })
  })

  describe('Medium Endpoint', () => {
    test('should respond to GET /medium with computational work result', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const response = await app.inject({
        method: 'GET',
        url: '/medium'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.endpoint, 'medium')
      assert.strictEqual(payload.iterations, 50000)
      assert(typeof payload.result === 'number')
      assert(typeof payload.computeTime === 'number')
      assert(payload.computeTime >= 0)

      await app.close()
    })

    test('should take longer than light endpoint', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const lightResponse = await app.inject({ method: 'GET', url: '/light' })
      const mediumResponse = await app.inject({ method: 'GET', url: '/medium' })

      const lightPayload = JSON.parse(lightResponse.payload)
      const mediumPayload = JSON.parse(mediumResponse.payload)

      // Medium should generally take longer than light
      assert(mediumPayload.computeTime >= lightPayload.computeTime)

      await app.close()
    })
  })

  describe('Heavy Endpoint', () => {
    test('should respond to GET /heavy with computational work result', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const response = await app.inject({
        method: 'GET',
        url: '/heavy'
      })

      assert.strictEqual(response.statusCode, 200)

      const payload = JSON.parse(response.payload)
      assert.strictEqual(payload.endpoint, 'heavy')
      assert.strictEqual(payload.iterations, 500000)
      assert(typeof payload.result === 'number')
      assert(typeof payload.computeTime === 'number')
      assert(payload.computeTime >= 0)

      await app.close()
    })

    test('should take longer than medium endpoint', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const mediumResponse = await app.inject({ method: 'GET', url: '/medium' })
      const heavyResponse = await app.inject({ method: 'GET', url: '/heavy' })

      const mediumPayload = JSON.parse(mediumResponse.payload)
      const heavyPayload = JSON.parse(heavyResponse.payload)

      // Heavy should generally take longer than medium
      assert(heavyPayload.computeTime >= mediumPayload.computeTime)

      await app.close()
    })
  })

  describe('Plugin Integration', () => {
    test('should have CORS headers for cross-origin requests', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'https://example.com'
        }
      })

      assert(response.headers['access-control-allow-origin'])

      await app.close()
    })

    test('should have security headers from helmet', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const response = await app.inject({
        method: 'GET',
        url: '/health'
      })

      // Helmet should add security headers
      assert(response.headers['x-frame-options'] || response.headers['x-content-type-options'])

      await app.close()
    })

    test('should support compression', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const response = await app.inject({
        method: 'GET',
        url: '/heavy',
        headers: {
          'accept-encoding': 'gzip'
        }
      })

      // Should accept compression header without error
      assert.strictEqual(response.statusCode, 200)

      await app.close()
    })
  })

  describe('Error Handling', () => {
    test('should return 404 for non-existent routes', async () => {
      const { createBenchmarkApp } = await import(benchmarkAppPath)
      const app = await createBenchmarkApp()

      const response = await app.inject({
        method: 'GET',
        url: '/non-existent'
      })

      assert.strictEqual(response.statusCode, 404)

      await app.close()
    })
  })
})
