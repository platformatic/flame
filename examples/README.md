# Flame Profiling Examples

This directory contains example applications for testing and benchmarking the flame profiling solution.

## Express.js Benchmark Application

### Overview

The `express-benchmark-app.js` provides a comprehensive Express.js server with multiple endpoints designed to test different computational loads and measure the overhead introduced by flame profiling.

### Features

- **Multiple middleware**: Uses common Express.js middleware (cors, helmet, compression, morgan)
- **Various computational loads**: Light, medium, and heavy CPU-intensive operations
- **Realistic workloads**: Simple for loops with array/string operations (not artificial fibonacci)
- **Detailed timing**: Each endpoint returns execution time and iteration counts
- **Health monitoring**: Memory usage, uptime, and process information
- **Batch processing**: Test multiple operations of the same type
- **Error handling**: Comprehensive error handling and validation

### Endpoints

| Endpoint | Load Level | Iterations | Purpose |
|----------|------------|------------|---------|
| `GET /` | None | 0 | API documentation |
| `GET /health` | Minimal | 0 | Health check with system info |
| `GET /light` | Low | ~1,000 | Light computational load |
| `GET /medium` | Moderate | ~50,000 | Medium computational load |
| `GET /heavy` | High | ~500,000 | Heavy computational load |
| `GET /mixed` | Very High | ~551,000 | All three computations combined |
| `GET /batch/:type/:count` | Variable | Variable | Batch processing (1-20 operations) |

### Usage

#### Running without profiling:
```bash
node examples/express-benchmark-app.js
```

#### Running with flame profiling:
```bash
flame run examples/express-benchmark-app.js
```

#### Testing endpoints:
```bash
# Health check
curl http://localhost:3000/health

# Light computation
curl http://localhost:3000/light

# Heavy computation with timing
curl http://localhost:3000/heavy | jq '.computation.executionTimeMs'

# Batch processing (5 light computations)
curl http://localhost:3000/batch/light/5
```

### Benchmarking with Load Testing Tools

#### Using autocannon:
```bash
# Test light endpoint
autocannon -c 10 -d 10 http://localhost:3000/light

# Test heavy endpoint with fewer connections
autocannon -c 5 -d 10 http://localhost:3000/heavy

# Test multiple endpoints
autocannon -c 10 -d 10 -m GET -H "Content-Type: application/json" \
  -R 100 http://localhost:3000/light
```

#### Using wrk:
```bash
# Test medium endpoint
wrk -t 4 -c 10 -d 10s http://localhost:3000/medium

# Test with custom script
wrk -t 4 -c 10 -d 10s --script examples/wrk-script.lua http://localhost:3000/
```

## Automated Benchmark Runner

The `run-express-benchmark.js` script automatically runs performance tests both with and without profiling to measure overhead.

### Usage

```bash
node examples/run-express-benchmark.js
```

### What it does

1. **Phase 1**: Starts Express app without profiling and runs benchmarks
2. **Phase 2**: Starts Express app with flame profiling and runs the same benchmarks
3. **Comparison**: Generates a detailed report showing performance differences
4. **Profile Generation**: Creates flamegraph files for analysis

### Sample Output

```
🔥 Express.js Flame Profiling Overhead Benchmark
═══════════════════════════════════════════════════════════════

📊 PHASE 1: Testing WITHOUT flame profiling
─────────────────────────────────────────────────
🚀 Starting server WITHOUT flame profiling...
   ✅ Server started on port 3002

📈 Running benchmarks (10s each, 10 connections)...
   📊 Testing Health Check (/health)...
      Requests/sec: 8234.12
      Avg latency:  1.18ms
      P99 latency:  3.45ms

🔥 PHASE 2: Testing WITH flame profiling
─────────────────────────────────────────────────
🚀 Starting server WITH flame profiling...
   ✅ Server started on port 3002

📈 Running benchmarks (10s each, 10 connections)...
   📊 Testing Health Check (/health)...
      Requests/sec: 7891.34
      Avg latency:  1.24ms
      P99 latency:  3.78ms

🔥 FLAME PROFILING OVERHEAD REPORT
════════════════════════════════════════════════════════════════════════

Performance Comparison:
┌─────────────────────────┬─────────────────┬─────────────────┬─────────────────┐
│ Endpoint                │ Without Profile │ With Profile    │ Overhead        │
├─────────────────────────┼─────────────────┼─────────────────┼─────────────────┤
│ Health Check            │ 8234.12 req/s   │ 7891.34 req/s   │ +4.16%          │
│ Light Computation       │ 6543.21 req/s   │ 6102.89 req/s   │ +6.73%          │
│ Medium Computation      │ 234.56 req/s    │ 221.43 req/s    │ +5.59%          │
│ Heavy Computation       │ 12.34 req/s     │ 11.78 req/s     │ +4.54%          │
└─────────────────────────┴─────────────────┴─────────────────┴─────────────────┘

Summary:
  Average throughput overhead: 5.26%
  Average latency overhead:    4.82%

Generated Profile Files:
  📄 cpu-profile-2025-08-27T17-45-23-047Z.pb
  📄 cpu-profile-2025-08-27T17-45-23-047Z.html

To view the interactive flamegraph:
  🔥 open cpu-profile-2025-08-27T17-45-23-047Z.html
```

## Configuration

### Environment Variables

- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: localhost)
- `LOG_LEVEL` - Morgan logging level (default: combined)

### Benchmark Configuration

Modify the `config` object in `run-express-benchmark.js`:

```javascript
const config = {
  port: 3002,
  host: 'localhost',
  duration: 10,        // seconds per test
  connections: 10,     // concurrent connections
  pipelining: 1,       // requests per connection
  endpoints: [...]     // which endpoints to test
}
```

## Interpreting Results

### Expected Overhead

Typical flame profiling overhead should be:
- **Throughput**: 3-8% reduction in requests/second
- **Latency**: 3-8% increase in response time
- **CPU**: 5-15% additional CPU usage
- **Memory**: 10-30MB additional memory usage

### When Overhead is Concerning

Consider the overhead excessive if:
- Throughput drops by more than 15%
- Latency increases by more than 20%
- Memory usage increases by more than 100MB
- Application becomes unresponsive

### Optimization Tips

To minimize profiling overhead:
- Use profiling only in development/staging
- Profile specific endpoints rather than entire application
- Use sampling-based profiling for production
- Limit profiling duration to minimize file sizes

## Quick Start

```bash
# 1. Install dependencies (if not already installed)
npm install

# 2. Run the Express benchmark app without profiling
node examples/express-benchmark-app.js

# 3. In another terminal, test the endpoints
curl http://localhost:3000/light
curl http://localhost:3000/heavy

# 4. Stop the server (Ctrl+C) and run with profiling
flame run examples/express-benchmark-app.js

# 5. Test the same endpoints to generate profile data
curl http://localhost:3001/light
curl http://localhost:3001/heavy

# 6. Stop the server to generate flamegraph files
# Profile files will be saved as cpu-profile-*.pb and cpu-profile-*.html

# 7. Run automated benchmark comparison
node examples/run-express-benchmark.js
```

## Files

- `express-benchmark-app.js` - Main Express.js benchmark application
- `run-express-benchmark.js` - Automated benchmark runner
- `README.md` - This documentation
- `load-test-server.js` - Original basic HTTP server (legacy)
- `run-load-test.js` - Original load test runner (legacy)

## Dependencies

The Express benchmark app requires these additional packages (installed as devDependencies):

```json
{
  "express": "^4.19.2",
  "cors": "^2.8.5",
  "helmet": "^7.1.0",
  "compression": "^1.7.4",
  "morgan": "^1.10.0"
}
```

These are already included in the project's `package.json` for convenience.