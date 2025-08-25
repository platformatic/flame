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

process.on('SIGUSR2', toggleProfiler)

console.log('Flame preload script loaded. Send SIGUSR2 to toggle profiling.')
console.log(`Process PID: ${process.pid}`)
