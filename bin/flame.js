#!/usr/bin/env node

const { parseArgs } = require('node:util')
const fs = require('fs')
const path = require('path')
const { startProfiling, generateFlamegraph } = require('../lib/index.js')

const { values: args, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    output: {
      type: 'string',
      short: 'o'
    },
    profile: {
      type: 'string',
      short: 'p'
    },
    help: {
      type: 'boolean',
      short: 'h'
    },
    version: {
      type: 'boolean',
      short: 'v'
    },
    manual: {
      type: 'boolean',
      short: 'm'
    },
    'node-options': {
      type: 'string'
    }
  },
  allowPositionals: true
})

if (args.version) {
  const pkg = require('../package.json')
  console.log(pkg.version)
  process.exit(0)
}

if (args.help) {
  console.log(`
Usage: flame [options] <command>

Commands:
  run <script>           Run a script with profiling enabled
  generate <pprof-file>  Generate HTML flamegraph from pprof file

Options:
  -o, --output <file>     Output HTML file (for generate command)
  -p, --profile <file>    Profile file to use (for run command)
  -m, --manual           Manual profiling mode (require SIGUSR2 to start)
      --node-options <options>  Node.js CLI options to pass to the profiled process
  -h, --help             Show this help message
  -v, --version          Show version number

Examples:
  flame run server.js                                      # Auto-start profiling
  flame run -m server.js                                   # Manual profiling (send SIGUSR2 to start)
  flame run --node-options="--require ts-node/register" server.ts     # With Node.js options
  flame run --node-options="--import ./loader.js --max-old-space-size=4096" server.js
  flame generate profile.pb.gz
  flame generate -o flamegraph.html profile.pb.gz
`)
  process.exit(0)
}

const command = positionals[0]

if (!command) {
  console.error('Error: No command specified. Use --help for usage information.')
  process.exit(1)
}

async function main () {
  try {
    switch (command) {
      case 'run': {
        const script = positionals[1]
        if (!script) {
          console.error('Error: No script specified for run command')
          process.exit(1)
        }

        if (!fs.existsSync(script)) {
          console.error(`Error: Script '${script}' not found`)
          process.exit(1)
        }

        const scriptArgs = positionals.slice(2)
        const autoStart = !args.manual
        const nodeOptions = args['node-options'] ? args['node-options'].split(' ').filter(opt => opt.length > 0) : []
        const { pid, process: childProcess } = startProfiling(script, scriptArgs, { autoStart, nodeOptions })

        console.log(`🔥 Started profiling process ${pid}`)
        if (autoStart) {
          console.log('🔥 CPU profiling is active and will generate profile on exit')
          console.log('🔥 Profile (.pb) and interactive HTML flamegraph will be auto-generated')
          console.log('🔥 Generated files will be saved in the current directory')
          console.log('Send SIGUSR2 to manually toggle profiling:')
        } else {
          console.log('📋 Manual profiling mode - send SIGUSR2 to start profiling:')
        }
        console.log(`  kill -USR2 ${pid}`)
        console.log('Press CTRL-C to stop profiling and exit')

        // Handle CTRL-C gracefully
        process.on('SIGINT', () => {
          console.log('\n🔥 Stopping flame profiler...')
          childProcess.kill('SIGTERM')
          // Give more time for HTML generation to complete
          setTimeout(() => {
            childProcess.kill('SIGKILL')
            process.exit(0)
          }, 5000) // Increased from 1000ms to 5000ms
        })

        // Exit when child process exits
        childProcess.on('close', (code) => {
          console.log(`\n🔥 Profiled process exited with code ${code}`)
          process.exit(code)
        })

        break
      }

      case 'generate': {
        const pprofFile = positionals[1]
        if (!pprofFile) {
          console.error('Error: No pprof file specified for generate command')
          process.exit(1)
        }

        if (!fs.existsSync(pprofFile)) {
          console.error(`Error: File '${pprofFile}' not found`)
          process.exit(1)
        }

        const outputFile = args.output || `${path.basename(pprofFile, path.extname(pprofFile))}.html`

        console.log(`Generating flamegraph from ${pprofFile}...`)
        const result = await generateFlamegraph(pprofFile, outputFile)
        console.log(`Flamegraph generated: ${outputFile}`)
        console.log(result.stdout)
        break
      }

      case 'toggle': {
        if (process.platform !== 'win32') {
          // Unix-like systems: Find running flame processes and send SIGUSR2
          const { spawn } = require('child_process')

          const ps = spawn('ps', ['aux'])
          let output = ''

          ps.stdout.on('data', (data) => {
            output += data.toString()
          })

          ps.on('close', (code) => {
            if (code !== 0) {
              console.error('Error: Could not list processes')
              process.exit(1)
            }

            const lines = output.split('\n')
            const flameProcesses = lines.filter(line =>
              line.includes('preload.js') || line.includes('flame run')
            )

            if (flameProcesses.length === 0) {
              console.error('No running flame processes found')
              process.exit(1)
            }

            flameProcesses.forEach(line => {
              const parts = line.trim().split(/\s+/)
              const pid = parts[1]
              if (pid && !isNaN(pid)) {
                console.log(`Toggling profiler for process ${pid}`)
                process.kill(parseInt(pid), 'SIGUSR2')
              }
            })
          })
        } else {
          // Windows: Use tasklist to find processes
          const { spawn } = require('child_process')

          const tasklist = spawn('tasklist', ['/fi', 'IMAGENAME eq node.exe', '/fo', 'csv'])
          let output = ''

          tasklist.stdout.on('data', (data) => {
            output += data.toString()
          })

          tasklist.on('close', (code) => {
            if (code !== 0) {
              console.error('Error: Could not list processes')
              process.exit(1)
            }

            const lines = output.split('\n')
            const processes = []

            for (let i = 1; i < lines.length; i++) {
              if (lines[i].trim()) {
                const parts = lines[i].split(',')
                if (parts.length >= 2) {
                  const pid = parts[1].replace(/"/g, '')
                  processes.push(pid)
                }
              }
            }

            if (processes.length === 0) {
              console.error('No running Node.js processes found')
              process.exit(1)
            }

            console.log('Windows detected: Direct signal toggle not supported.')
            console.log('Available Node.js processes:')
            processes.forEach(pid => {
              console.log(`  PID: ${pid}`)
            })
            console.log('Please use Ctrl-C or restart your flame application to toggle profiling.')
          })
        }
        break
      }

      default:
        console.error(`Error: Unknown command '${command}'. Use --help for usage information.`)
        process.exit(1)
    }
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}
