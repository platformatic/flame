/**
 * Fastify Benchmark Application
 *
 * A comprehensive Fastify application designed for benchmarking the overhead
 * of CPU profiling solutions like flame. This application provides multiple
 * endpoints with varying computational loads to measure profiling impact
 * on response times and throughput.
 *
 * Features:
 * - Multiple endpoints with different CPU loads (light, medium, heavy)
 * - Realistic computational workloads using simple for loops
 * - Comprehensive plugin integration (CORS, Helmet, Compression, Rate Limiting)
 * - Detailed timing and metadata in responses
 * - Configurable server settings
 * - Health check endpoint for monitoring
 *
 * Usage:
 *   const { createBenchmarkApp } = require('./fastify-benchmark-app.js');
 *   const app = await createBenchmarkApp({ port: 3000 });
 *   await app.listen({ port: 3000, host: '0.0.0.0' });
 */

import fastify from 'fastify'

/**
 * Performs a simple computational task with a specified number of iterations.
 * This simulates realistic CPU work for benchmarking purposes.
 *
 * @param {number} iterations - Number of loop iterations to perform
 * @returns {object} - Object containing the computation result and timing
 */
function performComputation (iterations) {
  const startTime = process.hrtime.bigint()

  let result = 0
  let temp = 1

  // Simple mathematical operations that provide consistent CPU load
  for (let i = 0; i < iterations; i++) {
    temp = (temp * 1.1) % 1000000
    result += Math.floor(temp)

    // Add some additional operations for more realistic workload
    if (i % 100 === 0) {
      result = result % 1000000
    }
  }

  const endTime = process.hrtime.bigint()
  const computeTimeNs = endTime - startTime
  const computeTimeMs = Number(computeTimeNs) / 1000000

  return {
    result: Math.floor(result),
    computeTime: Math.round(computeTimeMs * 100) / 100 // Round to 2 decimal places
  }
}

/**
 * Creates and configures a Fastify application with benchmark endpoints
 *
 * @param {object} config - Configuration options
 * @param {number} config.port - Server port (default: 3000)
 * @param {string} config.host - Server host (default: '0.0.0.0')
 * @param {object} config.logger - Logger configuration
 * @returns {Promise<FastifyInstance>} - Configured Fastify application
 */
export async function createBenchmarkApp (config = {}) {
  const {
    logger = { level: 'info' }
  } = config

  // Create Fastify instance with configuration
  const app = fastify({
    logger,
    // Disable request logging for cleaner benchmark output
    disableRequestLogging: process.env.NODE_ENV === 'production'
  })

  // Register plugins for realistic application setup

  // CORS support for cross-origin requests
  await app.register(import('@fastify/cors'), {
    origin: true,
    credentials: true,
    // Ensure headers are always present for testing
    preflightContinue: false,
    optionsSuccessStatus: 200
  })

  // Security headers
  await app.register(import('@fastify/helmet'), {
    // Configure helmet for benchmark-friendly settings
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })

  // Response compression
  await app.register(import('@fastify/compress'), {
    global: true,
    encodings: ['gzip', 'deflate']
  })

  // Rate limiting to simulate production constraints
  await app.register(import('@fastify/rate-limit'), {
    max: 1000,
    timeWindow: '1 minute',
    // More lenient for benchmarking
    skipOnError: true
  })

  // Store server start time for uptime calculation
  const serverStartTime = Date.now()

  // Health check endpoint
  app.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
            memory: { type: 'object' },
            version: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const memoryUsage = process.memoryUsage()

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Date.now() - serverStartTime,
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024)
      },
      version: process.version
    }
  })

  // Light computational load endpoint (~1ms)
  app.get('/light', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            endpoint: { type: 'string' },
            iterations: { type: 'number' },
            result: { type: 'number' },
            computeTime: { type: 'number' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const iterations = 1000
    const computation = performComputation(iterations)

    return {
      endpoint: 'light',
      iterations,
      result: computation.result,
      computeTime: computation.computeTime,
      timestamp: new Date().toISOString(),
      requestId: request.id
    }
  })

  // Medium computational load endpoint (~10-50ms)
  app.get('/medium', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            endpoint: { type: 'string' },
            iterations: { type: 'number' },
            result: { type: 'number' },
            computeTime: { type: 'number' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const iterations = 50000
    const computation = performComputation(iterations)

    return {
      endpoint: 'medium',
      iterations,
      result: computation.result,
      computeTime: computation.computeTime,
      timestamp: new Date().toISOString(),
      requestId: request.id
    }
  })

  // Heavy computational load endpoint (~100-500ms)
  app.get('/heavy', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            endpoint: { type: 'string' },
            iterations: { type: 'number' },
            result: { type: 'number' },
            computeTime: { type: 'number' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const iterations = 500000
    const computation = performComputation(iterations)

    return {
      endpoint: 'heavy',
      iterations,
      result: computation.result,
      computeTime: computation.computeTime,
      timestamp: new Date().toISOString(),
      requestId: request.id
    }
  })

  // Error handling
  app.setErrorHandler(async (error, request, reply) => {
    request.log.error(error)

    const statusCode = error.statusCode || 500

    return reply.status(statusCode).send({
      error: true,
      message: error.message,
      statusCode,
      timestamp: new Date().toISOString()
    })
  })

  // 404 handler
  app.setNotFoundHandler(async (request, reply) => {
    return reply.status(404).send({
      error: true,
      message: 'Route not found',
      statusCode: 404,
      path: request.url,
      timestamp: new Date().toISOString()
    })
  })

  return app
}

/**
 * Main function to start the server when run directly
 */
async function main () {
  try {
    const config = {
      port: parseInt(process.env.PORT) || 3000,
      host: process.env.HOST || '0.0.0.0',
      logger: {
        level: process.env.LOG_LEVEL || 'info'
      }
    }

    const app = await createBenchmarkApp(config)

    // Graceful shutdown handling
    const gracefulShutdown = async (signal) => {
      app.log.info(`Received ${signal}, shutting down gracefully`)
      try {
        await app.close()
        process.exit(0)
      } catch (err) {
        app.log.error('Error during shutdown:', err)
        process.exit(1)
      }
    }

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
    process.on('SIGINT', () => gracefulShutdown('SIGINT'))

    // Start server
    await app.listen({
      port: config.port,
      host: config.host
    })

    console.log(`
🔥 Fastify Benchmark Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Server: http://${config.host}:${config.port}

Endpoints:
  GET /health - Health check and server stats
  GET /light  - Light computational load (~1ms)
  GET /medium - Medium computational load (~10-50ms)  
  GET /heavy  - Heavy computational load (~100-500ms)

Usage for profiling comparison:
  1. Baseline: Run without profiling
  2. Profiled: Run with flame profiler
  3. Compare response times and throughput

Configuration:
  PORT=${config.port}
  HOST=${config.host}
  LOG_LEVEL=${config.logger.level}
`)
  } catch (err) {
    console.error('Failed to start server:', err)
    process.exit(1)
  }
}

// Run server if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
