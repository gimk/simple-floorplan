#!/usr/bin/env node
// Zero-dependency MCP stdio-to-HTTP bridge for Simple Floorplan (Node >= 18).
// Reads newline-delimited JSON-RPC 2.0 messages from stdin, POSTs them to SFP_URL,
// and writes JSON-RPC responses to stdout. Diagnostics go strictly to stderr.

import { createInterface } from 'node:readline'

const SFP_URL = process.env.SFP_URL || 'http://localhost:8788/api/mcp'
const SFP_TOKEN = process.env.SFP_TOKEN || ''
const SFP_PASSCODE = process.env.SFP_PASSCODE || ''

const headers = {
  'content-type': 'application/json',
  accept: 'application/json',
}
if (SFP_TOKEN) headers.authorization = `Bearer ${SFP_TOKEN}`
if (SFP_PASSCODE) headers['x-passcode'] = SFP_PASSCODE

function writeStdout(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

function makeRpcError(id, code, message, data) {
  const err = { code, message }
  if (data !== undefined) err.data = data
  return { jsonrpc: '2.0', id, error: err }
}

async function forwardLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return

  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch (err) {
    process.stderr.write(`[mcp-stdio] Invalid JSON on stdin: ${err.message}\n`)
    writeStdout(makeRpcError(null, -32700, 'Parse error: invalid JSON on stdin.'))
    return
  }

  let res
  try {
    res = await fetch(SFP_URL, {
      method: 'POST',
      headers,
      body: trimmed,
    })
  } catch (err) {
    process.stderr.write(`[mcp-stdio] Network error posting to ${SFP_URL}: ${err.message}\n`)
    if (!Array.isArray(parsed) && parsed && 'id' in parsed && parsed.id !== undefined) {
      writeStdout(makeRpcError(parsed.id, -32603, `Failed to reach ${SFP_URL}: ${err.message}`))
    }
    return
  }

  if (res.status === 202 || res.status === 204) {
    return
  }

  const text = await res.text()
  if (!res.ok) {
    process.stderr.write(`[mcp-stdio] HTTP ${res.status} from ${SFP_URL}: ${text.slice(0, 300)}\n`)
    if (!Array.isArray(parsed) && parsed && 'id' in parsed && parsed.id !== undefined) {
      // If the server already returned a JSON-RPC error object, pass it through.
      try {
        const body = JSON.parse(text)
        if (body && body.jsonrpc === '2.0') {
          writeStdout(body)
          return
        }
      } catch {
        // fall through to synthesized JSON-RPC error
      }
      writeStdout(makeRpcError(parsed.id, -32603, `HTTP ${res.status} from ${SFP_URL}`, text.slice(0, 500)))
    }
    return
  }

  if (!text.trim()) return

  try {
    const body = JSON.parse(text)
    writeStdout(body)
  } catch (err) {
    process.stderr.write(`[mcp-stdio] Non-JSON response from ${SFP_URL}: ${err.message}\n`)
    if (!Array.isArray(parsed) && parsed && 'id' in parsed && parsed.id !== undefined) {
      writeStdout(makeRpcError(parsed.id, -32603, `Invalid JSON response from ${SFP_URL}`))
    }
  }
}

// Serialize stdin lines in order so responses match request ordering cleanly.
let queue = Promise.resolve()
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', (line) => {
  queue = queue.then(() => forwardLine(line)).catch((err) => {
    process.stderr.write(`[mcp-stdio] Unexpected error: ${err?.stack || err}\n`)
  })
})

rl.on('close', () => {
  queue.finally(() => process.exit(0))
})
