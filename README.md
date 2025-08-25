# @platformatic/flame

🔥 CPU profiling and flamegraph visualization tool built on top of [@platformatic/react-pprof](https://github.com/platformatic/react-pprof).

## Features

- **Easy Profiling**: Instrument any Node.js application with a simple preload script
- **Signal-based Control**: Start/stop profiling using `SIGUSR2` signals
- **Flamegraph Generation**: Generate interactive HTML flamegraphs from pprof files
- **CLI Interface**: Command-line tool for profiling and visualization
- **Zero Config**: Works out of the box with sensible defaults

## Installation

```bash
npm install -g @platformatic/flame
```

## Quick Start

### Profile a Node.js Script

```bash
# Start profiling your application
flame run server.js

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
  -h, --help            Show help message
  -v, --version         Show version number
```

## Programmatic API

```javascript
const { startProfiling, generateFlamegraph, parseProfile } = require('@platformatic/flame')

// Start profiling a script
const { pid, toggleProfiler } = startProfiling('server.js', ['--port', '3000'])

console.log(`Started profiling process ${pid}`)

// Toggle profiling programmatically
toggleProfiler()

// Generate flamegraph from pprof file
await generateFlamegraph('profile.pb.gz', 'flamegraph.html')

// Parse profile data
const profile = await parseProfile('profile.pb')
```

## How It Works

1. **Preload Script**: The package includes a preload script that uses `@datadog/pprof` to enable CPU profiling
2. **Signal Handling**: Profiling is controlled via `SIGUSR2` signals - first signal starts profiling, second signal stops and saves
3. **Profile Generation**: Profiles are saved as Protocol Buffer files with timestamps
4. **Visualization**: The `@platformatic/react-pprof` library generates interactive HTML flamegraphs

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

```bash
# Profile the Express app
flame run server.js

# In another terminal, make some requests
curl http://localhost:3000

# Toggle profiling to capture the request handling
flame toggle

# Make more requests
curl http://localhost:3000
curl http://localhost:3000

# Stop profiling
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