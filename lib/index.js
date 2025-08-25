const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const { spawn } = require('child_process')

/**
 * Start profiling a Node.js process using the preload script
 * @param {string} script - Path to the script to profile
 * @param {string[]} args - Arguments to pass to the script
 * @param {object} options - Options for profiling
 * @returns {Promise<object>} Process information
 */
function startProfiling (script, args = [], options = {}) {
  const preloadPath = path.join(__dirname, '..', 'preload.js')

  const env = {
    ...process.env,
    ...options.env
  }

  const child = spawn('node', ['-r', preloadPath, script, ...args], {
    stdio: 'inherit',
    env,
    ...options
  })

  return {
    pid: child.pid,
    process: child,
    toggleProfiler: () => {
      process.kill(child.pid, 'SIGUSR2')
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
 * Generate an HTML flamegraph from a pprof file using the CLI approach
 * @param {string} pprofPath - Path to the pprof file
 * @param {string} outputPath - Path to write the HTML file
 * @returns {Promise<void>}
 */
async function generateFlamegraph (pprofPath, outputPath) {
  // Use the react-pprof CLI to generate the flamegraph
  const reactPprofPath = require.resolve('@platformatic/react-pprof/cli.js')

  return new Promise((resolve, reject) => {
    const child = spawn('node', [reactPprofPath, '-o', outputPath, pprofPath], {
      stdio: 'pipe'
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
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`CLI failed with code ${code}: ${stderr}`))
      }
    })

    child.on('error', (error) => {
      reject(error)
    })
  })
}

module.exports = {
  startProfiling,
  parseProfile,
  generateFlamegraph
}
