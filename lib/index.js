'use strict'

const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { spawn } = require('child_process')

/**
 * Start profiling a Node.js process using the preload script
 * @param {string} script - Path to the script to profile
 * @param {string[]} args - Arguments to pass to the script
 * @param {object} options - Options for profiling
 * @param {boolean} options.autoStart - Whether to start profiling immediately (default: false)
 * @param {string[]} options.nodeOptions - Node.js CLI options to pass (default: [])
 * @returns {Promise<object>} Process information
 */
function startProfiling (script, args = [], options = {}) {
  const preloadPath = path.join(__dirname, '..', 'preload.js')

  const env = {
    ...process.env,
    ...options.env,
    FLAME_AUTO_START: options.autoStart ? 'true' : 'false'
  }

  // Construct the node command with options
  const nodeArgs = [
    ...(options.nodeOptions || []),
    '-r',
    preloadPath,
    script,
    ...args
  ]

  const child = spawn('node', nodeArgs, {
    stdio: 'inherit',
    env,
    ...options
  })

  return {
    pid: child.pid,
    process: child,
    toggleProfiler: () => {
      if (process.platform !== 'win32') {
        process.kill(child.pid, 'SIGUSR2')
      } else {
        // On Windows, we'll need to use a different approach
        console.warn('Direct signal toggle not supported on Windows. Use the CLI toggle command instead.')
      }
    }
  }
}

/**
 * Parse a pprof profile file
 * @param {string} filePath - Path to the pprof file
 * @returns {Promise<object>} Parsed profile data
 */
async function parseProfile (filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Profile file not found: ${filePath}`)
  }

  let data = fs.readFileSync(filePath)

  // Check if the file is gzipped
  const isGzipped = data[0] === 0x1f && data[1] === 0x8b
  if (isGzipped) {
    data = zlib.gunzipSync(data)
  }

  const { Profile } = await import('pprof-format')
  return Profile.decode(data)
}

/**
 * Generate an HTML flamegraph from a pprof file using @platformatic/react-pprof CLI
 * @param {string} pprofPath - Path to the pprof file
 * @param {string} outputPath - Path to write the HTML file
 * @returns {Promise<object>} CLI result with stdout/stderr
 */
async function generateFlamegraph (pprofPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Use the react-pprof CLI to generate the flamegraph
    const cliPath = require.resolve('react-pprof/cli.js')

    const args = [cliPath, '--output', outputPath, pprofPath]
    const child = spawn('node', args, { stdio: 'pipe' })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`CLI failed with exit code ${code}: ${stderr || stdout}`))
      }
    })

    child.on('error', (error) => {
      reject(new Error(`Failed to start CLI: ${error.message}`))
    })
  })
}

module.exports = {
  startProfiling,
  parseProfile,
  generateFlamegraph
}
