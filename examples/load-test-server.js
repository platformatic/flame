const http = require('http')

// Simulate some CPU-intensive work
function fibonacci (n) {
  if (n <= 1) return n
  return fibonacci(n - 1) + fibonacci(n - 2)
}

function heavyComputation () {
  // Do some work that will show up in the profile
  const result = fibonacci(30)
  return { result, timestamp: Date.now() }
}

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'Hello World', ...heavyComputation() }))
  } else if (req.url === '/heavy') {
    // More intensive work
    res.writeHead(200, { 'Content-Type': 'application/json' })
    const results = []
    for (let i = 0; i < 5; i++) {
      results.push(heavyComputation())
    }
    res.end(JSON.stringify({ results }))
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
})

const port = process.env.PORT || 3000
server.listen(port, () => {
  console.log(`Server running on port ${port}`)
  console.log(`PID: ${process.pid}`)
  console.log('Available endpoints:')
  console.log(`  http://localhost:${port}/`)
  console.log(`  http://localhost:${port}/heavy`)
})
