'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const preloadPath = path.join(__dirname, '..', 'preload.js')

test('preload script should start without errors', async (t) => {
  const testScript = path.join(__dirname, 'temp-preload-test.js')
  fs.writeFileSync(testScript, `
    console.log('Script started');
    setTimeout(() => {
      console.log('Script finished');
      process.exit(0);
    }, 100);
  `)

  const child = spawn('node', ['-r', preloadPath, testScript], {
    stdio: 'pipe'
  })

  const result = await new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })

  // Clean up
  fs.unlinkSync(testScript)

  assert.strictEqual(result.code, 0, 'Should exit successfully')
  assert.ok(result.stdout.includes('Flame preload script loaded'), 'Should show preload message')
  assert.ok(result.stdout.includes('Process PID:'), 'Should show PID')
  assert.ok(result.stdout.includes('Script started'), 'Should run the target script')
  assert.ok(result.stdout.includes('Script finished'), 'Should complete the target script')
})

test('preload script should respond to SIGUSR2', { skip: process.platform === 'win32' ? 'SIGUSR2 not supported on Windows' : false }, async (t) => {
  const testScript = path.join(__dirname, 'temp-signal-test.js')
  fs.writeFileSync(testScript, `
    console.log('Script started');
    
    // Keep the process alive for a bit
    const timer = setTimeout(() => {
      process.exit(0);
    }, 2000);
    
    // Exit early if we get the expected profiler messages
    process.stdout.on('data', (data) => {
      if (data.includes('Starting CPU profiler')) {
        clearTimeout(timer);
        setTimeout(() => process.exit(0), 200);
      }
    });
  `)

  const child = spawn('node', ['-r', preloadPath, testScript], {
    stdio: 'pipe'
  })

  // Send SIGUSR2 after a short delay
  setTimeout(() => {
    child.kill('SIGUSR2')
  }, 500)

  const result = await new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })

    // Force kill after timeout
    setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ code: -1, stdout, stderr })
    }, 3000)
  })

  // Clean up
  fs.unlinkSync(testScript)

  assert.ok(result.stdout.includes('Starting CPU profiler'), 'Should start profiler on SIGUSR2')
})

test('preload script should create profile file on double SIGUSR2', { skip: process.platform === 'win32' ? 'SIGUSR2 not supported on Windows' : false }, async (t) => {
  const testScript = path.join(__dirname, 'temp-profile-test.js')
  fs.writeFileSync(testScript, `
    console.log('Script started');
    
    let profileCount = 0;
    const originalLog = console.log;
    console.log = (...args) => {
      originalLog(...args);
      if (args[0] && args[0].includes('CPU profile written')) {
        profileCount++;
        if (profileCount >= 1) {
          setTimeout(() => process.exit(0), 100);
        }
      }
    };
    
    setTimeout(() => process.exit(0), 3000);
  `)

  const child = spawn('node', ['-r', preloadPath, testScript], {
    stdio: 'pipe',
    cwd: __dirname // Run in test directory so profile files are created here
  })

  // Send two SIGUSR2 signals to start and stop profiling
  setTimeout(() => child.kill('SIGUSR2'), 500) // Start
  setTimeout(() => child.kill('SIGUSR2'), 1000) // Stop

  const result = await new Promise((resolve) => {
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })

  // Clean up script
  fs.unlinkSync(testScript)

  // Clean up any generated profile files
  const files = fs.readdirSync(__dirname)
  files.forEach(file => {
    if (file.startsWith('cpu-profile-') && file.endsWith('.pb')) {
      fs.unlinkSync(path.join(__dirname, file))
    }
  })

  assert.ok(result.stdout.includes('Starting CPU profiler'), 'Should start profiler')
  assert.ok(result.stdout.includes('Stopping CPU profiler'), 'Should stop profiler')
  assert.ok(result.stdout.includes('CPU profile written'), 'Should write profile file')
})
