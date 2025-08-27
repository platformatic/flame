const fs = require('fs')
const path = require('path')
const pprof = require('@datadog/pprof')
const { spawn } = require('child_process')

const profiler = pprof.time
let isProfilerRunning = false
const autoStart = process.env.FLAME_AUTO_START === 'true'

function generateFlamegraph (pprofPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Find the flame CLI
    const flameBinPath = path.resolve(__dirname, 'bin', 'flame.js')
    const args = [flameBinPath, 'generate', '-o', outputPath, pprofPath]
    
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
        reject(new Error(`Flamegraph generation failed: ${stderr || stdout}`))
      }
    })
    
    child.on('error', (error) => {
      reject(error)
    })
  })
}

function stopProfilerQuick () {
  if (!isProfilerRunning) {
    return null
  }

  console.log('Stopping CPU profiler and writing profile to disk...')
  try {
    const profileData = profiler.stop()
    const profile = profileData.encode()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `cpu-profile-${timestamp}.pb`

    fs.writeFileSync(filename, profile)
    console.log(`🔥 CPU profile written to: ${filename}`)

    isProfilerRunning = false
    return filename
  } catch (error) {
    console.error('Error generating profile:', error)
    isProfilerRunning = false
    return null
  }
}

async function stopProfilerAndSave (generateHtml = false) {
  if (!isProfilerRunning) {
    return null
  }

  console.log('Stopping CPU profiler and writing profile to disk...')
  try {
    const profileData = profiler.stop()
    const profile = profileData.encode()
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `cpu-profile-${timestamp}.pb`

    fs.writeFileSync(filename, profile)
    console.log(`🔥 CPU profile written to: ${filename}`)

    if (generateHtml) {
      // Auto-generate HTML flamegraph on exit
      const htmlFilename = filename.replace('.pb', '.html')
      console.log(`🔥 Generating flamegraph...`)
      
      try {
        await generateFlamegraph(filename, htmlFilename)
        console.log(`🔥 Flamegraph generated: ${htmlFilename}`)
        console.log(`🔥 Open file://${path.resolve(htmlFilename)} in your browser to view the flamegraph`)
      } catch (error) {
        console.error('Warning: Failed to generate flamegraph:', error.message)
      }
    }

    isProfilerRunning = false
    return filename
  } catch (error) {
    console.error('Error generating profile:', error)
    isProfilerRunning = false
    return null
  }
}

function generateHtmlAsync (filename) {
  const htmlFilename = filename.replace('.pb', '.html')
  console.log(`🔥 Generating flamegraph...`)
  console.log(`🔥 Flamegraph will be saved as: ${htmlFilename}`)
  console.log(`🔥 Open file://${path.resolve(htmlFilename)} in your browser once generation completes`)
  
  generateFlamegraph(filename, htmlFilename)
    .then(() => {
      console.log(`🔥 Flamegraph generation completed`)
    })
    .catch(error => {
      console.error('Warning: Failed to generate flamegraph:', error.message)
    })
}

function toggleProfiler () {
  if (!isProfilerRunning) {
    console.log('Starting CPU profiler...')
    profiler.start()
    isProfilerRunning = true
  } else {
    // Manual toggle - don't generate HTML
    stopProfilerAndSave(false)
  }
}

// Set up signal handling (SIGUSR2 on Unix-like systems)
if (process.platform !== 'win32') {
  process.on('SIGUSR2', toggleProfiler)
  console.log('Flame preload script loaded. Send SIGUSR2 to toggle profiling.')
} else {
  // On Windows, we use SIGINT (Ctrl-C) or set up alternative IPC
  console.log('Flame preload script loaded. Windows platform detected.')
  console.log('Use the CLI toggle command or send SIGINT to control profiling.')
}

console.log(`Process PID: ${process.pid}`)

// Auto-start profiling if enabled
if (autoStart) {
  console.log('🔥 Auto-starting CPU profiler...')
  toggleProfiler()

  let exitHandlerCalled = false

  // Auto-stop profiling when the process is about to exit
  process.on('beforeExit', async () => {
    if (isProfilerRunning && !exitHandlerCalled) {
      exitHandlerCalled = true
      console.log('🔥 Process exiting, stopping profiler...')
      await stopProfilerAndSave(true) // Generate HTML on exit
    }
  })

  // Handle explicit process.exit() calls
  const originalExit = process.exit
  process.exit = function (code) {
    if (isProfilerRunning && !exitHandlerCalled) {
      exitHandlerCalled = true
      console.log('🔥 Process exiting, stopping profiler...')
      // For process.exit(), we need to handle async differently since we can't await here
      stopProfilerAndSave(true).then(() => {
        return originalExit.call(this, code)
      }).catch(() => {
        return originalExit.call(this, code)
      })
      // Return without calling originalExit immediately - let the promise handle it
      return
    }
    return originalExit.call(this, code)
  }

  process.on('SIGINT', () => {
    if (isProfilerRunning && !exitHandlerCalled) {
      exitHandlerCalled = true
      console.log('\n🔥 SIGINT received, stopping profiler...')
      // For signals, do a quick synchronous save and show HTML info immediately
      const filename = stopProfilerQuick()
      if (filename) {
        generateHtmlAsync(filename)
      }
    }
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    if (isProfilerRunning && !exitHandlerCalled) {
      exitHandlerCalled = true
      console.log('\n🔥 SIGTERM received, stopping profiler...')
      // For signals, do a quick synchronous save and show HTML info immediately
      const filename = stopProfilerQuick()
      if (filename) {
        generateHtmlAsync(filename)
      }
    }
    process.exit(0)
  })
}
