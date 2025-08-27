const test = require('node:test')
const assert = require('node:assert')
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

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
    stdio: 'pipe'
  })

  let processExited = false
  let stdout = ''
  let stderr = ''

  child.stdout.on('data', (data) => {
    stdout += data.toString()
  })

  child.stderr.on('data', (data) => {
    stderr += data.toString()
  })

  child.on('close', (code) => {
    processExited = true
  })

  // Wait a bit then send SIGINT
  setTimeout(() => {
    child.kill('SIGINT')
  }, 100)

  // Wait for the process to exit
  await new Promise((resolve) => {
    const checkExit = () => {
      if (processExited) {
        resolve()
      } else {
        setTimeout(checkExit, 50)
      }
    }
    checkExit()

    // Timeout after 3 seconds
    setTimeout(() => {
      if (!processExited) {
        child.kill('SIGKILL')
        resolve()
      }
    }, 3000)
  })

  // Clean up
  fs.unlinkSync(testScript)

  // Verify the CLI responded to SIGINT by exiting
  assert.ok(processExited, 'Process should exit after receiving SIGINT')
  assert.ok(stdout.includes('Starting'), 'Should have started the script')
})
