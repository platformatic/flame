#!/usr/bin/env node
const { spawn } = require('child_process')
const path = require('path')

const apps = [
  {
    name: 'Express',
    script: path.join(__dirname, 'express-benchmark-app.js'),
    port: process.env.EXPRESS_PORT || 3001
  },
  {
    name: 'Fastify',
    script: path.join(__dirname, 'fastify-benchmark-app.js'),
    port: process.env.FASTIFY_PORT || 3002
  }
]

async function runApp (app) {
  return new Promise((resolve) => {
    console.log(`\n🚀 Starting ${app.name} benchmark app with CPU profiling...`)
    console.log(`📡 Server will be available at http://localhost:${app.port}`)
    console.log('📊 This will generate CPU profile data for performance analysis')
    console.log('⏱️  Let it run for at least 10-30 seconds to collect meaningful data')
    console.log('🛑 Press Ctrl+C to stop and generate flamegraph\n')

    const child = spawn('node', [app.script], {
      stdio: 'inherit',
      env: { ...process.env, PORT: app.port }
    })

    child.on('close', (code) => {
      console.log(`\n✅ ${app.name} benchmark completed with exit code ${code}`)
      if (code === 0) {
        console.log('🔥 CPU profile and flamegraph should be generated in the current directory')
      }
      resolve(code)
    })
  })
}

async function runBenchmarks () {
  const appName = process.argv[2]

  if (appName) {
    const app = apps.find(a => a.name.toLowerCase() === appName.toLowerCase())
    if (!app) {
      console.error(`❌ Unknown app: ${appName}. Available: express, fastify`)
      process.exit(1)
    }
    await runApp(app)
    process.exit(0)
  } else {
    console.log('🎯 Running both Express and Fastify benchmark apps')
    console.log('📝 Use "node run-benchmark-apps.js express" or "node run-benchmark-apps.js fastify" to run individual apps\n')

    for (const app of apps) {
      await runApp(app)
      if (app !== apps[apps.length - 1]) {
        console.log('\n⏳ Waiting 3 seconds before starting next app...')
        await new Promise(resolve => setTimeout(resolve, 3000))
      }
    }
    console.log('\n🎉 All benchmark apps completed!')
  }

  // Ensure clean shutdown
  process.exit(0)
}

runBenchmarks().catch((error) => {
  console.error('❌ Benchmark failed:', error)
  process.exit(1)
})
