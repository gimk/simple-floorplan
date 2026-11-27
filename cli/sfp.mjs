#!/usr/bin/env node
// Zero-dependency CLI for the Simple Floorplan API. Node 22+.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const USAGE = `sfp - Simple Floorplan CLI

Usage: sfp <command> [args] [flags]

Commands:
  projects                                  List projects
  create [title]                            Create a project
  pull <id> [out.json]                      Download the project doc
  push <id> <file.json> [--base-version n]  Upload a project doc
  query <id> <summary|validate|rooms|walls|artboard> [--artboard <aid>]
  exec <id> <jsonOrFile> [--dry-run] [--base-version n]
                                            Run one command or an array (inline JSON, @file.json, or a file path)
  render <id> [out.svg] [--artboard <aid>]  Render an artboard as SVG
  delete <id>                               Delete a project
  help                                      Show this help

Environment: SFP_URL (default http://localhost:8788), SFP_TOKEN
Flags: --url <url>, --token <token>
`

const VALUE_FLAGS = new Set(['url', 'token', 'base-version', 'artboard'])
const BOOL_FLAGS = new Set(['dry-run', 'help'])

class CliError extends Error {}

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h') flags.help = true
    else if (a.startsWith('--')) {
      const name = a.slice(2)
      if (BOOL_FLAGS.has(name)) flags[name] = true
      else if (VALUE_FLAGS.has(name)) {
        const v = argv[++i]
        if (v === undefined) throw new CliError(`Flag --${name} needs a value`)
        flags[name] = v
      } else throw new CliError(`Unknown flag --${name}`)
    } else positional.push(a)
  }
  return { positional, flags }
}

function parseBaseVersion(flags) {
  if (flags['base-version'] === undefined) return undefined
  const n = Number(flags['base-version'])
  if (!Number.isInteger(n)) throw new CliError('--base-version must be an integer')
  return n
}

function readJsonArg(arg) {
  let text = arg
  if (arg.startsWith('@')) text = readFileSync(arg.slice(1), 'utf8')
  else if (existsSync(arg)) text = readFileSync(arg, 'utf8')
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new CliError(`Invalid JSON: ${e.message}`)
  }
}

function need(positional, n, usage) {
  if (positional.length < n) throw new CliError(`Usage: sfp ${usage}`)
}

/**
 * Runs the CLI. Returns the exit code (0 = ok).
 * io: { fetch, stdout(text), stderr(text), env }
 */
export async function runCli(argv, io = {}) {
  const out = io.stdout ?? ((t) => process.stdout.write(t))
  const err = io.stderr ?? ((t) => process.stderr.write(t))
  const env = io.env ?? process.env
  const doFetch = io.fetch ?? globalThis.fetch
  try {
    const { positional, flags } = parseArgs(argv)
    const [command, ...args] = positional
    if (!command || command === 'help' || flags.help) {
      out(USAGE)
      return 0
    }
    const base = String(flags.url ?? env.SFP_URL ?? 'http://localhost:8788').replace(/\/+$/, '')
    const token = flags.token ?? env.SFP_TOKEN
    const headers = {}
    if (token) {
      if (token.startsWith('sfp_')) headers.Authorization = `Bearer ${token}`
      else headers['x-api-token'] = token
    }

    const call = async (method, path, body) => {
      const init = { method, headers: { ...headers } }
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const res = await doFetch(`${base}${path}`, init)
      const text = await res.text()
      if (!res.ok) throw new CliError(`HTTP ${res.status} ${method} ${path}: ${text}`)
      return text
    }
    const printJson = (text) => {
      let pretty = text
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        /* not JSON: print as is */
      }
      out(pretty + '\n')
    }
    const enc = encodeURIComponent
    const writeOrPrint = (file, text) => {
      if (file) writeFileSync(file, text)
      else out(text.endsWith('\n') ? text : text + '\n')
    }

    switch (command) {
      case 'projects':
        printJson(await call('GET', '/api/projects'))
        break
      case 'create': {
        const body = args[0] ? { title: args[0] } : {}
        printJson(await call('POST', '/api/projects', body))
        break
      }
      case 'pull': {
        need(args, 1, 'pull <id> [out.json]')
        const data = JSON.parse(await call('GET', `/api/projects/${enc(args[0])}`))
        writeOrPrint(args[1], JSON.stringify(data.doc, null, 2))
        break
      }
      case 'push': {
        need(args, 2, 'push <id> <file.json> [--base-version <n>]')
        const doc = readJsonArg(`@${args[1]}`)
        const body = { doc }
        const bv = parseBaseVersion(flags)
        if (bv !== undefined) body.baseVersion = bv
        printJson(await call('PUT', `/api/projects/${enc(args[0])}`, body))
        break
      }
      case 'query': {
        need(args, 2, 'query <id> <summary|validate|rooms|walls|artboard> [--artboard <aid>]')
        const kinds = ['summary', 'validate', 'rooms', 'walls', 'artboard']
        if (!kinds.includes(args[1])) throw new CliError(`Query kind must be one of ${kinds.join(', ')}`)
        const body = { kind: args[1] }
        if (flags.artboard) body.artboardId = flags.artboard
        printJson(await call('POST', `/api/projects/${enc(args[0])}/query`, body))
        break
      }
      case 'exec': {
        need(args, 2, 'exec <id> <jsonOrFile> [--dry-run] [--base-version <n>]')
        const parsed = readJsonArg(args[1])
        const body = Array.isArray(parsed) ? { commands: parsed } : { command: parsed }
        if (flags['dry-run']) body.dryRun = true
        const bv = parseBaseVersion(flags)
        if (bv !== undefined) body.baseVersion = bv
        printJson(await call('POST', `/api/projects/${enc(args[0])}/commands`, body))
        break
      }
      case 'render': {
        need(args, 1, 'render <id> [out.svg] [--artboard <aid>]')
        const q = flags.artboard ? `?artboard=${enc(flags.artboard)}` : ''
        writeOrPrint(args[1], await call('GET', `/api/projects/${enc(args[0])}/render.svg${q}`))
        break
      }
      case 'delete':
        need(args, 1, 'delete <id>')
        printJson(await call('DELETE', `/api/projects/${enc(args[0])}`))
        break
      default:
        throw new CliError(`Unknown command: ${command}\n\n${USAGE}`)
    }
    return 0
  } catch (e) {
    err(`error: ${e instanceof Error ? e.message : String(e)}\n`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2))
}
