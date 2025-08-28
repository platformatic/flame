const neostandard = require('neostandard')

module.exports = neostandard({
  ignores: ['node_modules', '**/cpu-profile-*', 'flamegraph-*']
})
