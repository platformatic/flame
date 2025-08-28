#!/usr/bin/env node

const autocannon = require('autocannon')
const { spawn } = require('child_process')
const path = require('path')

async function runLoadTest () {
  console.log('🔥 Starting flame load test example...\n')

  const serverPath = path.join(__dirname, 'load-test-server.js')
  const flamePath = path.join(__dirname, '..', 'bin', 'flame.js')

  console.log('1. Starting server with flame profiling...')
  const serverProcess = spawn('node', [flamePath, 'run', serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  })

  let serverOutput = ''
  serverProcess.stdout.on('data', (data) => {
    const output = data.toString()
    serverOutput += output
    console.log('   Server:', output.trim())
  })

  serverProcess.stderr.on('data', (data) => {
    console.log('   Server Error:', data.toString().trim())
  })

  // Wait for server to start
  await new Promise((resolve) => {
    const checkServer = setInterval(() => {
      if (serverOutput.includes('Server running')) {
        clearInterval(checkServer)
        resolve()
      }
    }, 100)
  })

  console.log('\n2. Starting profiling...')
  await new Promise(resolve => setTimeout(resolve, 500))

  console.log('\n3. Running load test...')
  try {
    const result = await autocannon({
      url: 'http://localhost:3000',
      connections: 10,
      pipelining: 1,
      duration: 10, // 10 seconds
      requests: [
        {
          method: 'GET',
          path: '/'
        },
        {
          method: 'GET',
          path: '/heavy'
        }
      ]
    })

    console.log('\n📊 Load test results:')
    console.log(`   Requests/sec: ${result.requests.average}`)
    console.log(`   Latency avg: ${result.latency.average}ms`)
    console.log(`   Latency p99: ${result.latency.p99}ms`)
    console.log(`   Total requests: ${result.requests.total}`)
  } catch (error) {
    console.error('Load test failed:', error.message)
  }

  console.log('\n4. Stopping profiling...')
  serverProcess.kill('SIGUSR2')
  await new Promise(resolve => setTimeout(resolve, 1000))

  console.log('\n5. Shutting down server...')
  serverProcess.kill('SIGTERM')

  // Look for generated profile files
  const fs = require('fs')
  const files = fs.readdirSync(process.cwd())
  const profileFiles = files.filter(f => f.startsWith('cpu-profile-') && f.endsWith('.pb'))

  if (profileFiles.length > 0) {
    const latestProfile = profileFiles.sort().pop()
    console.log(`\n🎯 Profile generated: ${latestProfile}`)
    console.log('\nTo generate a flamegraph, run:')
    console.log(`   flame generate ${latestProfile}`)
  } else {
    console.log('\n⚠️  No profile files found. Make sure @datadog/pprof is installed.')
  }

  console.log('\n✅ Load test complete!')
  process.exit(0)
}

if (require.main === module) {
  runLoadTest().catch(console.error)
}

module.exports = { runLoadTest }
