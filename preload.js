'use strict'

const fs = require('fs')
const path = require('path')
const pprof = require('@datadog/pprof')
const { spawn } = require('child_process')

const cpuProfiler = pprof.time
const heapProfiler = pprof.heap
let isCpuProfilerRunning = false
let isHeapProfilerRunning = false
let sourceMapper = null
const autoStart = process.env.FLAME_AUTO_START === 'true'
const mdFormat = process.env.FLAME_MD_FORMAT || 'summary'

// Initialize sourcemap support if enabled
const sourcemapDirs = process.env.FLAME_SOURCEMAP_DIRS
const nodeModulesSourceMaps = process.env.FLAME_NODE_MODULES_SOURCE_MAPS
let sourceMapperPromise = null
let nodeModulesMapperPromise = null

// Helper: resolve module path from node_modules
function resolveModulePath (appPath, moduleName) {
  try {
    const resolved = require.resolve(moduleName, { paths: [appPath] })
    const nodeModulesIndex = resolved.lastIndexOf('node_modules')
    if (nodeModulesIndex === -1) return null

    const afterNodeModules = resolved.substring(nodeModulesIndex + 'node_modules'.length + 1)
    const parts = afterNodeModules.split(path.sep)

    if (moduleName.startsWith('@')) {
      return path.join(resolved.substring(0, nodeModulesIndex), 'node_modules', parts[0], parts[1])
    } else {
      return path.join(resolved.substring(0, nodeModulesIndex), 'node_modules', parts[0])
    }
  } catch {
    return null
  }
}

// Helper: walk directory for .map files
async function * walkForMapFiles (dir) {
  const fsPromises = require('fs').promises
  async function * walkRecursive (currentDir) {
    try {
      const dirHandle = await fsPromises.opendir(currentDir)
      for await (const entry of dirHandle) {
        const entryPath = path.join(currentDir, entry.name)
        if (entry.isDirectory() && entry.name !== '.git') {
          yield * walkRecursive(entryPath)
        } else if (entry.isFile() && /\.[cm]?js\.map$/.test(entry.name)) {
          yield entryPath
        }
      }
    } catch {
      // Silently ignore permission errors
    }
  }
  yield * walkRecursive(dir)
}

// Helper: process sourcemap file
async function processSourceMapFile (mapPath) {
  try {
    const fsPromises = require('fs').promises
    const sourceMap = require('source-map')

    const contents = await fsPromises.readFile(mapPath, 'utf8')
    const consumer = await new sourceMap.SourceMapConsumer(contents)

    const dir = path.dirname(mapPath)
    const generatedPathCandidates = []

    if (consumer.file) {
      generatedPathCandidates.push(path.resolve(dir, consumer.file))
    }
    generatedPathCandidates.push(path.resolve(dir, path.basename(mapPath, '.map')))

    for (const generatedPath of generatedPathCandidates) {
      try {
        await fsPromises.access(generatedPath)
        return {
          generatedPath,
          info: { mapFileDir: dir, mapConsumer: consumer }
        }
      } catch {}
    }
    return null
  } catch {
    return null
  }
}

// Load sourcemaps from node_modules packages
async function loadNodeModulesSourceMaps (moduleNames, debug = false) {
  const entries = new Map()

  for (const moduleName of moduleNames) {
    const modulePath = resolveModulePath(process.cwd(), moduleName)
    if (!modulePath) {
      if (debug) {
        console.warn(`⚠️  Could not resolve module: ${moduleName}`)
      }
      continue
    }

    if (debug) {
      console.log(`🗺️  Scanning ${moduleName} for sourcemaps...`)
    }

    let mapCount = 0
    for await (const mapFile of walkForMapFiles(modulePath)) {
      const entry = await processSourceMapFile(mapFile)
      if (entry) {
        entries.set(entry.generatedPath, entry.info)
        mapCount++
      }
    }

    if (debug) {
      console.log(`🗺️  Loaded ${mapCount} sourcemaps from ${moduleName}`)
    }
  }

  return entries
}

// Start loading node_modules sourcemaps if configured
if (nodeModulesSourceMaps) {
  const mods = nodeModulesSourceMaps.split(',').filter(m => m.trim())

  if (mods.length > 0) {
    console.log(`🗺️  Loading sourcemaps from node_modules: ${mods.join(', ')}`)

    nodeModulesMapperPromise = loadNodeModulesSourceMaps(mods, false)
      .then(entries => {
        console.log(`🗺️  Loaded ${entries.size} sourcemaps from node_modules`)
        return entries
      })
      .catch(error => {
        console.error('⚠️  Warning: Failed to load node_modules sourcemaps:', error.message)
        return new Map()
      })
  }
}

// Parse sourcemap directories
const dirs = sourcemapDirs
  ? sourcemapDirs.split(path.delimiter).filter(d => d.trim())
  : []

// Initialize sourcemaps if we have either dirs or node_modules sourcemaps
if (dirs.length > 0 || nodeModulesMapperPromise) {
  const { SourceMapper } = require('@datadog/pprof/out/src/sourcemapper/sourcemapper')
  const sourceMap = require('source-map')

  if (dirs.length > 0) {
    console.log(`🗺️  Initializing sourcemap support for directories: ${dirs.join(', ')}`)
  }

  sourceMapperPromise = (async () => {
    try {
      // Create SourceMapper from dirs if provided, otherwise create empty one
      const mapper = dirs.length > 0
        ? await SourceMapper.create(dirs)
        : new SourceMapper(false)

      // Merge node_modules sourcemaps if available
      if (nodeModulesMapperPromise) {
        const nodeModulesEntries = await nodeModulesMapperPromise
        for (const [generatedPath, info] of nodeModulesEntries) {
          mapper.infoMap.set(generatedPath, info)
        }
      }

      // Helper to extract function name from source line
      // Matches: function name(, async function name(, name = function(, name: function(, etc.
      function extractFunctionName (sourceLine) {
        if (!sourceLine) return null
        // Match function declarations: function name( or async function name(
        const funcMatch = sourceLine.match(/(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/)
        if (funcMatch) return funcMatch[1]
        // Match arrow functions or method definitions: name = ( or name: ( or name(
        const arrowMatch = sourceLine.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[=:]\s*(?:async\s*)?\(/)
        if (arrowMatch) return arrowMatch[1]
        // Match method shorthand: name( in object/class
        const methodMatch = sourceLine.match(/^\s*(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/)
        if (methodMatch) return methodMatch[1]
        return null
      }

      // Cache for source content lines to avoid repeated parsing
      const sourceContentCache = new Map()

      // Override the mappingInfo method to use LEAST_UPPER_BOUND bias for better
      // compatibility with Turbopack and other bundlers that generate minified
      // files where mappings don't start at column 0
      mapper.mappingInfo = function (location) {
        const inputPath = path.normalize(location.file)
        const entry = this.getMappingInfo(inputPath)
        if (entry === null) {
          return location
        }

        const generatedPos = {
          line: location.line,
          column: location.column > 0 ? location.column - 1 : 0
        }

        const consumer = entry.mapConsumer

        // First try default lookup
        let pos = consumer.originalPositionFor(generatedPos)

        // If no mapping found, try with LEAST_UPPER_BOUND bias to find
        // the nearest mapping to the right (useful for Turbopack's loader code
        // that occupies the beginning of lines without mappings)
        if (pos.source === null) {
          pos = consumer.originalPositionFor({
            ...generatedPos,
            bias: sourceMap.SourceMapConsumer.LEAST_UPPER_BOUND
          })
        }

        if (pos.source === null) {
          return location
        }

        let resolvedName = pos.name || location.name

        // If no name from sourcemap, try to extract from sourcesContent
        if (!pos.name && pos.source && pos.line) {
          try {
            // Get or cache the source content lines
            let lines = sourceContentCache.get(pos.source)
            if (!lines) {
              const content = consumer.sourceContentFor(pos.source, true)
              if (content) {
                lines = content.split('\n')
                sourceContentCache.set(pos.source, lines)
              }
            }
            if (lines && lines[pos.line - 1]) {
              const extractedName = extractFunctionName(lines[pos.line - 1])
              if (extractedName) {
                resolvedName = extractedName
              }
            }
          } catch (e) {
            // Ignore errors in name extraction
          }
        }

        return {
          file: path.resolve(entry.mapFileDir, pos.source),
          line: pos.line || undefined,
          name: resolvedName,
          column: pos.column === null ? undefined : pos.column + 1
        }
      }

      sourceMapper = mapper
      console.log('🗺️  Sourcemap initialization complete')
      return mapper
    } catch (error) {
      console.error('⚠️  Warning: Failed to initialize sourcemaps:', error.message)
      return null
    }
  })()
}

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

async function generateMarkdown (pprofPath, outputPath, format = 'summary') {
  const { convert } = await import('pprof-to-md')
  const markdown = convert(pprofPath, {
    format,
    profileName: path.basename(pprofPath)
  })
  fs.writeFileSync(outputPath, markdown)
  return { outputPath }
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
      if (sourceMapper) {
        console.log('🗺️  Profile includes sourcemap translations')
      }
      filenames.push(cpuFilename)
      isCpuProfilerRunning = false
    }

    if (isHeapProfilerRunning) {
      const heapProfileData = heapProfiler.profile(undefined, sourceMapper)
      heapProfiler.stop()
      const heapProfile = heapProfileData.encode()
      const heapFilename = `heap-profile-${timestamp}.pb`
      fs.writeFileSync(heapFilename, heapProfile)
      console.log(`🔥 Heap profile written to: ${heapFilename}`)
      if (sourceMapper) {
        console.log('🗺️  Profile includes sourcemap translations')
      }
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
      if (sourceMapper) {
        console.log('🗺️  Profile includes sourcemap translations')
      }
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

        // Generate markdown analysis
        const mdFilename = cpuFilename.replace('.pb', '.md')
        console.log('🔥 Generating CPU markdown analysis...')
        try {
          await generateMarkdown(cpuFilename, mdFilename, mdFormat)
          console.log(`🔥 CPU markdown generated: ${mdFilename}`)
        } catch (error) {
          console.error('Warning: Failed to generate CPU markdown:', error.message)
        }
      }
    }

    if (isHeapProfilerRunning) {
      const heapProfileData = heapProfiler.profile(undefined, sourceMapper)
      heapProfiler.stop()
      const heapProfile = heapProfileData.encode()
      const heapFilename = `heap-profile-${timestamp}.pb`
      fs.writeFileSync(heapFilename, heapProfile)
      console.log(`🔥 Heap profile written to: ${heapFilename}`)
      if (sourceMapper) {
        console.log('🗺️  Profile includes sourcemap translations')
      }
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

        // Generate markdown analysis
        const mdFilename = heapFilename.replace('.pb', '.md')
        console.log('🔥 Generating heap markdown analysis...')
        try {
          await generateMarkdown(heapFilename, mdFilename, mdFormat)
          console.log(`🔥 Heap markdown generated: ${mdFilename}`)
        } catch (error) {
          console.error('Warning: Failed to generate heap markdown:', error.message)
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

    // Generate markdown analysis
    const mdFilename = filename.replace('.pb', '.md')
    console.log(`🔥 Generating ${profileType} markdown analysis...`)
    generateMarkdown(filename, mdFilename, mdFormat)
      .then(() => {
        console.log(`🔥 ${profileType} markdown generated: ${mdFilename}`)
      })
      .catch(error => {
        console.error(`Warning: Failed to generate ${profileType} markdown:`, error.message)
      })
  })
}

function toggleProfiler () {
  if (!isCpuProfilerRunning && !isHeapProfilerRunning) {
    console.log('Starting CPU and heap profilers...')
    // Start CPU profiler with sourcemap support if available
    const cpuProfilerOptions = sourceMapper ? { sourceMapper } : undefined
    cpuProfiler.start(cpuProfilerOptions)
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
  // Parse delay option
  const delayValue = process.env.FLAME_DELAY || 'until-started'

  async function startProfiling () {
    // Wait for sourcemaps to be initialized before starting profiling
    if (sourceMapperPromise) {
      await sourceMapperPromise
    }
    console.log('🔥 Auto-starting CPU and heap profilers...')
    toggleProfiler()
  }

  // Apply delay before starting profiler
  if (delayValue === 'none') {
    // No delay - start immediately
    startProfiling()
  } else if (delayValue === 'until-started') {
    // Special case: delay until next full event loop tick
    // setImmediate runs after I/O events but before timers
    // setTimeout(..., 0) then ensures we're at the start of the next event loop iteration
    setImmediate(() => {
      setTimeout(startProfiling, 0)
    })
  } else {
    // Numeric delay in milliseconds
    const delayMs = parseInt(delayValue, 10)
    if (!isNaN(delayMs) && delayMs >= 0) {
      setTimeout(startProfiling, delayMs)
    } else {
      console.error(`Invalid FLAME_DELAY value: ${delayValue}. Starting immediately.`)
      startProfiling()
    }
  }

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
