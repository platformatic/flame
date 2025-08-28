#!/usr/bin/env node

/**
 * Express Benchmark Runner for Flame Profiling Overhead Testing
 *
 * This script runs performance benchmarks on the Express benchmark app
 * both with and without flame profiling to measure the overhead.
 *
 * Usage:
 *   node run-express-benchmark.js
 *
 * The script will:
 * 1. Start the Express app without profiling
 * 2. Run performance tests using autocannon
 * 3. Stop the server
 * 4. Start the Express app with flame profiling
 * 5. Run the same performance tests
 * 6. Stop the server and generate comparison report
 */

const autocannon = require('autocannon')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

// Configuration
const config = {
  port: 3002,
  host: 'localhost',
  duration: 10, // seconds
  connections: 10,
  pipelining: 1,
  endpoints: [
    { name: 'Health Check', path: '/health', expectedLoad: 'minimal' },
    { name: 'Light Computation', path: '/light', expectedLoad: 'low' },
    { name: 'Medium Computation', path: '/medium', expectedLoad: 'moderate' },
    { name: 'Heavy Computation', path: '/heavy', expectedLoad: 'high' },
    { name: 'Mixed Computation', path: '/mixed', expectedLoad: 'very-high' }
  ]
}

/**
 * Utility functions
 */
function wait (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function formatNumber (num) {
  return Number(num).toFixed(2)
}

function calculateOverhead (withoutProfiling, withProfiling) {
  if (!withoutProfiling || !withProfiling) return 'N/A'
  const overhead = ((withoutProfiling - withProfiling) / withoutProfiling) * 100
  return `${overhead > 0 ? '+' : ''}${formatNumber(overhead)}%`
}

/**
 * Start server (with or without profiling)
 */
async function startServer (withProfiling = false) {
  console.log(`\n🚀 Starting server ${withProfiling ? 'WITH' : 'WITHOUT'} flame profiling...`)

  const serverPath = path.join(__dirname, 'express-benchmark-app.js')
  const flamePath = path.join(__dirname, '..', 'bin', 'flame.js')

  let serverProcess
  if (withProfiling) {
    serverProcess = spawn('node', [flamePath, 'run', serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PORT: config.port }
    })
  } else {
    serverProcess = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PORT: config.port }
    })
  }

  let serverOutput = ''
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString()
    serverOutput += output
    // Uncomment for debugging: console.log('   Server:', output.trim())
  })

  serverProcess.stderr.on('data', (data) => {
    console.log('   Server Error:', data.toString().trim())
  })

  // Wait for server to start
  console.log('   Waiting for server to start...')
  await new Promise((resolve) => {
    const checkServer = setInterval(() => {
      if (serverOutput.includes('Express Benchmark Server running')) {
        clearInterval(checkServer)
        resolve()
      }
    }, 100)
  })

  if (withProfiling) {
    console.log('   Starting CPU profiler...')
    await wait(500) // Give profiler time to initialize
  }

  console.log(`   ✅ Server started on port ${config.port}`)
  return serverProcess
}

/**
 * Run benchmark for a specific endpoint
 */
async function runEndpointBenchmark (endpoint) {
  const url = `http://${config.host}:${config.port}${endpoint.path}`

  console.log(`\n   📊 Testing ${endpoint.name} (${endpoint.path})...`)

  try {
    const result = await autocannon({
      url,
      connections: config.connections,
      pipelining: config.pipelining,
      duration: config.duration
    })

    const stats = {
      requestsPerSec: formatNumber(result.requests.average),
      latencyAvg: formatNumber(result.latency.average),
      latencyP99: formatNumber(result.latency.p99),
      totalRequests: result.requests.total,
      throughputMB: formatNumber(result.throughput.average / 1024 / 1024),
      errors: result.non2xx || 0
    }

    console.log(`      Requests/sec: ${stats.requestsPerSec}`)
    console.log(`      Avg latency:  ${stats.latencyAvg}ms`)
    console.log(`      P99 latency:  ${stats.latencyP99}ms`)
    console.log(`      Total reqs:   ${stats.totalRequests}`)
    console.log(`      Throughput:   ${stats.throughputMB}MB/s`)
    console.log(`      Errors:       ${stats.errors}`)

    return stats
  } catch (error) {
    console.error(`      ❌ Benchmark failed: ${error.message}`)
    return null
  }
}

/**
 * Run all benchmarks for current server setup
 */
async function runAllBenchmarks () {
  console.log(`\n📈 Running benchmarks (${config.duration}s each, ${config.connections} connections)...`)

  const results = {}

  for (const endpoint of config.endpoints) {
    const stats = await runEndpointBenchmark(endpoint)
    if (stats) {
      results[endpoint.path] = {
        name: endpoint.name,
        expectedLoad: endpoint.expectedLoad,
        ...stats
      }
    }
    await wait(1000) // Brief pause between tests
  }

  return results
}

/**
 * Stop server process
 */
async function stopServer (serverProcess, withProfiling = false) {
  console.log('\n🛑 Stopping server...')

  if (withProfiling) {
    console.log('   Stopping profiler and generating flamegraph...')
    serverProcess.kill('SIGUSR2') // Stop profiling
    await wait(1000)
  }

  serverProcess.kill('SIGTERM')
  await wait(2000)

  console.log('   ✅ Server stopped')
}

/**
 * Generate comparison report
 */
function generateReport (withoutProfiling, withProfiling) {
  console.log('\n\n🔥 FLAME PROFILING OVERHEAD REPORT')
  console.log('════════════════════════════════════════════════════════════════════════')
  console.log('Test Configuration:')
  console.log(`  Duration:     ${config.duration} seconds per endpoint`)
  console.log(`  Connections:  ${config.connections}`)
  console.log(`  Pipelining:   ${config.pipelining}`)
  console.log('')

  console.log('Performance Comparison:')
  console.log('')
  console.log('┌─────────────────────────┬─────────────────┬─────────────────┬─────────────────┐')
  console.log('│ Endpoint                │ Without Profile │ With Profile    │ Overhead        │')
  console.log('├─────────────────────────┼─────────────────┼─────────────────┼─────────────────┤')

  for (const path of Object.keys(withoutProfiling)) {
    const without = withoutProfiling[path]
    const with_ = withProfiling[path]

    if (without && with_) {
      const name = without.name.padEnd(23)
      const withoutReqs = `${without.requestsPerSec} req/s`.padEnd(15)
      const withReqs = `${with_.requestsPerSec} req/s`.padEnd(15)
      const overhead = calculateOverhead(parseFloat(without.requestsPerSec), parseFloat(with_.requestsPerSec)).padEnd(15)

      console.log(`│ ${name} │ ${withoutReqs} │ ${withReqs} │ ${overhead} │`)
    }
  }

  console.log('└─────────────────────────┴─────────────────┴─────────────────┴─────────────────┘')
  console.log('')

  console.log('Latency Comparison (Average):')
  console.log('')
  console.log('┌─────────────────────────┬─────────────────┬─────────────────┬─────────────────┐')
  console.log('│ Endpoint                │ Without Profile │ With Profile    │ Overhead        │')
  console.log('├─────────────────────────┼─────────────────┼─────────────────┼─────────────────┤')

  for (const path of Object.keys(withoutProfiling)) {
    const without = withoutProfiling[path]
    const with_ = withProfiling[path]

    if (without && with_) {
      const name = without.name.padEnd(23)
      const withoutLatency = `${without.latencyAvg}ms`.padEnd(15)
      const withLatency = `${with_.latencyAvg}ms`.padEnd(15)
      const overhead = calculateOverhead(parseFloat(with_.latencyAvg), parseFloat(without.latencyAvg)).padEnd(15)

      console.log(`│ ${name} │ ${withoutLatency} │ ${withLatency} │ ${overhead} │`)
    }
  }

  console.log('└─────────────────────────┴─────────────────┴─────────────────┴─────────────────┘')
  console.log('')

  // Calculate summary statistics
  const reqSecOverheads = []
  const latencyOverheads = []

  for (const path of Object.keys(withoutProfiling)) {
    const without = withoutProfiling[path]
    const with_ = withProfiling[path]

    if (without && with_) {
      const reqOverhead = ((parseFloat(without.requestsPerSec) - parseFloat(with_.requestsPerSec)) / parseFloat(without.requestsPerSec)) * 100
      const latOverhead = ((parseFloat(with_.latencyAvg) - parseFloat(without.latencyAvg)) / parseFloat(without.latencyAvg)) * 100

      if (!isNaN(reqOverhead)) reqSecOverheads.push(reqOverhead)
      if (!isNaN(latOverhead)) latencyOverheads.push(latOverhead)
    }
  }

  if (reqSecOverheads.length > 0) {
    const avgReqOverhead = reqSecOverheads.reduce((a, b) => a + b, 0) / reqSecOverheads.length
    const avgLatOverhead = latencyOverheads.reduce((a, b) => a + b, 0) / latencyOverheads.length

    console.log('Summary:')
    console.log(`  Average throughput overhead: ${formatNumber(avgReqOverhead)}%`)
    console.log(`  Average latency overhead:    ${formatNumber(avgLatOverhead)}%`)
    console.log('')
  }

  // Look for generated profile files
  const files = fs.readdirSync(process.cwd())
  const profileFiles = files.filter(f => f.startsWith('cpu-profile-') && (f.endsWith('.pb') || f.endsWith('.html')))

  if (profileFiles.length > 0) {
    console.log('Generated Profile Files:')
    profileFiles.forEach(file => {
      console.log(`  📄 ${file}`)
    })
    console.log('')
    console.log('To view the interactive flamegraph:')
    const htmlFile = profileFiles.find(f => f.endsWith('.html'))
    if (htmlFile) {
      console.log(`  🔥 open ${htmlFile}`)
    } else {
      const pbFile = profileFiles.find(f => f.endsWith('.pb'))
      if (pbFile) {
        console.log(`  🔥 flame generate ${pbFile}`)
      }
    }
  }

  console.log('\n✅ Benchmark complete!')
}

/**
 * Main benchmark execution
 */
async function runBenchmark () {
  console.log('🔥 Express.js Flame Profiling Overhead Benchmark')
  console.log('═══════════════════════════════════════════════════════════════')

  let serverProcess
  let resultsWithoutProfiling = {}
  let resultsWithProfiling = {}

  try {
    // Phase 1: Test without profiling
    console.log('\n📊 PHASE 1: Testing WITHOUT flame profiling')
    console.log('─────────────────────────────────────────────────')

    serverProcess = await startServer(false)
    resultsWithoutProfiling = await runAllBenchmarks()
    await stopServer(serverProcess, false)

    await wait(3000) // Wait for port to be fully released

    // Phase 2: Test with profiling
    console.log('\n\n🔥 PHASE 2: Testing WITH flame profiling')
    console.log('─────────────────────────────────────────────────')

    serverProcess = await startServer(true)
    resultsWithProfiling = await runAllBenchmarks()
    await stopServer(serverProcess, true)

    // Generate comparison report
    generateReport(resultsWithoutProfiling, resultsWithProfiling)
  } catch (error) {
    console.error('\n❌ Benchmark failed:', error.message)
    if (serverProcess) {
      serverProcess.kill('SIGKILL')
    }
    process.exit(1)
  }
}

// Run benchmark if called directly
if (require.main === module) {
  runBenchmark().catch(error => {
    console.error('Benchmark error:', error)
    process.exit(1)
  })
}

module.exports = { runBenchmark, config }
