'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')

// Test the sourcemap enhancement logic directly
// This tests the LEAST_UPPER_BOUND bias and function name extraction from sourcesContent

test('sourcemap enhancement: extractFunctionName helper', async (t) => {
  // Import the helper by evaluating it in isolation
  // (since it's defined inside the preload closure, we recreate it here for testing)
  function extractFunctionName (sourceLine) {
    if (!sourceLine) return null
    // Match function declarations: function name( or async function name(
    const funcMatch = sourceLine.match(/(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/)
    if (funcMatch) return funcMatch[1]
    // Match arrow functions: name = ( or name = async (
    const arrowMatch = sourceLine.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\(/)
    if (arrowMatch) return arrowMatch[1]
    // Match object property functions: name: function( or name: async function(
    const propFuncMatch = sourceLine.match(/([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*(?:async\s+)?function\s*\(/)
    if (propFuncMatch) return propFuncMatch[1]
    // Match method shorthand in class/object: name( but not control flow like if(
    const methodMatch = sourceLine.match(/^\s*(?:async\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/)
    if (methodMatch) {
      const name = methodMatch[1]
      // Exclude control flow keywords
      if (!['if', 'else', 'for', 'while', 'switch', 'catch', 'with'].includes(name)) {
        return name
      }
    }
    return null
  }

  await t.test('should extract function declaration names', () => {
    assert.strictEqual(extractFunctionName('function myFunction() {'), 'myFunction')
    assert.strictEqual(extractFunctionName('function getCustomFormFields(resumableState, formAction) {'), 'getCustomFormFields')
    assert.strictEqual(extractFunctionName('  function innerFunc() {'), 'innerFunc')
  })

  await t.test('should extract async function names', () => {
    assert.strictEqual(extractFunctionName('async function fetchData() {'), 'fetchData')
    assert.strictEqual(extractFunctionName('async function renderNodeDestructive(task) {'), 'renderNodeDestructive')
  })

  await t.test('should extract arrow function names', () => {
    assert.strictEqual(extractFunctionName('const handler = () => {'), 'handler')
    assert.strictEqual(extractFunctionName('const process = async () => {'), 'process')
    assert.strictEqual(extractFunctionName('let callback = (x) => x * 2'), 'callback')
  })

  await t.test('should extract method definition names', () => {
    assert.strictEqual(extractFunctionName('  render() {'), 'render')
    assert.strictEqual(extractFunctionName('  async componentDidMount() {'), 'componentDidMount')
  })

  await t.test('should extract object property function names', () => {
    assert.strictEqual(extractFunctionName('  performWork: function() {'), 'performWork')
    assert.strictEqual(extractFunctionName('  retryNode: async function(node) {'), 'retryNode')
  })

  await t.test('should return null for non-function lines', () => {
    assert.strictEqual(extractFunctionName('const x = 5;'), null)
    assert.strictEqual(extractFunctionName('if (true) {'), null)
    assert.strictEqual(extractFunctionName('return result;'), null)
    assert.strictEqual(extractFunctionName(''), null)
    assert.strictEqual(extractFunctionName(null), null)
  })
})

test('sourcemap enhancement: LEAST_UPPER_BOUND bias for Turbopack-style maps', async (t) => {
  const sourceMap = require('source-map')

  // Create a synthetic sourcemap using SourceMapGenerator (more reliable than hand-crafting VLQ)
  const generator = new sourceMap.SourceMapGenerator({ file: 'generated.js' })

  generator.setSourceContent('original.ts', 'function myFunction(arg1, arg2) {\n  return arg1 + arg2;\n}\n')

  // Add a mapping starting at column 350 (simulating Turbopack's loader code taking up early columns)
  generator.addMapping({
    generated: { line: 1, column: 350 },
    original: { line: 1, column: 0 },
    source: 'original.ts',
    name: 'myFunction'
  })

  const syntheticMap = JSON.parse(generator.toString())
  const consumer = await new sourceMap.SourceMapConsumer(syntheticMap)

  await t.test('exact position lookup should fail for early columns', () => {
    // Column 0 has no mapping (the mapping starts at column 350)
    const pos = consumer.originalPositionFor({ line: 1, column: 0 })
    assert.strictEqual(pos.source, null, 'Should not find mapping at column 0')
  })

  await t.test('LEAST_UPPER_BOUND should find nearest mapping to the right', () => {
    // Using LEAST_UPPER_BOUND should find the mapping at column 350
    const pos = consumer.originalPositionFor({
      line: 1,
      column: 0,
      bias: sourceMap.SourceMapConsumer.LEAST_UPPER_BOUND
    })
    assert.strictEqual(pos.source, 'original.ts', 'Should find source with LEAST_UPPER_BOUND')
    assert.strictEqual(pos.line, 1, 'Should map to line 1')
    assert.strictEqual(pos.name, 'myFunction', 'Should have the function name')
  })

  consumer.destroy()
})

test('sourcemap enhancement: function name extraction from sourcesContent', async (t) => {
  const sourceMap = require('source-map')

  // Create a sourcemap WITH sourcesContent but WITHOUT name mappings
  // This mimics how Next.js bundles React - file/line mappings exist but names don't
  const mapWithSourcesContent = {
    version: 3,
    sources: ['react-internal.js'],
    names: [], // Empty names - no name mappings!
    mappings: 'AAAA;AACA;AACA', // Maps lines 1-3 to source lines 1-3, but no names
    sourcesContent: [
      'function renderElement(type, props) {\n' +
      '  const element = createElement(type, props);\n' +
      '  return element;\n' +
      '}\n' +
      '\n' +
      'async function finishFunctionComponent(Component) {\n' +
      '  const result = await Component();\n' +
      '  return result;\n' +
      '}'
    ]
  }

  const consumer = await new sourceMap.SourceMapConsumer(mapWithSourcesContent)

  await t.test('sourcesContent should be accessible', () => {
    const content = consumer.sourceContentFor('react-internal.js')
    assert.ok(content, 'Should have source content')
    assert.ok(content.includes('function renderElement'), 'Should contain the function')
  })

  await t.test('position lookup should work but without name', () => {
    const pos = consumer.originalPositionFor({ line: 1, column: 0 })
    assert.strictEqual(pos.source, 'react-internal.js')
    assert.strictEqual(pos.line, 1)
    assert.strictEqual(pos.name, null, 'Name should be null since names array is empty')
  })

  await t.test('function name can be extracted from source line', () => {
    const content = consumer.sourceContentFor('react-internal.js')
    const lines = content.split('\n')

    // Line 1 should contain renderElement
    assert.ok(lines[0].includes('function renderElement'), 'Line 1 should have renderElement')

    // Line 6 should contain finishFunctionComponent
    assert.ok(lines[5].includes('async function finishFunctionComponent'), 'Line 6 should have finishFunctionComponent')
  })

  consumer.destroy()
})

test('sourcemap enhancement: integration with SourceMapper', async (t) => {
  const { SourceMapper } = require('@datadog/pprof/out/src/sourcemapper/sourcemapper')

  // Create a temporary directory with test fixtures
  const fixtureDir = path.join(__dirname, 'temp-sourcemap-fixtures')
  fs.mkdirSync(fixtureDir, { recursive: true })

  // Create a generated JS file
  const generatedJs = '// loader code padding '.repeat(20) + 'function eY(){return 1}'
  fs.writeFileSync(path.join(fixtureDir, 'bundle.js'), generatedJs + '\n//# sourceMappingURL=bundle.js.map')

  // Create corresponding sourcemap with sourcesContent but no name mappings
  const bundleMap = {
    version: 3,
    file: 'bundle.js',
    sources: ['../src/utils.ts'],
    names: [],
    mappings: 'gNAAA', // Maps to column 400+ in generated, line 1 col 0 in source
    sourcesContent: ['function getCustomFormFields(state) {\n  return state.fields;\n}']
  }
  fs.writeFileSync(path.join(fixtureDir, 'bundle.js.map'), JSON.stringify(bundleMap))

  try {
    const mapper = await SourceMapper.create([fixtureDir])

    await t.test('should load the sourcemap', () => {
      const bundlePath = path.join(fixtureDir, 'bundle.js')
      assert.ok(mapper.infoMap.has(bundlePath), 'Should have mapping for bundle.js')
    })

    await t.test('should have access to map consumer', () => {
      const bundlePath = path.join(fixtureDir, 'bundle.js')
      const entry = mapper.infoMap.get(bundlePath)
      assert.ok(entry, 'Should have entry')
      assert.ok(entry.mapConsumer, 'Should have mapConsumer')
    })
  } finally {
    // Cleanup
    fs.rmSync(fixtureDir, { recursive: true, force: true })
  }
})
