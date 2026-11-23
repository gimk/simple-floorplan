#!/usr/bin/env node
// sfp — zero-dependency CLI for the Simple Floorplan HTTP API (Node >= 18).
//
// Config (environment):
//   SFP_URL       Base URL of the API, default http://localhost:8788
//   SFP_TOKEN     Bearer token  -> "Authorization: Bearer <token>"
//   SFP_PASSCODE  Passcode      -> "x-passcode: <passcode>" (what the API checks)
//
// Commands:
//   projects                                  List projects
//   pull <project> [--format sfp|json] [-o f]  Download a plan (.sfp DSL or JSON)
//   push <project> <file.sfp> [--dry-run]     Replace geometry from a .sfp file
//   query <project> summary|unmeasured|validate|shared_walls [--room CODE] [--json]
//   run <project> <commands.json> [--dry-run] Execute a command batch
//   export <project> svg|dxf -o <file>        Export a render
//   measure <project> <label> <cm> [--source S] Set one on-site measurement (e.g. SE-2 412.5 --source laser)

import { readFile, writeFile } from 'node:fs/promises'

const BASE = (process.env.SFP_URL || 'http://localhost:8788').replace(/\/+$/, '')

/** Measurement sources the API accepts (docs/walls-plan.md phase 3a). */
const SOURCES = ['tape', 'laser', 'plan', 'other']

function headers(extra = {}) {
  const h = { ...extra }
  if (process.env.SFP_TOKEN) h.authorization = `Bearer ${process.env.SFP_TOKEN}`
  if (process.env.SFP_PASSCODE) h['x-passcode'] = process.env.SFP_PASSCODE
  return h
}

async function api(method, path, { body, raw = false } = {}) {
  const isText = typeof body === 'string'
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(isText ? { 'content-type': 'text/plain; charset=utf-8' } : body !== undefined ? { 'content-type': 'application/json' } : {}),
    body: body === undefined ? undefined : isText ? body : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try {
      const j = JSON.parse(text)
      detail = j.error + (j.message ? `: ${j.message}` : '') + (j.line ? ` (line ${j.line})` : '')
    } catch { /* keep raw */ }
    throw new Error(`HTTP ${res.status} ${res.statusText} — ${detail}`)
  }
  if (raw) return text
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Parse argv into { positional: [...], flags: { key: value|true } }. */
function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // Accept both "--flag value" / "--flag=value" and short "-o value".
    if (a.length > 1 && a.startsWith('-') && !/^-[0-9]/.test(a)) {
      const name = a.replace(/^-+/, '')
      const eq = name.indexOf('=')
      if (eq > 0) flags[name.slice(0, eq)] = name.slice(eq + 1)
      else if (i + 1 < argv.length && !(argv[i + 1].length > 1 && argv[i + 1].startsWith('-') && !/^-[0-9]/.test(argv[i + 1]))) flags[name] = argv[++i]
      else flags[name] = true
    } else positional.push(a)
  }
  return { positional, flags }
}

const USAGE = `sfp — Simple Floorplan CLI

Usage:
  sfp projects
  sfp pull <project> [--format sfp|json] [-o file]
  sfp push <project> <file.sfp> [--dry-run]
  sfp query <project> summary|unmeasured|validate|shared_walls [--room CODE] [--json]
  sfp run <project> <commands.json> [--dry-run]
  sfp export <project> svg|dxf -o file
  sfp measure <project> <label> <cm> [--source tape|laser|plan|other]

Env: SFP_URL (default http://localhost:8788), SFP_TOKEN (Bearer), SFP_PASSCODE (x-passcode)
`

function print(value, asJson) {
  if (asJson || typeof value !== 'string') console.log(JSON.stringify(value, null, 2))
  else console.log(value)
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const { positional, flags } = parseArgs(rest)
  const asJson = Boolean(flags.json)

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      console.log(USAGE)
      return

    case 'projects':
    case 'list': {
      const list = await api('GET', '/api/projects')
      if (asJson) return print(list, true)
      for (const p of list) console.log(`${p.id}\t${p.name}${p.title ? ` — ${p.title}` : ''}\t${p.updatedAt}`)
      return
    }

    case 'pull': {
      const [project] = positional
      if (!project) throw new Error('pull requires <project>')
      const format = flags.format || 'sfp'
      if (format !== 'sfp' && format !== 'json') throw new Error(`unknown --format ${format} (sfp|json)`)
      const text =
        format === 'sfp'
          ? await api('GET', `/api/projects/${encodeURIComponent(project)}/plan.sfp`, { raw: true })
          : JSON.stringify(await api('GET', `/api/projects/${encodeURIComponent(project)}`), null, 2)
      if (flags.o) {
        await writeFile(flags.o, text)
        console.log(`wrote ${flags.o} (${text.length} bytes)`)
      } else {
        process.stdout.write(text.endsWith('\n') ? text : text + '\n')
      }
      return
    }

    case 'push': {
      const [project, file] = positional
      if (!project || !file) throw new Error('push requires <project> <file.sfp>')
      const text = await readFile(file, 'utf8')
      const qs = flags['dry-run'] ? '?dryRun=1' : ''
      const res = await api('PUT', `/api/projects/${encodeURIComponent(project)}/plan.sfp${qs}`, { body: text })
      if (asJson) return print(res, true)
      if (res.dryRun) console.log(`dry-run OK (version ${res.version}): ${JSON.stringify(res.diff)}`)
      else console.log(`pushed ${file} -> ${project} (version ${res.version}): ${JSON.stringify(res.diff)}`)
      return
    }

    case 'query': {
      const [project, q] = positional
      if (!project || !q) throw new Error('query requires <project> <summary|unmeasured|validate|shared_walls>')
      const args = {}
      if (flags.room) args.roomCode = flags.room
      const res = await api('POST', `/api/projects/${encodeURIComponent(project)}/query`, {
        body: { query: q, args: Object.keys(args).length ? args : undefined },
      })
      if (asJson) return print(res, true)
      if (q === 'summary') {
        console.log(`${res.title || project}: ${res.roomCount} rooms, indoor ${res.totalIndoorAreaM2} m2, outdoor ${res.totalOutdoorAreaM2} m2, measured ${res.progress.done}/${res.progress.total}`)
        for (const r of res.rooms) console.log(`  ${r.code}\t${r.name}\t${r.areaM2} m2\tceiling ${r.ceilingCm ?? '-'} cm`)
      } else if (q === 'unmeasured') {
        console.log(`${res.done}/${res.total} measured, ${res.remaining.length} remaining:`)
        for (const r of res.remaining) console.log(`  ${r.label}\t${r.roomCode} ${r.roomName}\t~${r.plannedCm ?? '?'} cm (${r.kind})`)
      } else if (q === 'validate') {
        console.log(`valid: ${res.valid}`)
        for (const w of [...res.errors, ...res.warnings]) console.log(`  [${w.severity}] ${w.code}: ${w.message}`)
      } else {
        print(res, true)
      }
      return
    }

    case 'run': {
      const [project, file] = positional
      if (!project || !file) throw new Error('run requires <project> <commands.json>')
      const payload = JSON.parse(await readFile(file, 'utf8'))
      if (flags['dry-run'] && payload.dryRun === undefined) payload.dryRun = true
      const res = await api('POST', `/api/projects/${encodeURIComponent(project)}/commands`, { body: payload })
      if (asJson) return print(res, true)
      console.log(`${res.dryRun ? 'dry-run' : 'applied'} ${res.results?.length ?? 0} command(s) -> version ${res.version}`)
      for (const r of res.results ?? []) console.log(`  ${JSON.stringify(r)}`)
      return
    }

    case 'export': {
      const [project, format] = positional
      if (!project || !format) throw new Error('export requires <project> <svg|dxf> -o <file>')
      if (format !== 'svg' && format !== 'dxf') throw new Error(`export supports svg|dxf, got "${format}"`)
      if (!flags.o) throw new Error('export requires -o <file>')
      const path = format === 'svg' ? `/api/projects/${encodeURIComponent(project)}/render.svg` : `/api/projects/${encodeURIComponent(project)}/plan.dxf`
      const text = await api('GET', path, { raw: true })
      await writeFile(flags.o, text)
      console.log(`wrote ${flags.o} (${text.length} bytes)`)
      return
    }

    case 'measure': {
      const [project, label, cm] = positional
      if (!project || !label || cm === undefined) throw new Error('measure requires <project> <label> <cm>')
      const actualCm = Number(cm)
      if (!Number.isFinite(actualCm) || actualCm <= 0) throw new Error(`<cm> must be a positive number, got "${cm}"`)
      // How the value was measured: it sets the weight of the value in the solver.
      // Without --source the API stores no source, which means tape.
      const source = flags.source
      if (source !== undefined && !SOURCES.includes(source)) {
        throw new Error(`--source must be one of ${SOURCES.join('|')}, got "${source}"`)
      }
      const res = await api('PUT', `/api/projects/${encodeURIComponent(project)}/measurements/${encodeURIComponent(label)}`, {
        body: { actualCm, updatedAt: new Date().toISOString(), ...(source ? { source } : {}) },
      })
      if (asJson) return print(res, true)
      console.log(`${res.ignored ? 'ignored (older)' : 'set'} ${label} = ${actualCm} cm${source ? ` (${source})` : ''}`)
      return
    }

    default:
      console.error(`unknown command "${cmd}"\n`)
      console.log(USAGE)
      process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(`sfp: ${err.message}`)
  process.exitCode = 1
})
