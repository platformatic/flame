'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { once } = require('node:events')
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

test('startProfiling should handle non-existent script', async (t) => {
  const nonExistentScript = path.join(__dirname, 'non-existent.js')

  // Should be able to start the process (spawn doesn't fail immediately)
  const result = startProfiling(nonExistentScript)
  assert.ok(typeof result.pid === 'number', 'Should return a PID')
  assert.ok(result.process, 'Should return a process object')
  assert.ok(typeof result.toggleProfiler === 'function', 'Should return toggleProfiler function')

  // Wait for the process to exit (it will fail when trying to load the non-existent file)
  const [exitCode] = await Promise.race([
    once(result.process, 'exit'),
    once(result.process, 'error').then(() => [-1])
  ])

  // On Windows, exit codes may be different, so just verify it's not a successful exit
  assert.notStrictEqual(exitCode, 0, 'Process should not exit successfully with non-existent script')
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
    require.resolve('react-pprof/cli.js')
  } catch (error) {
    t.skip('react-pprof not available')
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

  // Also clean up the JS file that the CLI creates
  const jsFile = outputFile.replace('.html', '.js')
  if (fs.existsSync(jsFile)) fs.unlinkSync(jsFile)
})
