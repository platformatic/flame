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
