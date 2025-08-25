// Simple test script for testing profiling
console.log('Test script starting...')

function fibonacci (n) {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}

function busyWork () {
  const result = fibonacci(30)
  console.log(`Fibonacci result: ${result}`)
}

// Do some work
busyWork()

console.log('Test script finished')
