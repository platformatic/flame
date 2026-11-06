'use strict'

/**
 * V8 deoptimization tracking.
 *
 * V8 drops most `code-deopt` records from its log (`--log-deopt`) while a CPU
 * profile is being recorded, so deopts are collected from V8's deopt traces
 * instead. The profiled process starts with `--trace-deopt-verbose` writing
 * to a file (`--redirect-code-traces-to`); the preload turns tracing off right
 * away and back on only while profiling. V8 opens the trace file when the
 * flag is set at startup: enabling the flag later without it prints nothing.
 *
 * At the end of the profiling window the new part of the trace file is parsed
 * and the deopts are attached to the CPU profile as a JSON comment (type
 * `v8-deopts`) that react-pprof renders on the flamegraph.
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

const PAYLOAD_TYPE = 'v8-deopts'
const PAYLOAD_VERSION = 1

/**
 * Node.js CLI arguments that open the deopt trace file
 * @param {string} dir - Directory for the trace file
 * @returns {{ args: string[], traceFile: string }}
 */
function getDeoptNodeArgs (dir) {
  const traceFile = path.join(dir, 'deopt-trace.txt')
  return {
    traceFile,
    args: [
      // Only the verbose trace includes the source position of the deopt
      '--trace-deopt-verbose',
      '--redirect-code-traces',
      `--redirect-code-traces-to=${traceFile}`
    ]
  }
}

/**
 * Create a temporary directory for the deopt trace
 * @returns {string}
 */
function createDeoptTraceDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'flame-deopt-'))
}

// [bailout (kind: deopt-eager, reason: wrong map): begin. deoptimizing 0x... <JSFunction readX (sfi = 0x...)>, 0x... <Code MAGLEV>, ...]
const BAILOUT_BEGIN = /^\[bailout \(kind: ([^,]+), reason: (.*)\): begin\. deoptimizing (?:0x[0-9a-fA-F]+ )?<JSFunction ?(.*?) \(sfi = [^)]*\)>/
// ;;; deoptimize at <file.js:5:31>  (inlined code: <inner.js:1:2> inlined at <outer.js:3:4>)
const DEOPT_POSITION = /^\s*;;; deoptimize at (.*)$/

/**
 * Parse a `script:line:column` position
 * @param {string} str
 * @returns {{ file: string, line: number, column: number } | null}
 */
function parsePosition (str) {
  const match = /^(.*):(\d+):(\d+)$/.exec(str)
  if (!match) return null
  return { file: match[1], line: Number(match[2]), column: Number(match[3]) }
}

/**
 * Get the positions of a deopt, innermost first. For inlined code the last
 * position is in the optimized function itself.
 * @param {string} str
 * @returns {Array<{ file: string, line: number, column: number }>}
 */
function parseDeoptPositions (str) {
  return [...str.matchAll(/<([^<>]*)>/g)]
    .map(match => parsePosition(match[1]))
    .filter(Boolean)
}

/**
 * Parse V8 deopt traces (`--trace-deopt-verbose` output)
 * @param {Buffer|string} trace
 * @returns {Array<{ reason: string, bailoutType: string, functionName: string, position: string }>}
 */
function parseDeoptTrace (trace) {
  const text = Buffer.isBuffer(trace) ? trace.toString('utf8') : trace
  const deopts = []
  let current = null

  for (const line of text.split('\n')) {
    if (line.startsWith('[bailout')) {
      const begin = BAILOUT_BEGIN.exec(line)
      if (begin) {
        current = {
          reason: begin[2],
          bailoutType: begin[1],
          functionName: begin[3],
          position: ''
        }
        deopts.push(current)
      } else {
        // "[bailout end. ...]"
        current = null
      }
      continue
    }

    if (current && !current.position) {
      const position = DEOPT_POSITION.exec(line)
      if (position) {
        current.position = position[1].trim()
      }
    }
  }

  return deopts
}

/**
 * Collect the functions of a pprof profile
 * @param {object} profile - pprof-format Profile
 * @returns {Array<{ name: string, file: string, line: number }>}
 */
function getProfileFunctions (profile) {
  const strings = profile.stringTable.strings

  // @datadog/pprof leaves Function.startLine empty and stores the function's
  // start line in its locations, which is also what react-pprof shows
  const locationLines = new Map()
  for (const location of profile.location || []) {
    for (const line of location.line || []) {
      const id = String(line.functionId)
      const value = Number(line.line || 0)
      if (value > 0 && (!locationLines.has(id) || value < locationLines.get(id))) {
        locationLines.set(id, value)
      }
    }
  }

  const functions = []
  for (const fn of profile.function || []) {
    functions.push({
      name: strings[Number(fn.name)] || '',
      file: strings[Number(fn.filename)] || '',
      line: Number(fn.startLine || 0) || locationLines.get(String(fn.id)) || 0
    })
  }
  return functions
}

/**
 * Builds a lookup from V8's view of a deopt (function name, source position)
 * to the profile's function table, so react-pprof can match them exactly.
 * @param {Array<{ name: string, file: string, line: number }>} functions
 */
function createFunctionResolver (functions) {
  const byFile = new Map()
  const byName = new Map()
  for (const fn of functions) {
    if (fn.file) {
      if (!byFile.has(fn.file)) byFile.set(fn.file, [])
      byFile.get(fn.file).push(fn)
    }
    if (fn.name) {
      if (!byName.has(fn.name)) byName.set(fn.name, [])
      byName.get(fn.name).push(fn)
    }
  }
  for (const list of byFile.values()) {
    list.sort((a, b) => a.line - b.line)
  }

  return {
    /**
     * @param {string} name - Name of the deoptimized function
     * @param {{ file: string, line: number } | null} position - Deopt position inside that function
     */
    resolve (name, position) {
      if (position) {
        const list = byFile.get(position.file)
        if (list) {
          // The function containing the position starts at or before it.
          // Prefer the closest one with the same name, then the closest one.
          let closest = null
          let closestNamed = null
          for (const fn of list) {
            if (fn.line > position.line) break
            if (fn.line <= 0) continue
            closest = fn
            if (name && fn.name === name) closestNamed = fn
          }
          if (closestNamed || closest) return closestNamed || closest
        }
      }

      if (name) {
        const candidates = byName.get(name)
        if (candidates && candidates.length === 1) return candidates[0]
      }
      return null
    }
  }
}

/**
 * Aggregate parsed deopts by function and build the payload stored in the
 * profile. Functions are named as in the profile when they can be matched.
 * @param {ReturnType<typeof parseDeoptTrace>} deopts
 * @param {Array<{ name: string, file: string, line: number }>} [profileFunctions]
 * @returns {{ type: string, version: number, functions: Array<object> }}
 */
function buildDeoptPayload (deopts, profileFunctions = []) {
  const resolver = createFunctionResolver(profileFunctions)
  const functions = new Map()

  for (const deopt of deopts) {
    const positions = parseDeoptPositions(deopt.position)
    const outermost = positions.length > 0 ? positions[positions.length - 1] : null

    let owner = resolver.resolve(deopt.functionName, outermost)
    if (!owner && deopt.functionName && outermost) {
      // Not in the profile (never sampled): keep it for reporting
      owner = { name: deopt.functionName, file: outermost.file, line: 0 }
    }
    if (!owner) continue

    const fnKey = `${owner.name}\0${owner.file}\0${owner.line}`
    let fn = functions.get(fnKey)
    if (!fn) {
      fn = { name: owner.name, file: owner.file, line: owner.line, entries: new Map() }
      functions.set(fnKey, fn)
    }

    // `</a.js:1:2> inlined at </b.js:3:4>` -> `/a.js:1:2 inlined at /b.js:3:4`
    const position = deopt.position.replace(/[<>]/g, '')
    const entryKey = `${deopt.reason}\0${deopt.bailoutType}\0${position}`
    const entry = fn.entries.get(entryKey)
    if (entry) {
      entry.count++
    } else {
      const item = { reason: deopt.reason, bailoutType: deopt.bailoutType, count: 1 }
      if (position) item.position = position
      fn.entries.set(entryKey, item)
    }
  }

  return {
    type: PAYLOAD_TYPE,
    version: PAYLOAD_VERSION,
    functions: [...functions.values()].map(fn => ({
      name: fn.name,
      file: fn.file,
      line: fn.line,
      deopts: [...fn.entries.values()].sort((a, b) => b.count - a.count)
    }))
  }
}

/**
 * Add a deopt payload to a profile as a comment
 * @param {object} profile - pprof-format Profile
 * @param {object} payload
 */
function attachDeoptPayload (profile, payload) {
  const index = profile.stringTable.dedup(JSON.stringify(payload))
  profile.comment = [...(profile.comment || []), index]
}

/**
 * Read the deopt payload from a profile, if it has one
 * @param {object} profile - pprof-format Profile
 * @returns {object | null}
 */
function extractDeoptPayload (profile) {
  const strings = profile.stringTable.strings
  for (const index of profile.comment || []) {
    const text = strings[Number(index)]
    if (typeof text !== 'string' || !text.includes(PAYLOAD_TYPE)) continue
    try {
      const parsed = JSON.parse(text)
      if (parsed && parsed.type === PAYLOAD_TYPE && Array.isArray(parsed.functions)) {
        return parsed
      }
    } catch {
      // not a deopt payload
    }
  }
  return null
}

/**
 * Tracks deopts in the current process. Requires the process to be started
 * with the arguments from getDeoptNodeArgs().
 */
class DeoptTracker {
  #traceFile
  #startOffset = null

  /**
   * @param {string} traceFile - Deopt trace file opened at startup
   */
  constructor (traceFile) {
    this.#traceFile = traceFile
    // Tracing is on from startup so V8 opens the file: turn it off until profiling starts
    setTracing(false)
  }

  get active () {
    return this.#startOffset !== null
  }

  start () {
    if (this.active) return
    this.#startOffset = fileSize(this.#traceFile)
    setTracing(true)
  }

  /**
   * Stop tracking and attach the deopts of the window to a CPU profile
   * @param {object} [profile] - pprof-format Profile to attach the deopts to
   * @returns {{ functions: number, deopts: number } | null} - What was attached
   */
  stop (profile) {
    if (!this.active) return null
    setTracing(false)
    const startOffset = this.#startOffset
    this.#startOffset = null

    if (!profile) return null

    const trace = readFrom(this.#traceFile, startOffset)
    const payload = buildDeoptPayload(parseDeoptTrace(trace), getProfileFunctions(profile))
    attachDeoptPayload(profile, payload)
    return {
      functions: payload.functions.length,
      deopts: payload.functions.reduce((sum, fn) => sum + fn.deopts.reduce((s, d) => s + d.count, 0), 0)
    }
  }
}

/**
 * Load the deopt reason catalog shipped with react-pprof
 * @returns {Promise<{ getDeoptCategory: Function, getDeoptReasonInfo: Function }>}
 */
function loadReasonCatalog () {
  return import('react-pprof/dist/deopts/index.js')
}

/**
 * Compute self and total time share for each function of a profile
 * @param {object} profile - pprof-format Profile
 * @returns {Map<string, { self: number, total: number }>} keyed by `name\0file\0line`, as fractions of the profile
 */
function getFunctionShares (profile) {
  const functions = getProfileFunctions(profile)
  const keyById = new Map()
  ;(profile.function || []).forEach((fn, i) => {
    const f = functions[i]
    keyById.set(String(fn.id), `${f.name}\0${f.file}\0${f.line}`)
  })
  const keyByLocation = new Map()
  for (const location of profile.location || []) {
    const line = location.line && location.line[0]
    if (line) keyByLocation.set(String(location.id), keyById.get(String(line.functionId)))
  }

  const valueIndex = Math.max(0, (profile.sampleType || []).length - 1)
  const shares = new Map()
  let grandTotal = 0
  for (const sample of profile.sample || []) {
    const value = Number(sample.value[valueIndex] || 0)
    if (value <= 0) continue
    grandTotal += value
    const seen = new Set()
    sample.locationId.forEach((locationId, depth) => {
      const key = keyByLocation.get(String(locationId))
      if (!key) return
      if (!shares.has(key)) shares.set(key, { self: 0, total: 0 })
      const share = shares.get(key)
      if (depth === 0) share.self += value
      if (!seen.has(key)) {
        share.total += value
        seen.add(key)
      }
    })
  }
  if (grandTotal > 0) {
    for (const share of shares.values()) {
      share.self /= grandTotal
      share.total /= grandTotal
    }
  }
  return shares
}

function percent (value) {
  return `${(value * 100).toFixed(1)}%`
}

function escapeCell (str) {
  return String(str).replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

/**
 * Render the deopts of a profile as markdown, or '' if it has none
 * @param {object} profile - pprof-format Profile
 * @param {object} [options]
 * @param {number} [options.maxFunctions=10] - Functions described in detail
 * @returns {Promise<string>}
 */
async function formatDeoptMarkdown (profile, options = {}) {
  const { maxFunctions = 10 } = options
  const payload = extractDeoptPayload(profile)
  if (!payload) return ''

  const { getDeoptCategory, getDeoptReasonInfo } = await loadReasonCatalog()
  const shares = getFunctionShares(profile)

  let totalDeopts = 0
  let tieringDeopts = 0
  const rows = payload.functions.map(fn => {
    const share = shares.get(`${fn.name}\0${fn.file}\0${fn.line}`) || { self: 0, total: 0 }
    const deopts = fn.deopts.map(d => ({ ...d, category: getDeoptCategory(d.reason), info: getDeoptReasonInfo(d.reason) }))
    const actionable = deopts.filter(d => d.category === 'actionable')
    const count = deopts.reduce((sum, d) => sum + d.count, 0)
    const actionableCount = actionable.reduce((sum, d) => sum + d.count, 0)
    totalDeopts += count
    tieringDeopts += count - actionableCount
    return { fn, share, actionable, actionableCount }
  })

  const lines = ['', '## V8 Deoptimizations', '']
  if (totalDeopts === 0) {
    lines.push('No V8 deoptimizations were recorded while profiling.', '')
    return lines.join('\n')
  }

  lines.push(
    `${totalDeopts} deoptimizations in ${payload.functions.length} functions were recorded while profiling` +
      (tieringDeopts > 0 ? `, ${tieringDeopts} of them normal tiering or engine-internal events (on-stack replacement, insufficient type feedback, ...).` : '.'),
    'A deoptimization is not a bug by itself: it matters when it repeats in a function that takes a large share of the profile.',
    ''
  )

  const actionableRows = rows
    .filter(row => row.actionableCount > 0)
    .sort((a, b) => (b.share.self - a.share.self) || (b.actionableCount - a.actionableCount))

  if (actionableRows.length === 0) {
    lines.push('No actionable deoptimizations were recorded.', '')
    return lines.join('\n')
  }

  lines.push(
    '| Function | Location | Self | Total | Deopts | Reasons |',
    '|---|---|---|---|---|---|'
  )
  for (const row of actionableRows) {
    const location = row.fn.line ? `${row.fn.file}:${row.fn.line}` : row.fn.file
    const reasons = [...new Set(row.actionable.map(d => d.reason))].join(', ')
    lines.push(`| \`${escapeCell(row.fn.name || '(anonymous)')}\` | ${escapeCell(location)} | ${percent(row.share.self)} | ${percent(row.share.total)} | ${row.actionableCount} | ${escapeCell(reasons)} |`)
  }
  lines.push('')

  for (const row of actionableRows.slice(0, maxFunctions)) {
    const location = row.fn.line ? `${row.fn.file}:${row.fn.line}` : row.fn.file
    lines.push(`### \`${row.fn.name || '(anonymous)'}\` (${location})`, '')
    for (const deopt of row.actionable) {
      const name = deopt.info ? ` (\`${deopt.info.reason}\`, ${deopt.info.kind})` : ''
      const at = deopt.position ? ` at ${deopt.position}` : ''
      lines.push(`- **${deopt.reason}**${name} ×${deopt.count}${at}`)
      if (deopt.info) lines.push(`  ${deopt.info.meaning}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Decode a pprof file (optionally gzipped)
 * @param {string} file
 * @returns {Promise<object>} pprof-format Profile
 */
async function readProfile (file) {
  let data = fs.readFileSync(file)
  if (data[0] === 0x1f && data[1] === 0x8b) {
    data = require('zlib').gunzipSync(data)
  }
  const { Profile } = await import('pprof-format')
  return Profile.decode(data)
}

/**
 * Append the deopt section to a markdown report generated from a pprof file
 * @param {string} pprofPath
 * @param {string} markdown
 * @returns {Promise<string>}
 */
async function appendDeoptMarkdown (pprofPath, markdown) {
  try {
    const section = await formatDeoptMarkdown(await readProfile(pprofPath))
    return section ? `${markdown.replace(/\s*$/, '')}\n${section}` : markdown
  } catch {
    return markdown
  }
}

function setTracing (enabled) {
  require('v8').setFlagsFromString(enabled ? '--trace-deopt-verbose' : '--no-trace-deopt-verbose')
}

function fileSize (file) {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

function readFrom (file, offset) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    // The file can be truncated if another isolate (e.g. a worker) reopened it
    const start = offset <= size ? offset : 0
    const buffer = Buffer.alloc(size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    return buffer
  } catch {
    return Buffer.alloc(0)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

module.exports = {
  PAYLOAD_TYPE,
  getDeoptNodeArgs,
  createDeoptTraceDir,
  parseDeoptPositions,
  parseDeoptTrace,
  getProfileFunctions,
  buildDeoptPayload,
  attachDeoptPayload,
  extractDeoptPayload,
  formatDeoptMarkdown,
  appendDeoptMarkdown,
  DeoptTracker
}
