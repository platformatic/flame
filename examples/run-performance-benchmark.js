#!/usr/bin/env node

/**
 * Performance Benchmark Runner for Flame Profiling Overhead Testing
 *
 * This script runs comprehensive performance benchmarks on the Express benchmark app
 * both with and without flame profiling to measure overhead using autocannon.
 *
 * Usage:
 *   node run-performance-benchmark.js
 *
 * The script will:
 * 1. Start the Express app without profiling
 * 2. Run performance tests using autocannon on all endpoints
 * 3. Stop the server and collect baseline metrics
 * 4. Start the Express app with flame profiling enabled
 * 5. Run the same performance tests with profiling active
 * 6. Stop the server and generate detailed comparison report
 */

const autocannon = require('autocannon')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

// Configuration
const apps = [
  {
    name: 'Express',
    script: path.join(__dirname, 'express-benchmark-app.js'),
    port: 3001
  },
  {
    name: 'Fastify',
    script: path.join(__dirname, 'fastify-benchmark-app.js'),
    port: 3002
  }
]

const config = {
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
async function startServer (app, withProfiling = false) {
  console.log(`\n🚀 Starting ${app.name} server ${withProfiling ? 'WITH' : 'WITHOUT'} flame profiling...`)

  const flamePath = path.join(__dirname, '..', 'bin', 'flame.js')

  let serverProcess
  if (withProfiling) {
    serverProcess = spawn('node', [flamePath, 'run', app.script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PORT: app.port }
    })
  } else {
    serverProcess = spawn('node', [app.script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PORT: app.port }
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
      const serverStartedExpress = serverOutput.includes('Express Benchmark Server running')
      const serverStartedFastify = serverOutput.includes('Server running at')
      if (serverStartedExpress || serverStartedFastify) {
        clearInterval(checkServer)
        resolve()
      }
    }, 100)
  })

  if (withProfiling) {
    console.log('   Starting CPU profiler...')
    await wait(500) // Give profiler time to initialize
  }

  console.log(`   ✅ ${app.name} server started on port ${app.port}`)
  return serverProcess
}

/**
 * Run benchmark for a specific endpoint
 */
async function runEndpointBenchmark (app, endpoint) {
  const url = `http://${config.host}:${app.port}${endpoint.path}`

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
async function runAllBenchmarks (app) {
  console.log(`\n📈 Running ${app.name} benchmarks (${config.duration}s each, ${config.connections} connections)...`)

  const results = {}

  for (const endpoint of config.endpoints) {
    const stats = await runEndpointBenchmark(app, endpoint)
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

  serverProcess.kill('SIGINT')
  await wait(2000)

  console.log('   ✅ Server stopped')
}

/**
 * Generate CSV data for further processing
 */
function generateCsvData (appName, withoutProfiling, withProfiling) {
  const csvRows = []

  // CSV Header
  csvRows.push('Framework,Endpoint,Load Level,Without Profiling (req/s),With Profiling (req/s),Throughput Overhead (%),Without Profiling Latency (ms),With Profiling Latency (ms),Latency Overhead (%)')

  for (const path of Object.keys(withoutProfiling)) {
    const without = withoutProfiling[path]
    const with_ = withProfiling[path]

    if (without && with_) {
      const throughputOverhead = ((parseFloat(without.requestsPerSec) - parseFloat(with_.requestsPerSec)) / parseFloat(without.requestsPerSec)) * 100
      const latencyOverhead = ((parseFloat(with_.latencyAvg) - parseFloat(without.latencyAvg)) / parseFloat(without.latencyAvg)) * 100

      csvRows.push([
        appName,
        without.name,
        without.expectedLoad,
        without.requestsPerSec,
        with_.requestsPerSec,
        formatNumber(throughputOverhead),
        without.latencyAvg,
        with_.latencyAvg,
        formatNumber(latencyOverhead)
      ].join(','))
    }
  }

  return csvRows.join('\n')
}

/**
 * Generate comparison report
 */
function generateReport (appName, withoutProfiling, withProfiling) {
  console.log(`\n\n🔥 ${appName.toUpperCase()} FLAME PROFILING OVERHEAD REPORT`)
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

  // Generate and save CSV data
  const csvData = generateCsvData(appName, withoutProfiling, withProfiling)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const csvFilename = `flame-benchmark-${appName.toLowerCase()}-${timestamp}.csv`

  fs.writeFileSync(csvFilename, csvData)
  console.log(`\n📊 CSV data saved to: ${csvFilename}`)
  console.log('\n✅ Benchmark complete!')
}

/**
 * Run benchmark for a specific app
 */
async function runAppBenchmark (app, returnResults = false) {
  console.log(`\n🚀 Benchmarking ${app.name}`)
  console.log('═'.repeat(50))

  let serverProcess
  let resultsWithoutProfiling = {}
  let resultsWithProfiling = {}

  try {
    // Phase 1: Test without profiling
    console.log(`\n📊 PHASE 1: Testing ${app.name} WITHOUT flame profiling`)
    console.log('─────────────────────────────────────────────────')

    serverProcess = await startServer(app, false)
    resultsWithoutProfiling = await runAllBenchmarks(app)
    await stopServer(serverProcess, false)

    await wait(3000) // Wait for port to be fully released

    // Phase 2: Test with profiling
    console.log(`\n\n🔥 PHASE 2: Testing ${app.name} WITH flame profiling`)
    console.log('─────────────────────────────────────────────────')

    serverProcess = await startServer(app, true)
    resultsWithProfiling = await runAllBenchmarks(app)
    await stopServer(serverProcess, true)

    // Generate comparison report
    generateReport(app.name, resultsWithoutProfiling, resultsWithProfiling)

    if (returnResults) {
      return {
        appName: app.name,
        withoutProfiling: resultsWithoutProfiling,
        withProfiling: resultsWithProfiling
      }
    }
  } catch (error) {
    console.error(`\n❌ ${app.name} benchmark failed:`, error.message)
    if (serverProcess) {
      serverProcess.kill('SIGKILL')
    }
    throw error
  }
}

/**
 * Main benchmark execution
 */
async function runBenchmark () {
  console.log('🔥 Comprehensive Flame Profiling Overhead Benchmark')
  console.log('═══════════════════════════════════════════════════════════════')

  const appName = process.argv[2]

  if (appName) {
    const app = apps.find(a => a.name.toLowerCase() === appName.toLowerCase())
    if (!app) {
      console.error(`❌ Unknown app: ${appName}. Available: express, fastify`)
      process.exit(1)
    }
    await runAppBenchmark(app)
  } else {
    console.log('🎯 Running benchmarks for both Express and Fastify')
    console.log('📝 Use "node run-performance-benchmark.js express" or "node run-performance-benchmark.js fastify" to run individual benchmarks\n')

    const allResults = []
    for (const app of apps) {
      const results = await runAppBenchmark(app, true)
      if (results) allResults.push(results)

      if (app !== apps[apps.length - 1]) {
        console.log('\n⏳ Waiting 5 seconds before starting next benchmark...')
        await wait(5000)
      }
    }

    // Generate combined CSV file
    if (allResults.length > 0) {
      const combinedCsvRows = []
      combinedCsvRows.push('Framework,Endpoint,Load Level,Without Profiling (req/s),With Profiling (req/s),Throughput Overhead (%),Without Profiling Latency (ms),With Profiling Latency (ms),Latency Overhead (%)')

      for (const result of allResults) {
        const csvData = generateCsvData(result.appName, result.withoutProfiling, result.withProfiling)
        const dataRows = csvData.split('\n').slice(1) // Skip header
        combinedCsvRows.push(...dataRows)
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      const combinedCsvFilename = `flame-benchmark-combined-${timestamp}.csv`
      fs.writeFileSync(combinedCsvFilename, combinedCsvRows.join('\n'))
      console.log(`\n📊 Combined CSV data saved to: ${combinedCsvFilename}`)
    }

    console.log('\n🎉 All benchmarks completed!')
  }
}

// Run benchmark if called directly
if (require.main === module) {
  runBenchmark().then(() => {
    process.exit(0)
  }).catch(error => {
    console.error('Benchmark error:', error)
    process.exit(1)
  })
}

module.exports = { runBenchmark, config }
