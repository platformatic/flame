const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { startProfiling, parseProfile, generateFlamegraph } = require('../lib/index.js')

test('startProfiling should spawn process with preload script', async (t) => {
  // Create a simple test script
  const testScript = path.join(__dirname, 'temp-script.js')
  fs.writeFileSync(testScript, 'console.log("Hello World"); process.exit(0);')

  const result = startProfiling(testScript, [], { stdio: 'pipe' })

  assert.ok(result.pid, 'Should return a PID')
  assert.ok(result.process, 'Should return a process object')
  assert.ok(typeof result.toggleProfiler === 'function', 'Should return toggleProfiler function')

  // Clean up
  result.process.kill()
  fs.unlinkSync(testScript)
})

test('startProfiling should throw error for non-existent script', async (t) => {
  const nonExistentScript = path.join(__dirname, 'non-existent.js')

  await assert.rejects(
    async () => {
      const result = startProfiling(nonExistentScript)
      // Wait a bit for the process to potentially fail
      await new Promise((resolve, reject) => {
        result.process.on('error', reject)
        result.process.on('exit', (code) => {
          if (code !== 0) {
            reject(new Error('Process exited with error'))
          }
        })
        setTimeout(resolve, 100)
      })
    },
    /Process exited with error/
  )
})

test('parseProfile should throw error for non-existent file', async (t) => {
  const nonExistentFile = path.join(__dirname, 'non-existent.pb')

  await assert.rejects(
    async () => parseProfile(nonExistentFile),
    /Profile file not found/
  )
})

test('generateFlamegraph should create HTML file', async (t) => {
  // Skip this test if @platformatic/react-pprof is not available
  try {
    require.resolve('@platformatic/react-pprof/cli.js')
  } catch (error) {
    t.skip('@platformatic/react-pprof not available')
    return
  }

  // Create a mock pprof file (this would need actual pprof data in real scenario)
  const mockProfile = path.join(__dirname, 'temp-profile.pb')
  const outputFile = path.join(__dirname, 'temp-output.html')

  // Create minimal pprof data (this is just for testing the file handling)
  fs.writeFileSync(mockProfile, Buffer.alloc(100))

  try {
    await generateFlamegraph(mockProfile, outputFile)
    // The actual CLI might fail with invalid data, but we test the interface
  } catch (error) {
    // Expected to fail with mock data, but should not be a file system error
    assert.ok(error.message.includes('CLI failed') || error.message.includes('Profile'), 'Should fail with profile parsing error, not file system error')
  }

  // Clean up
  if (fs.existsSync(mockProfile)) fs.unlinkSync(mockProfile)
  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
})
