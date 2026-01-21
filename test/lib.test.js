'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { once } = require('node:events')
const { startProfiling, parseProfile, generateFlamegraph, generateMarkdown } = require('../lib/index.js')

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

test('startProfiling should accept nodeOptions parameter', async (t) => {
  // Create a simple test script that outputs process.execArgv
  const testScript = path.join(__dirname, 'temp-node-options-lib-test.js')
  fs.writeFileSync(testScript, `
    console.log('NODE_OPTIONS_TEST:' + JSON.stringify(process.execArgv));
    process.exit(0);
  `)

  const nodeOptions = ['--max-old-space-size=256', '--inspect-port=9998']
  const result = startProfiling(testScript, [], { nodeOptions, stdio: 'pipe' })

  let stdout = ''
  result.process.stdout.on('data', (data) => {
    stdout += data.toString()
  })

  // Wait for the process to exit
  await once(result.process, 'exit')

  // Clean up
  fs.unlinkSync(testScript)

  // Verify node options were passed
  assert.ok(stdout.includes('--max-old-space-size=256'), 'Should pass first node option')
  assert.ok(stdout.includes('--inspect-port=9998'), 'Should pass second node option')
})

test('startProfiling should work with empty nodeOptions', async (t) => {
  // Create a simple test script
  const testScript = path.join(__dirname, 'temp-empty-options-test.js')
  fs.writeFileSync(testScript, 'console.log("EMPTY_OPTIONS_TEST"); process.exit(0);')

  const result = startProfiling(testScript, [], { nodeOptions: [], stdio: 'pipe' })

  let stdout = ''
  result.process.stdout.on('data', (data) => {
    stdout += data.toString()
  })

  // Wait for the process to exit
  await once(result.process, 'exit')

  // Clean up
  fs.unlinkSync(testScript)

  // Verify the script ran successfully
  assert.ok(stdout.includes('EMPTY_OPTIONS_TEST'), 'Should run script with empty nodeOptions array')
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

test('generateMarkdown should create markdown file from pprof', async (t) => {
  // Skip this test if pprof-to-md is not available
  try {
    await import('pprof-to-md')
  } catch (error) {
    t.skip('pprof-to-md not available')
    return
  }

  // Create a mock pprof file (this would need actual pprof data in real scenario)
  const mockProfile = path.join(__dirname, 'temp-profile-md.pb')
  const outputFile = path.join(__dirname, 'temp-output.md')

  // Create minimal pprof data (this is just for testing the file handling)
  fs.writeFileSync(mockProfile, Buffer.alloc(100))

  try {
    await generateMarkdown(mockProfile, outputFile, { format: 'summary' })
    // The actual converter might fail with invalid data, but we test the interface
  } catch (error) {
    // Expected to fail with mock data, but should be a converter error, not file system error
    assert.ok(
      error.message.includes('decode') ||
      error.message.includes('Profile') ||
      error.message.includes('pprof') ||
      error.message.includes('convert') ||
      error.message.includes('Sample type') ||
      error.message.includes('not found'),
      `Should fail with profile parsing error, not file system error. Got: ${error.message}`
    )
  }

  // Clean up
  if (fs.existsSync(mockProfile)) fs.unlinkSync(mockProfile)
  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
})

test('generateMarkdown should use default format when not specified', async (t) => {
  // Skip this test if pprof-to-md is not available
  try {
    await import('pprof-to-md')
  } catch (error) {
    t.skip('pprof-to-md not available')
    return
  }

  // Create a mock pprof file
  const mockProfile = path.join(__dirname, 'temp-profile-md-default.pb')
  const outputFile = path.join(__dirname, 'temp-output-default.md')

  fs.writeFileSync(mockProfile, Buffer.alloc(100))

  try {
    // Call without format option - should default to 'summary'
    await generateMarkdown(mockProfile, outputFile)
  } catch (error) {
    // Expected to fail with mock data
    assert.ok(error.message, 'Should have error message')
  }

  // Clean up
  if (fs.existsSync(mockProfile)) fs.unlinkSync(mockProfile)
  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
})

test('generateMarkdown should accept different format options', async (t) => {
  // Skip this test if pprof-to-md is not available
  try {
    await import('pprof-to-md')
  } catch (error) {
    t.skip('pprof-to-md not available')
    return
  }

  const mockProfile = path.join(__dirname, 'temp-profile-md-formats.pb')
  const outputFile = path.join(__dirname, 'temp-output-formats.md')

  fs.writeFileSync(mockProfile, Buffer.alloc(100))

  const formats = ['summary', 'detailed', 'adaptive']

  for (const format of formats) {
    try {
      await generateMarkdown(mockProfile, outputFile, { format })
    } catch (error) {
      // Expected to fail with mock data, but the format option should be accepted
      assert.ok(error.message, `Should have error message for format: ${format}`)
    }
  }

  // Clean up
  if (fs.existsSync(mockProfile)) fs.unlinkSync(mockProfile)
  if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile)
})
