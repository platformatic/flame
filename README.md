# @platformatic/flame

🔥 CPU and heap profiling and flamegraph visualization tool built on top of [@platformatic/react-pprof](https://github.com/platformatic/react-pprof).

## Features

- **Dual Profiling**: Captures both CPU and heap profiles concurrently for comprehensive performance insights
- **Auto-Start Profiling**: Profiling starts immediately when using `flame run` (default behavior)
- **Automatic Flamegraph Generation**: Interactive HTML flamegraphs are created automatically for both CPU and heap profiles on exit
- **LLM-Friendly Markdown Analysis**: Generates markdown reports with hotspot analysis, ideal for AI-assisted performance debugging
- **Sourcemap Support**: Automatically translates transpiled code locations back to original source files (TypeScript, bundled JavaScript, etc.)
- **Clear File Path Display**: Shows exact paths and browser URLs for generated files
- **Manual Control**: Optional manual mode with signal-based control using `SIGUSR2`
- **Interactive Visualization**: WebGL-based HTML flamegraphs with zoom, search, and filtering
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

# The application runs with CPU and heap profiling active
# When you stop the app (Ctrl-C or normal exit), you'll see:
# 🔥 CPU profile written to: cpu-profile-2025-08-27T12-00-00-000Z.pb
# 🔥 Heap profile written to: heap-profile-2025-08-27T12-00-00-000Z.pb
# 🔥 Generating CPU flamegraph...
# 🔥 CPU flamegraph generated: cpu-profile-2025-08-27T12-00-00-000Z.html
# 🔥 CPU markdown generated: cpu-profile-2025-08-27T12-00-00-000Z.md
# 🔥 Generating heap flamegraph...
# 🔥 Heap flamegraph generated: heap-profile-2025-08-27T12-00-00-000Z.html
# 🔥 Heap markdown generated: heap-profile-2025-08-27T12-00-00-000Z.md
# 🔥 Open file:///path/to/cpu-profile-2025-08-27T12-00-00-000Z.html in your browser to view the CPU flamegraph
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

### Generate Flamegraph and Markdown

```bash
# Generate HTML flamegraph and markdown from pprof file
flame generate cpu-profile-2024-01-01T12-00-00-000Z.pb

# Specify custom output file
flame generate -o my-flamegraph.html profile.pb.gz

# Use detailed markdown format for comprehensive analysis
flame generate --md-format=detailed profile.pb
```

## CLI Usage

```bash
flame [options] <command>

Commands:
  run <script>           Run a script with profiling enabled
  generate <pprof-file>  Generate HTML flamegraph and markdown from pprof file
  toggle                 Toggle profiling for running flame processes

Options:
  -o, --output <file>       Output HTML file (for generate command)
  -m, --manual             Manual profiling mode (require SIGUSR2 to start)
  -d, --delay <value>      Delay before starting profiler (ms, 'none', or 'until-started')
  -s, --sourcemap-dirs <dirs>  Directories to search for sourcemaps (colon/semicolon-separated)
      --md-format <format>  Markdown format: summary (default), detailed, or adaptive
      --node-options <options>  Node.js CLI options to pass to the profiled process
      --deopt              Track V8 deoptimizations and show them on the CPU flamegraph
  -h, --help               Show help message
  -v, --version            Show version number
```

## Programmatic API

```javascript
const { startProfiling, generateFlamegraph, generateMarkdown, parseProfile } = require('@platformatic/flame')

// Start profiling a script with auto-start (default)
const { pid, toggleProfiler } = startProfiling('server.js', ['--port', '3000'], { autoStart: true })

// Or start in manual mode
const { pid, toggleProfiler } = startProfiling('server.js', ['--port', '3000'], { autoStart: false })

// Track V8 deoptimizations while profiling
startProfiling('server.js', [], { autoStart: true, deopt: true })

console.log(`Started profiling process ${pid}`)

// Toggle profiling programmatically (useful in manual mode)
toggleProfiler()

// Generate interactive flamegraph from pprof file
await generateFlamegraph('profile.pb.gz', 'flamegraph.html')

// Generate LLM-friendly markdown analysis
await generateMarkdown('profile.pb', 'analysis.md', { format: 'summary' })

// Parse profile data
const profile = await parseProfile('profile.pb')
```

## How It Works

1. **Auto-Start Mode (Default)**: Both CPU and heap profiling begin immediately when `flame run` starts your script
2. **Auto-Generation on Exit**: Profile (.pb) files, interactive HTML flamegraphs, and markdown analysis files are automatically created for both CPU and heap profiles when the process exits
3. **Manual Mode**: Use `--manual` flag to require `SIGUSR2` signals for start/stop control (no auto-HTML generation)
4. **Interactive Visualization**: The `@platformatic/react-pprof` library generates interactive WebGL-based HTML flamegraphs for both profile types
5. **Markdown Analysis**: The `pprof-to-md` library generates LLM-friendly markdown reports with hotspot tables for AI-assisted debugging

## V8 Deoptimizations

```bash
flame run --deopt server.js
```

With `--deopt`, flame records the V8 deoptimizations that happen while the
CPU profiler runs and stores them in the CPU profile. The flamegraph then:

- marks frames that had actionable deopts (a bar along the bottom edge and a
  triangle in the top-right corner)
- shows the deopt count and the most frequent reasons in the hover tooltip
- lists every deopt of the selected frame in the details panel, with its source
  position and an explanation of the reason
- adds a **Highlight Deopts** checkbox to turn the markers off

The markdown report gets a **V8 Deoptimizations** section listing the functions
with actionable deopts, their share of the profile and an explanation of each
reason. Deopts that are part of V8's normal tiering (on-stack replacement,
insufficient type feedback) are counted but not highlighted. A deopt is not a
bug by itself: it matters when it repeats in a function that takes a large
share of the profile.

Explanations come from a catalog of V8's deopt reasons shipped with
`react-pprof`, derived from
[deoptigate's deoptimization guide](https://github.com/Uzlopak/deoptigate/blob/59e854d5cabfe2f9698246c985ad21f3a820b0b8/assets/deoptimization.md).

### How it works

V8 does not reliably write deopt records to its `--log-deopt` log while a CPU
profile is being recorded, so flame reads V8's deopt traces instead: the process starts
with `--trace-deopt-verbose` writing to a temporary file
(`--redirect-code-traces-to`), and the preload turns tracing off right away and
back on only while the profiler runs, including windows started with `SIGUSR2`.
At the end of each window the new traces are parsed, matched to the functions
in the profile, and stored as a JSON comment in the `.pb` file, so
`flame generate` shows them too.

### Notes

- Deopts that happen before profiling starts (for example during startup with
  the default `--delay=until-started`) are not recorded; use `--delay=none` to
  include them.
- Verbose deopt traces include the deoptimized frames, so programs that
  deoptimize a lot write a large temporary file; it is removed when the process
  exits.
- Worker threads are traced too, but their deopts are only matched to functions
  that appear in the main thread's CPU profile.

## Sourcemap Support

When profiling transpiled or bundled applications (TypeScript, Webpack, ESBuild, etc.), the flame tool can automatically translate stack traces from generated code back to your original source files using sourcemaps.

### Usage

```bash
# Profile a TypeScript application with sourcemap support
flame run --sourcemap-dirs=dist server.js

# Search multiple directories (colon or semicolon separated)
flame run --sourcemap-dirs=dist:build:out server.js
```

### How It Works

1. The tool searches specified directories for `.map`, `.js.map`, `.cjs.map`, and `.mjs.map` files
2. During profiling, stack frame locations are automatically translated from generated code to source locations
3. The resulting flamegraph shows your original source file paths and line numbers

### Programmatic API

```javascript
const { startProfiling } = require('@platformatic/flame')

startProfiling('dist/server.js', [], {
  autoStart: true,
  sourcemapDirs: ['dist', 'build']  // Can be a string or array
})
```

### Environment Variables

Sourcemap support can also be controlled via environment variables:

```bash
# Specify directories (colon/semicolon separated)
export FLAME_SOURCEMAP_DIRS="dist:build"

# Then run normally
flame run server.js
```

### Notes

- Sourcemaps are loaded at startup and applied during profile capture
- The tool excludes `node_modules` directories when searching
- If a sourcemap cannot be found or fails to parse, the original generated location is preserved
- Both CPU and heap profiles benefit from sourcemap translation

## Profile Files

Profile files are saved with timestamps in the format:
```
cpu-profile-2024-01-01T12-00-00-000Z.pb     # Binary pprof data
cpu-profile-2024-01-01T12-00-00-000Z.html   # Interactive flamegraph
cpu-profile-2024-01-01T12-00-00-000Z.md     # LLM-friendly markdown analysis
heap-profile-2024-01-01T12-00-00-000Z.pb
heap-profile-2024-01-01T12-00-00-000Z.html
heap-profile-2024-01-01T12-00-00-000Z.md
```

Both CPU and heap profiles share the same timestamp for easy correlation. The `.pb` files are compressed Protocol Buffer format compatible with the pprof ecosystem. The `.md` files contain hotspot analysis tables suitable for AI/LLM-assisted performance debugging.

### Markdown Formats

The `--md-format` option controls the markdown output:

- **summary** (default): Compact hotspots table, ideal for AI triage and quick overview
- **detailed**: Comprehensive analysis with full stack traces and detailed statistics
- **adaptive**: Automatically chooses format based on profile complexity

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

# Stop the server (Ctrl-C) to automatically save profiles and generate flamegraphs
# You'll see the exact file paths and browser URLs in the output:
# 🔥 CPU profile written to: cpu-profile-2025-08-27T15-30-45-123Z.pb
# 🔥 Heap profile written to: heap-profile-2025-08-27T15-30-45-123Z.pb
# 🔥 CPU flamegraph generated: cpu-profile-2025-08-27T15-30-45-123Z.html
# 🔥 CPU markdown generated: cpu-profile-2025-08-27T15-30-45-123Z.md
# 🔥 Heap flamegraph generated: heap-profile-2025-08-27T15-30-45-123Z.html
# 🔥 Heap markdown generated: heap-profile-2025-08-27T15-30-45-123Z.md
# 🔥 Open file:///path/to/cpu-profile-2025-08-27T15-30-45-123Z.html in your browser to view the CPU flamegraph
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

### Example Applications

Two comprehensive benchmark applications are included for testing profiling overhead and feature Express.js middlewares and Fastify plugins with realistic computation endpoints.

#### Running Benchmark Apps
```bash
# Run individual apps without profiling
node examples/express-benchmark-app.js
node examples/fastify-benchmark-app.js

# Run comprehensive performance overhead analysis
node examples/run-performance-benchmark.js
```

Both apps include:
- Health check endpoint (no computation)
- Light computation endpoint (~1k iterations)
- Medium computation endpoint (~10k iterations)
- Heavy computation endpoint (~100k iterations)
- Multiple middleware layers for realistic overhead testing
- Comprehensive test suites

#### Performance Overhead Results

Based on comprehensive benchmarks with 10 concurrent connections over 10 seconds per endpoint:

**Express.js Framework:**
| Endpoint | Load Level | Without Profiling | With Profiling | Throughput Overhead | Latency Overhead |
|----------|------------|-------------------|----------------|--------------------|--------------------|
| Health Check | Minimal | 13,571 req/s | 13,752 req/s | -1.3% | -6.3% |
| Light Computation | Low | 10,187 req/s | 9,979 req/s | +2.0% | +12.0% |
| Medium Computation | Moderate | 71 req/s | 66 req/s | +6.1% | +6.3% |
| Heavy Computation | High | 295 req/s | 291 req/s | +1.3% | +1.4% |
| Mixed Computation | Very High | 56 req/s | 53 req/s | +5.2% | +5.8% |

**Express Summary:** Average throughput overhead of **2.7%** and latency overhead of **3.9%**

**Fastify Framework:**
| Endpoint | Load Level | Without Profiling | With Profiling | Throughput Overhead | Latency Overhead |
|----------|------------|-------------------|----------------|--------------------|--------------------|
| Health Check | Minimal | 41,174 req/s | 38,747 req/s | +5.9% | 0.0% |
| Light Computation | Low | 35,056 req/s | 32,847 req/s | +6.3% | 0.0% |
| Medium Computation | Moderate | 3,235 req/s | 3,126 req/s | +3.4% | +4.2% |
| Heavy Computation | High | 345 req/s | 336 req/s | +2.6% | +2.6% |
| Mixed Computation | Very High | 311 req/s | 304 req/s | +2.3% | +2.3% |

**Fastify Summary:** Average throughput overhead of **4.1%** and latency overhead of **1.8%**

*CSV data is automatically generated when running `node examples/run-performance-benchmark.js` for further analysis.*

### Load Testing Example

You can run load tests manually:

```bash
# Terminal 1: Start the test server with profiling
flame run examples/load-test-server.js

# Terminal 2: Run load test with autocannon
npx autocannon -c 10 -d 10 http://localhost:3000

# Terminal 1: Toggle profiling (start/stop)
kill -USR2 <PID>
```

## Requirements

- Node.js >= 22.6.0
- `@datadog/pprof` for CPU and heap profiling
- `react-pprof` for flamegraph generation
- `pprof-to-md` for markdown analysis generation

## License

MIT
