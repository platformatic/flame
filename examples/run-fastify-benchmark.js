#!/usr/bin/env node

/**
 * Fastify Benchmark Runner
 *
 * A script to demonstrate benchmarking the flame profiler overhead
 * using the Fastify benchmark application.
 *
 * Usage:
 *   node examples/run-fastify-benchmark.js
 *   PORT=3005 node examples/run-fastify-benchmark.js
 */

import { createBenchmarkApp } from './fastify-benchmark-app.js'

async function main () {
  const config = {
    port: parseInt(process.env.PORT) || 3004,
    host: process.env.HOST || 'localhost',
    logger: {
      level: process.env.LOG_LEVEL || 'warn' // Reduce noise for benchmarking
    }
  }

  console.log('🔥 Starting Fastify Benchmark Application...\n')

  const app = await createBenchmarkApp(config)

  try {
    await app.listen({ port: config.port, host: config.host })

    console.log(`✅ Server running at http://${config.host}:${config.port}`)
    console.log('\n📊 Benchmark Endpoints:')
    console.log(`   GET http://${config.host}:${config.port}/health  - Health check`)
    console.log(`   GET http://${config.host}:${config.port}/light   - ~1ms computation`)
    console.log(`   GET http://${config.host}:${config.port}/medium  - ~10-50ms computation`)
    console.log(`   GET http://${config.host}:${config.port}/heavy   - ~100-500ms computation`)

    console.log('\n🧪 Benchmarking Steps:')
    console.log('1. Run without profiling: autocannon http://localhost:' + config.port + '/light')
    console.log('2. Run with flame profiling: flame run examples/run-fastify-benchmark.js')
    console.log('3. Compare response times and throughput')

    console.log('\n💡 Example commands:')
    console.log('   npm install -g autocannon')
    console.log(`   autocannon -c 10 -d 30 http://${config.host}:${config.port}/light`)
    console.log(`   autocannon -c 10 -d 30 http://${config.host}:${config.port}/medium`)
    console.log(`   autocannon -c 10 -d 30 http://${config.host}:${config.port}/heavy`)

    console.log('\n🔬 To profile this application:')
    console.log('   ./bin/flame.js run examples/run-fastify-benchmark.js')
    console.log('   # In another terminal:')
    console.log(`   autocannon -c 10 -d 30 http://${config.host}:${config.port}/medium`)
    console.log('   # Send SIGUSR2 twice to generate flamegraph')
    console.log('   kill -USR2 <PID> && sleep 1 && kill -USR2 <PID>')

    console.log('\n⏹️  Press Ctrl+C to stop the server\n')
  } catch (err) {
    console.error('❌ Failed to start server:', err.message)
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down gracefully...')
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n👋 Shutting down gracefully...')
  process.exit(0)
})

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason)
  process.exit(1)
})

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
