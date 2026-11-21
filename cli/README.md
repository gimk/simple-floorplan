# sfp — Simple Floorplan CLI

Zero-dependency Node.js (>= 18) command-line client for the Simple Floorplan HTTP API.
It talks to the same `/api/*` endpoints as the web app, so it works against a local
`wrangler dev` server, a deployed Cloudflare Worker, or any compatible URL.
Deployed base URL until the custom domain is attached:
`https://simple-floorplan.<account-subdomain>.workers.dev`.

Install / link: the package declares `"bin": { "sfp": "cli/sfp.mjs" }`, so after
`npm install` (or `npm link`) the `sfp` command is on your PATH. You can also run it
directly: `node cli/sfp.mjs <command>`.

## Configuration (environment variables)

| Variable      | Meaning                                             |
|---------------|-----------------------------------------------------|
| `SFP_URL`     | API base URL. Default `http://localhost:8788`      |
| `SFP_TOKEN`   | Sent as `Authorization: Bearer <token>`             |
| `SFP_PASSCODE`| Sent as `x-passcode: <passcode>` (what the API checks) |

## Commands

```bash
sfp projects                                   # list projects
sfp pull <project> [--format sfp|json] [-o f]  # download plan (.sfp DSL by default)
sfp push <project> <file.sfp> [--dry-run]      # replace geometry from a .sfp file
sfp query <project> summary|unmeasured|validate|shared_walls [--room CODE] [--json]
sfp run <project> <commands.json> [--dry-run]  # execute a command batch
sfp export <project> svg|dxf -o <file>         # export a render
sfp measure <project> <label> <cm>             # set one measurement, e.g. sfp measure proj_1 SE-2 412.5
```

Examples:

```bash
export SFP_URL=https://simple-floorplan.<account-subdomain>.workers.dev SFP_PASSCODE=secret
sfp projects
sfp pull proj_abc > apartment.sfp        # human-readable, git-diffable text
$EDITOR apartment.sfp
sfp push proj_abc apartment.sfp --dry-run # show a diff summary, write nothing
sfp push proj_abc apartment.sfp           # apply (new snapshot version)
sfp query proj_abc unmeasured
sfp query proj_abc validate --json
sfp export proj_abc dxf -o plan.dxf
sfp measure proj_abc CU-H 264
```

## Exit codes

`0` on success, `1` on any error (HTTP errors include the server's `error`/`message`
and, for DSL parse failures, the `line` number).
