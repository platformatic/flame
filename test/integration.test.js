const test = require('node:test')
const assert = require('node:assert')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

test('integration: full workflow from profiling to flamegraph generation', { skip: process.platform === 'win32' ? 'SIGUSR2 not supported on Windows' : false }, async (t) => {
  const cliPath = path.join(__dirname, '..', 'bin', 'flame.js')
  const outputDir = __dirname

  // Step 1: Create a test script that does some work
  const workScript = path.join(__dirname, 'temp-work-script.js')
  fs.writeFileSync(workScript, `
    function fibonacci(n) {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    
    function doWork() {
      console.log('Starting CPU intensive work...');
      const result = fibonacci(30); // More work to make profiling meaningful
      console.log('Work result:', result);
      console.log('Work complete');
    }
    
    // Do work immediately - profiling is already started by flame run
    doWork();
    
    // Exit cleanly to trigger profile generation
    process.exit(0);
  `)

  // Step 2: Start profiling the script using flame run command (auto-starts profiling)
  const child = spawn('node', [cliPath, 'run', workScript], {
    stdio: 'pipe',
    cwd: outputDir
  })

  let profileFile = null

  child.stdout.on('data', (data) => {
    const output = data.toString()

    // With auto-start, profiling begins immediately and stops on exit
    // Just capture the profile filename when it's written
    const profileMatch = output.match(/CPU profile written to (cpu-profile-[^\s]+\.pb)/)
    if (profileMatch) {
      profileFile = profileMatch[1]
      // The process will exit naturally after creating the profile
    }
  })

  child.stderr.on('data', (data) => {
    console.error('Server error:', data.toString())
  })

  // Wait for the profiling process to complete (should be much faster with auto-start)
  await new Promise((resolve) => {
    child.on('close', resolve)
    // Timeout after 10 seconds (longer to allow for profile generation)
    setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 10000)
  })

  // Clean up the work script
  fs.unlinkSync(workScript)

  // Check if profile was created
  if (!profileFile) {
    assert.fail('Profile generation failed - no profile file was created. Check if profiling signals were processed correctly.')
  }

  const profilePath = path.join(outputDir, profileFile)
  assert.ok(fs.existsSync(profilePath), 'Profile file should be created')
  assert.ok(fs.statSync(profilePath).size > 0, 'Profile file should not be empty')

  // Step 3: Generate flamegraph from the profile
  try {
    require.resolve('@platformatic/react-pprof/cli.js')
  } catch (error) {
    // Clean up and fail if react-pprof CLI is not available
    fs.unlinkSync(profilePath)
    assert.fail('@platformatic/react-pprof CLI not available - dependency should be installed')
  }

  const htmlFile = path.join(outputDir, 'test-flamegraph.html')
  const generateResult = await new Promise((resolve) => {
    const generateChild = spawn('node', [cliPath, 'generate', '-o', htmlFile, profilePath], {
      stdio: 'pipe'
    })

    let generateStdout = ''
    let generateStderr = ''

    generateChild.stdout.on('data', (data) => {
      generateStdout += data.toString()
    })

    generateChild.stderr.on('data', (data) => {
      generateStderr += data.toString()
    })

    generateChild.on('close', (code) => {
      resolve({ code, stdout: generateStdout, stderr: generateStderr })
    })
  })

  // Clean up profile file
  fs.unlinkSync(profilePath)

  if (generateResult.code !== 0) {
    assert.fail(`Flamegraph generation failed with exit code ${generateResult.code}: ${generateResult.stderr || generateResult.stdout}`)
  }

  // Verify HTML file was created and has content
  assert.ok(fs.existsSync(htmlFile), 'HTML file should be created')
  assert.ok(fs.statSync(htmlFile).size > 0, 'HTML file should not be empty')

  // Verify the output contains expected success messages
  assert.ok(
    generateResult.stdout.includes('Generated HTML output') ||
    generateResult.stdout.includes('HTML'),
    'Should indicate successful HTML generation'
  )

  // Clean up generated files
  if (fs.existsSync(htmlFile)) {
    fs.unlinkSync(htmlFile)
  }

  const jsFile = htmlFile.replace('.html', '.js')
  if (fs.existsSync(jsFile)) {
    fs.unlinkSync(jsFile)
  }
})

test('integration: Windows compatibility test', { skip: process.platform !== 'win32' ? 'Windows-only test' : false }, async (t) => {
  const cliPath = path.join(__dirname, '..', 'bin', 'flame.js')

  // Test basic CLI functionality on Windows
  const helpResult = await new Promise((resolve) => {
    const helpChild = spawn('node', [cliPath, '--help'], {
      stdio: 'pipe'
    })

    let stdout = ''
    let stderr = ''

    helpChild.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    helpChild.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    helpChild.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })
  })

  assert.strictEqual(helpResult.code, 0, 'Help command should work on Windows')
  assert.ok(helpResult.stdout.includes('Usage: flame'), 'Should show usage information')

  // Test toggle command on Windows (should show warning about Windows compatibility)
  const toggleResult = await new Promise((resolve) => {
    const toggleChild = spawn('node', [cliPath, 'toggle'], {
      stdio: 'pipe'
    })

    let stdout = ''
    let stderr = ''

    toggleChild.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    toggleChild.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    toggleChild.on('close', (code) => {
      resolve({ code, stdout, stderr })
    })

    // Kill after timeout to prevent hanging
    setTimeout(() => {
      toggleChild.kill('SIGKILL')
      resolve({ code: -1, stdout, stderr })
    }, 3000)
  })

  // On Windows, the toggle command should either find processes or show a message
  assert.ok(
    toggleResult.stdout.includes('Windows detected') ||
    toggleResult.stdout.includes('processes') ||
    toggleResult.stderr.includes('Error'),
    'Toggle command should handle Windows appropriately'
  )
})
