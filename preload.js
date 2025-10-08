'use strict'

const fs = require('fs')
const path = require('path')
const pprof = require('@datadog/pprof')
const { spawn } = require('child_process')

const cpuProfiler = pprof.time
const heapProfiler = pprof.heap
let isCpuProfilerRunning = false
let isHeapProfilerRunning = false
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
  if (!isCpuProfilerRunning && !isHeapProfilerRunning) {
    return null
  }

  console.log('Stopping profilers and writing profiles to disk...')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filenames = []

  try {
    if (isCpuProfilerRunning) {
      const cpuProfileData = cpuProfiler.stop()
      const cpuProfile = cpuProfileData.encode()
      const cpuFilename = `cpu-profile-${timestamp}.pb`
      fs.writeFileSync(cpuFilename, cpuProfile)
      console.log(`🔥 CPU profile written to: ${cpuFilename}`)
      filenames.push(cpuFilename)
      isCpuProfilerRunning = false
    }

    if (isHeapProfilerRunning) {
      const heapProfileData = heapProfiler.profile()
      heapProfiler.stop()
      const heapProfile = heapProfileData.encode()
      const heapFilename = `heap-profile-${timestamp}.pb`
      fs.writeFileSync(heapFilename, heapProfile)
      console.log(`🔥 Heap profile written to: ${heapFilename}`)
      filenames.push(heapFilename)
      isHeapProfilerRunning = false
    }

    return filenames
  } catch (error) {
    console.error('Error generating profiles:', error)
    isCpuProfilerRunning = false
    isHeapProfilerRunning = false
    return null
  }
}

async function stopProfilerAndSave (generateHtml = false) {
  if (!isCpuProfilerRunning && !isHeapProfilerRunning) {
    return null
  }

  console.log('Stopping profilers and writing profiles to disk...')
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filenames = []

  try {
    if (isCpuProfilerRunning) {
      const cpuProfileData = cpuProfiler.stop()
      const cpuProfile = cpuProfileData.encode()
      const cpuFilename = `cpu-profile-${timestamp}.pb`
      fs.writeFileSync(cpuFilename, cpuProfile)
      console.log(`🔥 CPU profile written to: ${cpuFilename}`)
      filenames.push(cpuFilename)
      isCpuProfilerRunning = false

      if (generateHtml) {
        const htmlFilename = cpuFilename.replace('.pb', '.html')
        console.log('🔥 Generating CPU flamegraph...')
        try {
          await generateFlamegraph(cpuFilename, htmlFilename)
          console.log(`🔥 CPU flamegraph generated: ${htmlFilename}`)
          console.log(`🔥 Open file://${path.resolve(htmlFilename)} in your browser to view the CPU flamegraph`)
        } catch (error) {
          console.error('Warning: Failed to generate CPU flamegraph:', error.message)
        }
      }
    }

    if (isHeapProfilerRunning) {
      const heapProfileData = heapProfiler.profile()
      heapProfiler.stop()
      const heapProfile = heapProfileData.encode()
      const heapFilename = `heap-profile-${timestamp}.pb`
      fs.writeFileSync(heapFilename, heapProfile)
      console.log(`🔥 Heap profile written to: ${heapFilename}`)
      filenames.push(heapFilename)
      isHeapProfilerRunning = false

      if (generateHtml) {
        const htmlFilename = heapFilename.replace('.pb', '.html')
        console.log('🔥 Generating heap flamegraph...')
        try {
          await generateFlamegraph(heapFilename, htmlFilename)
          console.log(`🔥 Heap flamegraph generated: ${htmlFilename}`)
          console.log(`🔥 Open file://${path.resolve(htmlFilename)} in your browser to view the heap flamegraph`)
        } catch (error) {
          console.error('Warning: Failed to generate heap flamegraph:', error.message)
        }
      }
    }

    return filenames
  } catch (error) {
    console.error('Error generating profiles:', error)
    isCpuProfilerRunning = false
    isHeapProfilerRunning = false
    return null
  }
}

function generateHtmlAsync (filenames) {
  if (!Array.isArray(filenames)) {
    filenames = [filenames]
  }

  filenames.forEach(filename => {
    const htmlFilename = filename.replace('.pb', '.html')
    const profileType = filename.includes('cpu-profile') ? 'CPU' : 'Heap'
    console.log(`🔥 Generating ${profileType} flamegraph...`)
    console.log(`🔥 Flamegraph will be saved as: ${htmlFilename}`)
    console.log(`🔥 Open file://${path.resolve(htmlFilename)} in your browser once generation completes`)

    generateFlamegraph(filename, htmlFilename)
      .then(() => {
        console.log(`🔥 ${profileType} flamegraph generation completed`)
      })
      .catch(error => {
        console.error(`Warning: Failed to generate ${profileType} flamegraph:`, error.message)
      })
  })
}

function toggleProfiler () {
  if (!isCpuProfilerRunning && !isHeapProfilerRunning) {
    console.log('Starting CPU and heap profilers...')
    cpuProfiler.start()
    // Start heap profiler with default parameters
    // intervalBytes: 512KB (512 * 1024)
    // stackDepth: 64
    heapProfiler.start(512 * 1024, 64)
    isCpuProfilerRunning = true
    isHeapProfilerRunning = true
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
  console.log('🔥 Auto-starting CPU and heap profilers...')
  toggleProfiler()

  let exitHandlerCalled = false

  // Auto-stop profiling when the process is about to exit
  process.on('beforeExit', async () => {
    if ((isCpuProfilerRunning || isHeapProfilerRunning) && !exitHandlerCalled) {
      exitHandlerCalled = true
      console.log('🔥 Process exiting, stopping profilers...')
      await stopProfilerAndSave(true) // Generate HTML on exit
    }
  })

  // Handle explicit process.exit() calls
  const originalExit = process.exit
  process.exit = function (code) {
    if ((isCpuProfilerRunning || isHeapProfilerRunning) && !exitHandlerCalled) {
      exitHandlerCalled = true
      console.log('🔥 Process exiting, stopping profilers...')
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
    if ((isCpuProfilerRunning || isHeapProfilerRunning) && !exitHandlerCalled) {
      exitHandlerCalled = true
      console.log('\n🔥 SIGINT received, stopping profilers...')
      // For signals, do a quick synchronous save and show HTML info immediately
      const filenames = stopProfilerQuick()
      if (filenames) {
        generateHtmlAsync(filenames)
      }
    }
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    if ((isCpuProfilerRunning || isHeapProfilerRunning) && !exitHandlerCalled) {
      exitHandlerCalled = true
      console.log('\n🔥 SIGTERM received, stopping profilers...')
      // For signals, do a quick synchronous save and show HTML info immediately
      const filenames = stopProfilerQuick()
      if (filenames) {
        generateHtmlAsync(filenames)
      }
    }
    process.exit(0)
  })
}
