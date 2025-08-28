#!/usr/bin/env node

/**
 * Express.js Benchmark Application for Flame Profiling Overhead Testing
 * 
 * This application provides multiple endpoints with different computational loads
 * to measure the overhead introduced by the flame profiling solution.
 * 
 * Usage:
 *   Without profiling: node express-benchmark-app.js
 *   With profiling:    flame run express-benchmark-app.js
 * 
 * The goal is to compare performance metrics (requests/sec, latency, CPU usage)
 * between profiled and non-profiled runs to quantify profiling overhead.
 */

const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const compression = require('compression')
const morgan = require('morgan')

// Configuration
const config = {
  port: process.env.PORT || 3000,
  host: process.env.HOST || 'localhost',
  logLevel: process.env.LOG_LEVEL || 'combined'
}

// Create Express application
const app = express()

// Middleware setup for realistic application overhead
app.use(helmet()) // Security headers
app.use(cors()) // Cross-origin resource sharing
app.use(compression()) // Response compression
app.use(morgan(config.logLevel)) // HTTP request logging
app.use(express.json({ limit: '10mb' })) // JSON parsing
app.use(express.urlencoded({ extended: true, limit: '10mb' })) // URL-encoded parsing

/**
 * CPU-intensive computation functions
 * Using simple for loops with array operations for realistic CPU work
 */

/**
 * Light computational load - ~1000 iterations
 * Simulates basic data processing operations
 */
function lightComputation() {
  const startTime = process.hrtime.bigint()
  const data = []
  
  // Simple array operations with 1000 iterations
  for (let i = 0; i < 1000; i++) {
    data.push({
      id: i,
      value: Math.sqrt(i * 2.5),
      timestamp: Date.now()
    })
  }
  
  // Basic data manipulation
  const sum = data.reduce((acc, item) => acc + item.value, 0)
  const average = sum / data.length
  
  const endTime = process.hrtime.bigint()
  const executionTime = Number(endTime - startTime) / 1000000 // Convert to milliseconds
  
  return {
    type: 'light',
    iterations: 1000,
    dataPoints: data.length,
    sum: Math.round(sum * 100) / 100,
    average: Math.round(average * 100) / 100,
    executionTimeMs: Math.round(executionTime * 100) / 100,
    timestamp: new Date().toISOString()
  }
}

/**
 * Medium computational load - ~50000 iterations
 * Simulates moderate data processing with string operations
 */
function mediumComputation() {
  const startTime = process.hrtime.bigint()
  const data = []
  const strings = []
  
  // More intensive operations with 50000 iterations
  for (let i = 0; i < 50000; i++) {
    const value = Math.pow(i, 1.5) + Math.sin(i / 1000)
    data.push({
      id: i,
      value: value,
      squared: value * value,
      stringified: `item_${i}_${Math.floor(value)}`
    })
    
    // String operations for additional CPU load
    strings.push(data[i].stringified.toUpperCase().split('_').join('-'))
  }
  
  // Data aggregation operations
  const sum = data.reduce((acc, item) => acc + item.value, 0)
  const squaredSum = data.reduce((acc, item) => acc + item.squared, 0)
  const stringLength = strings.reduce((acc, str) => acc + str.length, 0)
  
  const endTime = process.hrtime.bigint()
  const executionTime = Number(endTime - startTime) / 1000000
  
  return {
    type: 'medium',
    iterations: 50000,
    dataPoints: data.length,
    sum: Math.round(sum * 100) / 100,
    squaredSum: Math.round(squaredSum * 100) / 100,
    avgStringLength: Math.round((stringLength / strings.length) * 100) / 100,
    executionTimeMs: Math.round(executionTime * 100) / 100,
    timestamp: new Date().toISOString()
  }
}

/**
 * Heavy computational load - ~500000 iterations
 * Simulates intensive data processing with complex operations
 */
function heavyComputation() {
  const startTime = process.hrtime.bigint()
  const results = {
    primes: [],
    squares: [],
    stats: {}
  }
  
  let sum = 0
  let primeCount = 0
  
  // Intensive computation with 500000 iterations
  for (let i = 2; i < 500000; i++) {
    const value = i * 1.1 + Math.cos(i / 10000)
    sum += value
    
    // Simple prime check for additional CPU work (every 1000th number)
    if (i % 1000 === 0) {
      let isPrime = true
      const limit = Math.sqrt(i)
      for (let j = 2; j <= limit; j++) {
        if (i % j === 0) {
          isPrime = false
          break
        }
      }
      if (isPrime) {
        results.primes.push(i)
        primeCount++
      }
    }
    
    // Store squares for numbers divisible by 10000
    if (i % 10000 === 0) {
      results.squares.push({
        number: i,
        square: i * i,
        cube: i * i * i
      })
    }
  }
  
  results.stats = {
    totalSum: Math.round(sum * 100) / 100,
    average: Math.round((sum / 499998) * 100) / 100, // 500000 - 2 (starting from 2)
    primeCount: primeCount,
    squareCount: results.squares.length
  }
  
  const endTime = process.hrtime.bigint()
  const executionTime = Number(endTime - startTime) / 1000000
  
  return {
    type: 'heavy',
    iterations: 499998,
    stats: results.stats,
    samplePrimes: results.primes.slice(0, 10), // First 10 primes found
    sampleSquares: results.squares.slice(0, 5), // First 5 squares
    executionTimeMs: Math.round(executionTime * 100) / 100,
    timestamp: new Date().toISOString()
  }
}

/**
 * API Endpoints
 */

// Health check endpoint - minimal overhead
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    pid: process.pid,
    timestamp: new Date().toISOString()
  })
})

// Light computational load endpoint
app.get('/light', (req, res) => {
  try {
    const result = lightComputation()
    res.json({
      success: true,
      computation: result,
      message: 'Light computation completed successfully'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Light computation failed',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// Medium computational load endpoint
app.get('/medium', (req, res) => {
  try {
    const result = mediumComputation()
    res.json({
      success: true,
      computation: result,
      message: 'Medium computation completed successfully'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Medium computation failed',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// Heavy computational load endpoint
app.get('/heavy', (req, res) => {
  try {
    const result = heavyComputation()
    res.json({
      success: true,
      computation: result,
      message: 'Heavy computation completed successfully'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Heavy computation failed',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// Mixed load endpoint - combines all three computation types
app.get('/mixed', (req, res) => {
  try {
    const results = {
      light: lightComputation(),
      medium: mediumComputation(),
      heavy: heavyComputation()
    }
    
    const totalExecutionTime = results.light.executionTimeMs + 
                              results.medium.executionTimeMs + 
                              results.heavy.executionTimeMs
    
    res.json({
      success: true,
      computations: results,
      summary: {
        totalExecutionTimeMs: Math.round(totalExecutionTime * 100) / 100,
        totalIterations: results.light.iterations + 
                        results.medium.iterations + 
                        results.heavy.iterations
      },
      message: 'Mixed computation completed successfully'
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Mixed computation failed',
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// Batch endpoint - runs multiple operations of the same type
app.get('/batch/:type/:count?', (req, res) => {
  const { type, count = 5 } = req.params
  const batchCount = Math.min(Math.max(parseInt(count), 1), 20) // Limit between 1-20
  
  try {
    let computationFunction
    switch (type) {
      case 'light':
        computationFunction = lightComputation
        break
      case 'medium':
        computationFunction = mediumComputation
        break
      case 'heavy':
        computationFunction = heavyComputation
        break
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid computation type',
          validTypes: ['light', 'medium', 'heavy'],
          timestamp: new Date().toISOString()
        })
    }
    
    const startTime = process.hrtime.bigint()
    const results = []
    
    for (let i = 0; i < batchCount; i++) {
      results.push(computationFunction())
    }
    
    const endTime = process.hrtime.bigint()
    const totalExecutionTime = Number(endTime - startTime) / 1000000
    
    res.json({
      success: true,
      batchType: type,
      batchCount: batchCount,
      results: results,
      summary: {
        totalBatchTimeMs: Math.round(totalExecutionTime * 100) / 100,
        avgExecutionTimeMs: Math.round((totalExecutionTime / batchCount) * 100) / 100,
        totalIterations: results.reduce((acc, r) => acc + r.iterations, 0)
      },
      message: `Batch ${type} computation completed successfully`
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: `Batch ${type} computation failed`,
      message: error.message,
      timestamp: new Date().toISOString()
    })
  }
})

// Root endpoint - provides API documentation
app.get('/', (req, res) => {
  res.json({
    name: 'Express.js Flame Profiling Benchmark App',
    version: '1.0.0',
    description: 'Benchmark application for testing flame profiling overhead',
    endpoints: {
      'GET /': 'This documentation',
      'GET /health': 'Health check (minimal computation)',
      'GET /light': 'Light computational load (~1,000 iterations)',
      'GET /medium': 'Medium computational load (~50,000 iterations)',
      'GET /heavy': 'Heavy computational load (~500,000 iterations)',
      'GET /mixed': 'Mixed load (combines all three computation types)',
      'GET /batch/:type/:count': 'Batch processing (type: light|medium|heavy, count: 1-20)'
    },
    benchmarkInfo: {
      purpose: 'Measure overhead introduced by flame profiling',
      usage: [
        'Without profiling: node express-benchmark-app.js',
        'With profiling: flame run express-benchmark-app.js'
      ],
      metrics: 'Compare requests/sec, latency, CPU usage between profiled and non-profiled runs'
    },
    server: {
      pid: process.pid,
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform
    },
    timestamp: new Date().toISOString()
  })
})

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  })
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method,
    availableEndpoints: ['/', '/health', '/light', '/medium', '/heavy', '/mixed', '/batch/:type/:count'],
    timestamp: new Date().toISOString()
  })
})

// Start server
const server = app.listen(config.port, config.host, () => {
  console.log(`🔥 Express Benchmark Server running on http://${config.host}:${config.port}`)
  console.log(`📊 PID: ${process.pid}`)
  console.log(`🚀 Node.js version: ${process.version}`)
  console.log(`💻 Platform: ${process.platform}`)
  console.log('')
  console.log('📋 Available endpoints:')
  console.log(`   GET  /           - API documentation`)
  console.log(`   GET  /health     - Health check (minimal load)`)
  console.log(`   GET  /light      - Light computation (~1K iterations)`)
  console.log(`   GET  /medium     - Medium computation (~50K iterations)`)
  console.log(`   GET  /heavy      - Heavy computation (~500K iterations)`)
  console.log(`   GET  /mixed      - Mixed computation (all types)`)
  console.log(`   GET  /batch/:type/:count - Batch processing`)
  console.log('')
  console.log('🔬 Benchmarking Instructions:')
  console.log('   Without profiling: node express-benchmark-app.js')
  console.log('   With profiling:    flame run express-benchmark-app.js')
  console.log('')
  console.log('📈 Use load testing tools like autocannon, wrk, or ab to measure overhead:')
  console.log(`   autocannon http://${config.host}:${config.port}/light`)
  console.log(`   autocannon http://${config.host}:${config.port}/medium`)
  console.log(`   autocannon http://${config.host}:${config.port}/heavy`)
})

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...')
  server.close(() => {
    console.log('✅ Server closed')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...')
  server.close(() => {
    console.log('✅ Server closed')
    process.exit(0)
  })
})

// Export for testing
module.exports = { app, server, config }