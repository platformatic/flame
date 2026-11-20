'use strict'

// Deoptimizes repeatedly while the profiler runs (used with --delay=none)
function readX (o) {
  return o.x + o.y
}

function makeShape (i) {
  switch (i % 4) {
    case 0: return { x: i, y: 1 }
    case 1: return { y: 1, x: i }
    case 2: return { x: i, y: 1, z: 2 }
    default: return { z: 2, y: 1, x: i }
  }
}

function sum (arr) {
  let total = 0
  for (let i = 0; i < arr.length; i++) total += arr[i]
  return total
}

let acc = 0
for (let round = 0; round < 100; round++) {
  for (let i = 0; i < 20000; i++) acc += readX({ x: i, y: 1 })
  for (let i = 0; i < 20000; i++) acc += readX(makeShape(i))
  const a = []
  for (let i = 0; i < 5000; i++) a.push(i)
  acc += sum(a)
  a.push(1.5)
  acc += sum(a)
}

console.log('deopt-script done', acc > 0)
