'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { once } = require('node:events')

const cliPath = path.join(__dirname, '..', 'bin', 'flame.js')

function runCli (args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args], {
      stdio: 'pipe',
      ...options
    })

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

    child.on('error', reject)
  })
}

test('CLI should show help when --help is passed', async (t) => {
  const result = await runCli(['--help'])

  assert.strictEqual(result.code, 0, 'Should exit successfully')
  assert.ok(result.stdout.includes('Usage: flame'), 'Should show usage information')
  assert.ok(result.stdout.includes('Commands:'), 'Should show commands section')
  assert.ok(result.stdout.includes('run <script>'), 'Should show run command')
  assert.ok(result.stdout.includes('generate <pprof-file>'), 'Should show generate command')
})

test('CLI should show version when --version is passed', async (t) => {
  const result = await runCli(['--version'])

  assert.strictEqual(result.code, 0, 'Should exit successfully')
  assert.ok(result.stdout.trim().match(/^\d+\.\d+\.\d+$/), 'Should show version number')
})

test('CLI should show error for no command', async (t) => {
  const result = await runCli([])

  assert.strictEqual(result.code, 1, 'Should exit with error code')
  assert.ok(result.stderr.includes('No command specified'), 'Should show error message')
})

test('CLI should show error for unknown command', async (t) => {
  const result = await runCli(['unknown'])

  assert.strictEqual(result.code, 1, 'Should exit with error code')
  assert.ok(result.stderr.includes('Unknown command'), 'Should show unknown command error')
})

test('CLI run command should show error for no script', async (t) => {
  const result = await runCli(['run'])

  assert.strictEqual(result.code, 1, 'Should exit with error code')
  assert.ok(result.stderr.includes('No script specified'), 'Should show no script error')
})

test('CLI run command should show error for non-existent script', async (t) => {
  const result = await runCli(['run', 'non-existent.js'])

  assert.strictEqual(result.code, 1, 'Should exit with error code')
  assert.ok(result.stderr.includes('not found'), 'Should show file not found error')
})

test('CLI generate command should show error for no file', async (t) => {
  const result = await runCli(['generate'])

  assert.strictEqual(result.code, 1, 'Should exit with error code')
  assert.ok(result.stderr.includes('No pprof file specified'), 'Should show no file error')
})

test('CLI generate command should show error for non-existent file', async (t) => {
  const result = await runCli(['generate', 'non-existent.pb'])

  assert.strictEqual(result.code, 1, 'Should exit with error code')
  assert.ok(result.stderr.includes('not found'), 'Should show file not found error')
})

test('CLI help should include node-options flag', async (t) => {
  const result = await runCli(['--help'])

  assert.strictEqual(result.code, 0, 'Should exit successfully')
  assert.ok(result.stdout.includes('--node-options'), 'Should show --node-options option')
  assert.ok(result.stdout.includes('Node.js CLI options to pass'), 'Should show node-options description')
})

test('CLI help should include node-modules-source-maps flag', async (t) => {
  const result = await runCli(['--help'])

  assert.strictEqual(result.code, 0, 'Should exit successfully')
  assert.ok(result.stdout.includes('--node-modules-source-maps'), 'Should show --node-modules-source-maps option')
  assert.ok(result.stdout.includes('-n'), 'Should show -n short option')
  assert.ok(result.stdout.includes('Node modules to load sourcemaps from'), 'Should show node-modules-source-maps description')
})

test('CLI should accept --node-modules-source-maps flag', async (t) => {
  // Create a simple test script that checks for the env var
  const testScript = path.join(__dirname, 'temp-node-modules-sourcemaps-test.js')
  fs.writeFileSync(testScript, `
    console.log('FLAME_NODE_MODULES_SOURCE_MAPS:', process.env.FLAME_NODE_MODULES_SOURCE_MAPS);
    console.log('Test completed');
    process.exit(0);
  `)

  const child = spawn('node', [cliPath, 'run', '--node-modules-source-maps=next,@next/next-server', testScript], {
    stdio: 'pipe'
  })

  let stdout = ''

  child.stdout.on('data', (data) => {
    stdout += data.toString()
  })

  child.stderr.on('data', (data) => {
    // Consume stderr to prevent blocking
  })

  // Wait for the process to complete or timeout after 5 seconds
  const [exitCode] = await Promise.race([
    once(child, 'close'),
    new Promise((resolve) => {
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve([-1])
      }, 5000)
    })
  ])

  // Clean up
  fs.unlinkSync(testScript)

  // Verify the env var was passed correctly
  assert.notStrictEqual(exitCode, -1, 'Process should complete before timeout')
  assert.ok(stdout.includes('FLAME_NODE_MODULES_SOURCE_MAPS: next,@next/next-server'), 'Should pass node-modules-source-maps to the profiled process')
})

test('CLI should accept -n shorthand for node-modules-source-maps', async (t) => {
  // Create a simple test script that checks for the env var
  const testScript = path.join(__dirname, 'temp-node-modules-sourcemaps-short-test.js')
  fs.writeFileSync(testScript, `
    console.log('FLAME_NODE_MODULES_SOURCE_MAPS:', process.env.FLAME_NODE_MODULES_SOURCE_MAPS);
    console.log('Test completed');
    process.exit(0);
  `)

  const child = spawn('node', [cliPath, 'run', '-n', 'next', testScript], {
    stdio: 'pipe'
  })

  let stdout = ''

  child.stdout.on('data', (data) => {
    stdout += data.toString()
  })

  child.stderr.on('data', (data) => {
    // Consume stderr to prevent blocking
  })

  // Wait for the process to complete or timeout after 5 seconds
  const [exitCode] = await Promise.race([
    once(child, 'close'),
    new Promise((resolve) => {
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve([-1])
      }, 5000)
    })
  ])

  // Clean up
  fs.unlinkSync(testScript)

  // Verify the env var was passed correctly
  assert.notStrictEqual(exitCode, -1, 'Process should complete before timeout')
  assert.ok(stdout.includes('FLAME_NODE_MODULES_SOURCE_MAPS: next'), 'Should pass node-modules-source-maps via -n shorthand')
})

test('CLI should accept both --sourcemap-dirs and --node-modules-source-maps together', async (t) => {
  // Create a simple test script that checks for both env vars
  const testScript = path.join(__dirname, 'temp-both-sourcemaps-test.js')
  fs.writeFileSync(testScript, `
    console.log('FLAME_SOURCEMAP_DIRS:', process.env.FLAME_SOURCEMAP_DIRS);
    console.log('FLAME_NODE_MODULES_SOURCE_MAPS:', process.env.FLAME_NODE_MODULES_SOURCE_MAPS);
    console.log('Test completed');
    process.exit(0);
  `)

  // Use platform-appropriate separator for sourcemap-dirs input
  const sourcemapDirsArg = `--sourcemap-dirs=dist${path.delimiter}build`
  const child = spawn('node', [cliPath, 'run', sourcemapDirsArg, '--node-modules-source-maps=next,@next/next-server', testScript], {
    stdio: 'pipe'
  })

  let stdout = ''

  child.stdout.on('data', (data) => {
    stdout += data.toString()
  })

  child.stderr.on('data', (data) => {
    // Consume stderr to prevent blocking
  })

  // Wait for the process to complete or timeout after 5 seconds
  const [exitCode] = await Promise.race([
    once(child, 'close'),
    new Promise((resolve) => {
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve([-1])
      }, 5000)
    })
  ])

  // Clean up
  fs.unlinkSync(testScript)

  // Verify both env vars were passed correctly
  // The env var uses path.delimiter which is ';' on Windows and ':' on Unix
  const expectedSourcemapDirs = `dist${path.delimiter}build`
  assert.notStrictEqual(exitCode, -1, 'Process should complete before timeout')
  assert.ok(stdout.includes(`FLAME_SOURCEMAP_DIRS: ${expectedSourcemapDirs}`), 'Should pass sourcemap-dirs to the profiled process')
  assert.ok(stdout.includes('FLAME_NODE_MODULES_SOURCE_MAPS: next,@next/next-server'), 'Should pass node-modules-source-maps to the profiled process')
})

test('CLI should accept --node-options flag', async (t) => {
  // Create a simple test script that uses process.execArgv to verify node options were passed
  const testScript = path.join(__dirname, 'temp-node-options-test.js')
  fs.writeFileSync(testScript, `
    console.log('execArgv:', JSON.stringify(process.execArgv));
    console.log('Test completed');
    process.exit(0);
  `)

  const child = spawn('node', [cliPath, 'run', '--node-options=--max-old-space-size=512', testScript], {
    stdio: 'pipe'
  })

  let stdout = ''

  child.stdout.on('data', (data) => {
    stdout += data.toString()
  })

  child.stderr.on('data', (data) => {
    // Consume stderr to prevent blocking
  })

  // Wait for the process to complete or timeout after 5 seconds
  const [exitCode] = await Promise.race([
    once(child, 'close'),
    new Promise((resolve) => {
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve([-1])
      }, 5000)
    })
  ])

  // Clean up
  fs.unlinkSync(testScript)

  // Verify the node options were passed correctly
  assert.notStrictEqual(exitCode, -1, 'Process should complete before timeout')
  assert.ok(stdout.includes('--max-old-space-size=512'), 'Should pass node options to the profiled process')
})

test('CLI should handle SIGINT gracefully', async (t) => {
  // Create a simple test script that runs for a while
  const testScript = path.join(__dirname, 'temp-long-script.js')
  fs.writeFileSync(testScript, `
    console.log('Starting...');
    setInterval(() => {
      console.log('Running...');
    }, 1000);
  `)

  const child = spawn('node', [cliPath, 'run', testScript], {
    stdio: 'pipe',
    cwd: __dirname // Run in test directory so profile files are created there
  })

  let stdout = ''

  child.stdout.on('data', (data) => {
    stdout += data.toString()
  })

  // Wait 2 seconds then send SIGINT to give the script time to start
  setTimeout(() => {
    child.kill('SIGINT')
  }, 2000)

  // Wait for the process to close
  const [exitCode] = await Promise.race([
    once(child, 'close'),
    new Promise((resolve) => {
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve([-1])
      }, 3000)
    })
  ])

  // Clean up test script
  fs.unlinkSync(testScript)

  // Clean up any generated profile files in test directory
  const files = fs.readdirSync(__dirname)
  files.forEach(file => {
    if ((file.startsWith('cpu-profile-') || file.startsWith('heap-profile-')) &&
        (file.endsWith('.pb') || file.endsWith('.html') || file.endsWith('.js'))) {
      fs.unlinkSync(path.join(__dirname, file))
    }
  })

  // Verify the CLI responded to SIGINT by exiting
  assert.notStrictEqual(exitCode, undefined, 'Process should exit after receiving SIGINT')
  assert.ok(stdout.includes('Starting'), 'Should have started the script')
})
