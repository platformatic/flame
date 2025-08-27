# @platformatic/flame

🔥 CPU profiling and flamegraph visualization tool built on top of [@platformatic/react-pprof](https://github.com/platformatic/react-pprof).

## Features

- **Auto-Start Profiling**: CPU profiling starts immediately when using `flame run` (default behavior)
- **Manual Control**: Optional manual mode with signal-based control using `SIGUSR2`
- **Interactive Flamegraphs**: Generate interactive HTML flamegraphs with WebGL visualization
- **CLI Interface**: Simple command-line tool for profiling and visualization
- **Zero Config**: Works out of the box with sensible defaults

## Installation

```bash
npm install -g @platformatic/flame
```

## Quick Start

### Profile a Node.js Script (Auto-Start Mode)

```bash
# Start profiling your application (profiling begins immediately)
flame run server.js

# The application runs with CPU profiling active
# Profile and HTML flamegraph are automatically generated when the process exits
```

### Manual Profiling Mode

```bash
# Start profiling in manual mode (requires signals to start)
flame run --manual server.js

# In another terminal, toggle profiling on/off
kill -USR2 <PID>

# Or use the built-in toggle command
flame toggle
```

### Generate Flamegraph

```bash
# Generate HTML flamegraph from pprof file
flame generate cpu-profile-2024-01-01T12-00-00-000Z.pb

# Specify custom output file
flame generate -o my-flamegraph.html profile.pb.gz
```

## CLI Usage

```bash
flame [options] <command>

Commands:
  run <script>           Run a script with profiling enabled
  generate <pprof-file>  Generate HTML flamegraph from pprof file
  toggle                 Toggle profiling for running flame processes

Options:
  -o, --output <file>    Output HTML file (for generate command)
  -m, --manual          Manual profiling mode (require SIGUSR2 to start)
  -h, --help            Show help message
  -v, --version         Show version number
```

## Programmatic API

```javascript
const { startProfiling, generateFlamegraph, parseProfile } = require('@platformatic/flame')

// Start profiling a script with auto-start (default)
const { pid, toggleProfiler } = startProfiling('server.js', ['--port', '3000'], { autoStart: true })

// Or start in manual mode
const { pid, toggleProfiler } = startProfiling('server.js', ['--port', '3000'], { autoStart: false })

console.log(`Started profiling process ${pid}`)

// Toggle profiling programmatically (useful in manual mode)
toggleProfiler()

// Generate interactive flamegraph from pprof file
await generateFlamegraph('profile.pb.gz', 'flamegraph.html')

// Parse profile data
const profile = await parseProfile('profile.pb')
```

## How It Works

1. **Auto-Start Mode (Default)**: Profiling begins immediately when `flame run` starts your script
2. **Auto-Generation on Exit**: Profile (.pb) and interactive HTML flamegraph are automatically created when the process exits
3. **Manual Mode**: Use `--manual` flag to require `SIGUSR2` signals for start/stop control (no auto-HTML generation)
4. **Interactive Visualization**: The `@platformatic/react-pprof` library generates interactive WebGL-based HTML flamegraphs

## Profile Files

Profile files are saved with timestamps in the format:
```
cpu-profile-2024-01-01T12-00-00-000Z.pb
```

The files are compressed Protocol Buffer format compatible with the pprof ecosystem.

## Integration with Existing Apps

### Express.js Example

```javascript
// server.js
const express = require('express')
const app = express()

app.get('/', (req, res) => {
  // Your application logic
  res.json({ message: 'Hello World' })
})

app.listen(3000)
```

**Auto-Start Mode (Recommended):**
```bash
# Profile the Express app (profiling starts immediately)
flame run server.js

# In another terminal, make some requests while profiling is active
curl http://localhost:3000
curl http://localhost:3000
curl http://localhost:3000

# Stop the server (Ctrl-C) to automatically save profile and generate HTML flamegraph
# Files created: cpu-profile-*.pb and cpu-profile-*.html
# Open the HTML file in your browser to view the flamegraph!
```

**Manual Mode:**
```bash
# Profile the Express app in manual mode
flame run --manual server.js

# In another terminal, start profiling
flame toggle

# Make some requests
curl http://localhost:3000
curl http://localhost:3000

# Stop profiling and save profile
flame toggle

# Generate flamegraph
flame generate cpu-profile-*.pb
```

### Load Testing Example

The package includes a complete load testing example using `autocannon`:

```bash
# Install dependencies (if you cloned the repo)
npm install

# Run the load test example
node examples/run-load-test.js
```

This example will:
1. Start a test server with flame profiling enabled
2. Begin CPU profiling
3. Run a 10-second load test with multiple endpoints
4. Stop profiling and save the profile
5. Show you how to generate the flamegraph

You can also run each step manually:

```bash
# Terminal 1: Start the test server with profiling
flame run examples/load-test-server.js

# Terminal 2: Run load test with autocannon
npx autocannon -c 10 -d 10 http://localhost:3000

# Terminal 1: Toggle profiling (start/stop)
kill -USR2 <PID>
```

## Requirements

- Node.js >= 18.0.0
- `@datadog/pprof` for CPU profiling
- `@platformatic/react-pprof` for flamegraph generation

## License

MIT