'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  getDeoptNodeArgs,
  parseDeoptPositions,
  parseDeoptTrace,
  getProfileFunctions,
  buildDeoptPayload,
  attachDeoptPayload,
  extractDeoptPayload,
  formatDeoptMarkdown,
  PAYLOAD_TYPE
} = require('../lib/deopt.js')

const TRACE = `[bailout (kind: deopt-eager, reason: prepare for on stack replacement (OSR)): begin. deoptimizing 0x22ad1483f091 <JSFunction (sfi = 0x398260323a91)>, 0x27f17c54f619 <Code MAGLEV>, opt id 6, bytecode offset 103, deopt exit 8, FP to SP delta 160, caller SP 0x00016f8a9820, pc 0x00012451715c]
            ;;; deoptimize at </app/main.js:6:1>
  reading input frame  => bytecode_offset=103, args=1, height=9, retval=0(#0); inputs:
      0: 0x022ad1483f091 ;  [fp - 16]  0x22ad1483f091 <JSFunction (sfi = 0x398260323a91)>
[bailout end. took 0.500 ms]
[bailout (kind: deopt-eager, reason: wrong map): begin. deoptimizing 0x22ad1483ef69 <JSFunction readX (sfi = 0x398260323b01)>, 0x3ae7d2266c71 <Code MAGLEV>, opt id 5, bytecode offset 0, deopt exit 0, FP to SP delta 32, caller SP 0x00016f8a9740, pc 0x000124515fac]
            ;;; deoptimize at </app/lib.js:5:31>
[bailout end. took 0.291 ms]
[bailout (kind: deopt-eager, reason: wrong map): begin. deoptimizing 0x22ad1483ef69 <JSFunction readX (sfi = 0x398260323b01)>, 0x3ae7d2266c71 <Code MAGLEV>, opt id 7, bytecode offset 0, deopt exit 0, FP to SP delta 32, caller SP 0x00016f8a9740, pc 0x000124515fac]
            ;;; deoptimize at </app/lib.js:5:31>
[bailout end. took 0.291 ms]
[bailout (kind: deopt-eager, reason: not a Smi): begin. deoptimizing 0x22ad1483ef70 <JSFunction outer (sfi = 0x398260323b02)>, 0x3ae7d2266c72 <Code TURBOFAN_JS>, opt id 8, bytecode offset 4, deopt exit 1, FP to SP delta 32, caller SP 0x00016f8a9740, pc 0x000124515fad]
            ;;; deoptimize at </app/lib.js:2:10> inlined at </app/lib.js:12:3>
[bailout end. took 0.100 ms]
[bailout (kind: deopt-lazy, reason: (unknown)): begin. deoptimizing 0x22ad1483ef71 <JSFunction neverSampled (sfi = 0x398260323b03)>, 0x3ae7d2266c73 <Code TURBOFAN_JS>, opt id 9, bytecode offset 4, deopt exit 1, FP to SP delta 32, caller SP 0x00016f8a9740, pc 0x000124515fae]
            ;;; deoptimize at </app/other.js:40:2>
[bailout end. took 0.100 ms]
`

const PROFILE_FUNCTIONS = [
  { name: '(anonymous:L#1:C#1)', file: '/app/main.js', line: 1 },
  { name: 'readX', file: '/app/lib.js', line: 4 },
  { name: 'helper', file: '/app/lib.js', line: 1 },
  { name: 'outer', file: '/app/lib.js', line: 10 }
]

test('getDeoptNodeArgs opens the trace file at startup', () => {
  const { args, traceFile } = getDeoptNodeArgs('/tmp/x')
  assert.strictEqual(traceFile, path.join('/tmp/x', 'deopt-trace.txt'))
  assert.deepStrictEqual(args, [
    '--trace-deopt-verbose',
    '--redirect-code-traces',
    `--redirect-code-traces-to=${traceFile}`
  ])
})

test('parseDeoptTrace extracts reason, kind, function and position', () => {
  const deopts = parseDeoptTrace(TRACE)
  assert.deepStrictEqual(deopts, [
    { reason: 'prepare for on stack replacement (OSR)', bailoutType: 'deopt-eager', functionName: '', position: '</app/main.js:6:1>' },
    { reason: 'wrong map', bailoutType: 'deopt-eager', functionName: 'readX', position: '</app/lib.js:5:31>' },
    { reason: 'wrong map', bailoutType: 'deopt-eager', functionName: 'readX', position: '</app/lib.js:5:31>' },
    { reason: 'not a Smi', bailoutType: 'deopt-eager', functionName: 'outer', position: '</app/lib.js:2:10> inlined at </app/lib.js:12:3>' },
    { reason: '(unknown)', bailoutType: 'deopt-lazy', functionName: 'neverSampled', position: '</app/other.js:40:2>' }
  ])
})

test('parseDeoptTrace accepts buffers and ignores unrelated output', () => {
  const deopts = parseDeoptTrace(Buffer.from('random line\n[bailout end. took 1 ms]\n' + TRACE.split('\n').slice(5, 8).join('\n')))
  assert.strictEqual(deopts.length, 1)
  assert.strictEqual(deopts[0].functionName, 'readX')
})

test('parseDeoptPositions returns positions innermost first', () => {
  assert.deepStrictEqual(parseDeoptPositions('</app/a.js:2:10> inlined at </app/b.js:12:3>'), [
    { file: '/app/a.js', line: 2, column: 10 },
    { file: '/app/b.js', line: 12, column: 3 }
  ])
  assert.deepStrictEqual(parseDeoptPositions('<file:///app/c.mjs:1:2>'), [
    { file: 'file:///app/c.mjs', line: 1, column: 2 }
  ])
  assert.deepStrictEqual(parseDeoptPositions(''), [])
})

test('buildDeoptPayload groups deopts by profile function', () => {
  const payload = buildDeoptPayload(parseDeoptTrace(TRACE), PROFILE_FUNCTIONS)
  assert.strictEqual(payload.type, PAYLOAD_TYPE)
  assert.strictEqual(payload.version, 1)

  const byName = Object.fromEntries(payload.functions.map(fn => [fn.name, fn]))

  // Anonymous functions are matched by position and named as in the profile
  assert.deepStrictEqual(byName['(anonymous:L#1:C#1)'], {
    name: '(anonymous:L#1:C#1)',
    file: '/app/main.js',
    line: 1,
    deopts: [{ reason: 'prepare for on stack replacement (OSR)', bailoutType: 'deopt-eager', count: 1, position: '/app/main.js:6:1' }]
  })

  // Repeated deopts are counted
  assert.deepStrictEqual(byName.readX.deopts, [
    { reason: 'wrong map', bailoutType: 'deopt-eager', count: 2, position: '/app/lib.js:5:31' }
  ])
  assert.strictEqual(byName.readX.line, 4)

  // Inlined deopts belong to the optimized (outermost) function
  assert.strictEqual(byName.outer.line, 10)
  assert.strictEqual(byName.outer.deopts[0].position, '/app/lib.js:2:10 inlined at /app/lib.js:12:3')
  assert.strictEqual(byName.helper, undefined)

  // Functions that are not in the profile are kept for reporting
  assert.deepStrictEqual(byName.neverSampled, {
    name: 'neverSampled',
    file: '/app/other.js',
    line: 0,
    deopts: [{ reason: '(unknown)', bailoutType: 'deopt-lazy', count: 1, position: '/app/other.js:40:2' }]
  })
})

async function makeProfile () {
  const { Profile, StringTable, Function, Location, Line, Sample, ValueType } = await import('pprof-format')
  const stringTable = new StringTable()
  const functions = PROFILE_FUNCTIONS.map((fn, i) => new Function({
    id: i + 1,
    name: stringTable.dedup(fn.name),
    filename: stringTable.dedup(fn.file),
    // Like @datadog/pprof: no startLine, the start line is in the location
    startLine: 0
  }))
  const locations = PROFILE_FUNCTIONS.map((fn, i) => new Location({
    id: i + 1,
    line: [new Line({ functionId: i + 1, line: fn.line })]
  }))
  return new Profile({
    sampleType: [
      new ValueType({ type: stringTable.dedup('sample'), unit: stringTable.dedup('count') }),
      new ValueType({ type: stringTable.dedup('wall'), unit: stringTable.dedup('nanoseconds') })
    ],
    sample: [
      // readX called from outer: 3 samples, readX is the leaf
      new Sample({ locationId: [2, 4], value: [1, 300] }),
      // outer alone
      new Sample({ locationId: [4], value: [1, 100] })
    ],
    location: locations,
    function: functions,
    stringTable
  })
}

test('getProfileFunctions falls back to location lines', async () => {
  const profile = await makeProfile()
  assert.deepStrictEqual(getProfileFunctions(profile), PROFILE_FUNCTIONS)
})

test('the payload round-trips through an encoded profile', async () => {
  const { Profile } = await import('pprof-format')
  const profile = await makeProfile()
  const payload = buildDeoptPayload(parseDeoptTrace(TRACE), getProfileFunctions(profile))
  attachDeoptPayload(profile, payload)

  const decoded = Profile.decode(profile.encode())
  assert.deepStrictEqual(extractDeoptPayload(decoded), payload)
})

test('extractDeoptPayload ignores other comments', async () => {
  const profile = await makeProfile()
  profile.comment = [profile.stringTable.dedup('hello'), profile.stringTable.dedup('{"type":"v8-deopts" broken')]
  assert.strictEqual(extractDeoptPayload(profile), null)
})

test('formatDeoptMarkdown lists actionable deopts with time shares', async () => {
  const profile = await makeProfile()
  assert.strictEqual(await formatDeoptMarkdown(profile), '')

  attachDeoptPayload(profile, buildDeoptPayload(parseDeoptTrace(TRACE), getProfileFunctions(profile)))
  const markdown = await formatDeoptMarkdown(profile)

  assert.match(markdown, /## V8 Deoptimizations/)
  assert.match(markdown, /5 deoptimizations in 4 functions were recorded while profiling, 2 of them normal tiering/)
  // readX: 75% self, outer: 25% self / 100% total
  assert.match(markdown, /\| `readX` \| \/app\/lib\.js:4 \| 75\.0% \| 75\.0% \| 2 \| wrong map \|/)
  assert.match(markdown, /\| `outer` \| \/app\/lib\.js:10 \| 25\.0% \| 100\.0% \| 1 \| not a Smi \|/)
  // Tiering-only functions are not listed
  assert.doesNotMatch(markdown, /anonymous:L#1/)
  assert.match(markdown, /- \*\*wrong map\*\* \(`WrongMap`, eager\) ×2 at \/app\/lib\.js:5:31/)
})

test('flame run --deopt attaches deopts to the CPU profile', { timeout: 60000 }, async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'flame-deopt-test-'))
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }))

  const script = path.join(__dirname, 'fixtures', 'deopt-script.js')
  const cli = path.join(__dirname, '..', 'bin', 'flame.js')
  const child = spawn('node', [cli, 'run', '--deopt', '--delay=none', script], { cwd, stdio: 'pipe' })

  let stdout = ''
  child.stdout.on('data', (data) => { stdout += data })
  child.stderr.on('data', (data) => { stdout += data })
  const code = await new Promise(resolve => child.on('close', resolve))

  assert.strictEqual(code, 0, stdout)
  assert.match(stdout, /deopt-script done true/)
  assert.match(stdout, /Recorded \d+ V8 deopts in \d+ functions/)
  // V8's deopt traces go to a file, not to the application's output
  assert.doesNotMatch(stdout, /\[bailout/)

  const cpuProfile = fs.readdirSync(cwd).find(f => f.startsWith('cpu-profile-') && f.endsWith('.pb'))
  assert.ok(cpuProfile, 'CPU profile should be written')

  const { parseProfile } = require('../lib/index.js')
  const profile = await parseProfile(path.join(cwd, cpuProfile))
  const payload = extractDeoptPayload(profile)
  assert.ok(payload, 'CPU profile should carry deopts')

  const scriptFunctions = payload.functions.filter(fn => fn.file === script)
  assert.ok(scriptFunctions.length > 0, 'deopts should be attributed to the script')

  // Deopts are attributed to functions of the profile, by the same name and line
  const profileFunctions = getProfileFunctions(profile)
  for (const fn of scriptFunctions) {
    assert.ok(
      profileFunctions.some(p => p.name === fn.name && p.file === fn.file && p.line === fn.line) || fn.line === 0,
      `${fn.name}:${fn.line} should match a profile function`
    )
  }

  // The markdown report includes the deopts
  const markdown = fs.readFileSync(path.join(cwd, cpuProfile.replace('.pb', '.md')), 'utf8')
  assert.match(markdown, /## V8 Deoptimizations/)
})
