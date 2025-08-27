const fs = require('fs')
const pprof = require('@datadog/pprof')

const profiler = pprof.time
let isProfilerRunning = false

function toggleProfiler () {
  if (!isProfilerRunning) {
    console.log('Starting CPU profiler...')
    profiler.start()
    isProfilerRunning = true
  } else {
    console.log('Stopping CPU profiler and writing profile to disk...')
    try {
      const profileData = profiler.stop()

      const profile = profileData.encode()

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `cpu-profile-${timestamp}.pb`

      fs.writeFileSync(filename, profile)
      console.log(`CPU profile written to ${filename}`)

      isProfilerRunning = false
    } catch (error) {
      console.error('Error generating profile:', error)
      isProfilerRunning = false
    }
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

// Auto-start profiling immediately for the run command
console.log('🔥 Auto-starting CPU profiler...')
toggleProfiler()

let exitHandlerCalled = false

// Auto-stop profiling when the process is about to exit
process.on('beforeExit', () => {
  if (isProfilerRunning && !exitHandlerCalled) {
    exitHandlerCalled = true
    console.log('🔥 Process exiting, stopping profiler...')
    toggleProfiler()
  }
})

// Handle explicit process.exit() calls
const originalExit = process.exit
process.exit = function (code) {
  if (isProfilerRunning && !exitHandlerCalled) {
    exitHandlerCalled = true
    console.log('🔥 Process exiting, stopping profiler...')
    toggleProfiler()
  }
  return originalExit.call(this, code)
}

process.on('SIGINT', () => {
  if (isProfilerRunning && !exitHandlerCalled) {
    exitHandlerCalled = true
    console.log('\n🔥 SIGINT received, stopping profiler...')
    toggleProfiler()
  }
  process.exit(0)
})

process.on('SIGTERM', () => {
  if (isProfilerRunning && !exitHandlerCalled) {
    exitHandlerCalled = true
    console.log('\n🔥 SIGTERM received, stopping profiler...')
    toggleProfiler()
  }
  process.exit(0)
})
