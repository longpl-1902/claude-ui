'use strict'
// Agent Console hook forwarder. Reads the hook JSON from stdin and POSTs it to the local app.
// Must never block or fail Claude: every path exits 0, nothing is printed, nothing is written.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const MAX = 1024 * 1024
const done = () => process.exit(0)
setTimeout(done, 1500).unref()

const chunks = []
let size = 0
let finished = false
function finish() {
  if (finished) return
  finished = true
  try {
    const ep = JSON.parse(fs.readFileSync(path.join(__dirname, 'endpoint.json'), 'utf8'))
    if (!ep || !Number.isInteger(ep.port) || typeof ep.token !== 'string') return done()
    const body = Buffer.concat(chunks)
    const req = http.request(
      { host: '127.0.0.1', port: ep.port, path: '/hook', method: 'POST', timeout: 1000, headers: { 'content-type': 'application/json', 'content-length': body.length, 'x-agent-console-token': ep.token } },
      (res) => { res.resume(); res.on('end', done); res.on('error', done) }
    )
    req.on('error', done)
    req.on('timeout', done)
    req.end(body)
  } catch {
    done()
  }
}
try {
  process.stdin.on('data', (c) => {
    if (finished) return
    const room = MAX - size
    if (c.length >= room) {
      chunks.push(c.subarray(0, room))
      size = MAX
      finish()
    } else {
      chunks.push(c)
      size += c.length
    }
  })
  process.stdin.on('end', finish)
  process.stdin.on('error', finish)
} catch {
  done()
}
