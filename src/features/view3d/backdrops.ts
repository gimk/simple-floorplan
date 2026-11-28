// Backdrops of the 3D Views mode. Imported ONLY by View3D.tsx so that 'three' stays in the lazy 3D chunk.
// 'dark' / 'light': solid colour + studio lights. 'daylight' / 'city': a procedural equirectangular panorama
// used as scene.background and, pre-filtered by PMREMGenerator, as scene.environment (image-based lighting).
// No fog, no sky dome mesh, no ground mesh, no 3D city meshes: everything is painted into one canvas texture.
import * as THREE from 'three'
import type { ViewBackdrop } from '../../shell/uiStore'

const TEX_W = 2048
const TEX_H = 1024

const SOLID = { dark: '#12161b', light: '#f4f5f7' } as const

/** Page colour shown behind the canvas (before WebGL paints). */
export function backdropCssColor(b: ViewBackdrop): string {
  if (b === 'dark' || b === 'light') return SOLID[b]
  return b === 'daylight' ? '#8fc4ee' : '#b9cfe3'
}

/** Lights that the backdrop re-tunes. */
export type BackdropLights = { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight; fill: THREE.DirectionalLight }

type LightPreset = { hemi: number; hemiSky: number; hemiGround: number; sun: number; sunColor: number; fill: number }
const STUDIO: LightPreset = { hemi: 1.0, hemiSky: 0xffffff, hemiGround: 0x8890a0, sun: 1.5, sunColor: 0xffffff, fill: 0.4 }
const DAYLIGHT: LightPreset = { hemi: 0.35, hemiSky: 0xcfe6ff, hemiGround: 0xb59f80, sun: 1.7, sunColor: 0xfff1d8, fill: 0.15 }
const CITY: LightPreset = { hemi: 0.4, hemiSky: 0xd6e4f2, hemiGround: 0x9a9aa0, sun: 1.6, sunColor: 0xfff4e4, fill: 0.2 }

/** Deterministic PRNG (mulberry32): the panoramas are identical on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const cv = document.createElement('canvas')
  cv.width = TEX_W
  cv.height = TEX_H
  const ctx = cv.getContext('2d')
  return ctx ? { cv, ctx } : null
}

/** Pixel position of a direction: azimuth phi (rad, atan2(z, x)) and elevation theta (rad). */
const pxX = (phi: number) => (((phi / (2 * Math.PI) + 0.5) % 1) + 1) % 1 * TEX_W
const pxY = (theta: number) => (0.5 - theta / Math.PI) * TEX_H

/** Soft cumulus: overlapping radial puffs, drawn flat with a warm-white lit top and a cool grey base. */
function paintClouds(ctx: CanvasRenderingContext2D, rand: () => number, count: number, yMin: number, yMax: number, alpha: number) {
  for (let i = 0; i < count; i++) {
    const cx = rand() * TEX_W
    const cy = yMin + rand() * (yMax - yMin)
    const scale = 0.6 + rand() * 0.9
    const puffs = 7 + Math.floor(rand() * 6)
    for (let p = 0; p < puffs; p++) {
      const px = cx + (rand() - 0.5) * 190 * scale
      const py = cy + (rand() - 0.5) * 26 * scale
      const r = (26 + rand() * 40) * scale
      for (const ox of [0, -TEX_W, TEX_W]) {
        const g = ctx.createRadialGradient(px + ox, py - r * 0.25, r * 0.1, px + ox, py, r)
        g.addColorStop(0, `rgba(255,255,255,${alpha})`)
        g.addColorStop(0.55, `rgba(246,249,255,${alpha * 0.55})`)
        g.addColorStop(1, 'rgba(235,242,252,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(px + ox, py, r * 1.5, r * 0.8, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

function paintSun(ctx: CanvasRenderingContext2D, x: number, y: number) {
  for (const ox of [0, -TEX_W, TEX_W]) {
    const halo = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, 260)
    halo.addColorStop(0, 'rgba(255,248,224,0.9)')
    halo.addColorStop(0.15, 'rgba(255,240,200,0.45)')
    halo.addColorStop(0.5, 'rgba(255,236,190,0.12)')
    halo.addColorStop(1, 'rgba(255,236,190,0)')
    ctx.fillStyle = halo
    ctx.fillRect(x + ox - 280, y - 280, 560, 560)
    ctx.fillStyle = '#fffdf2'
    ctx.beginPath()
    ctx.ellipse(x + ox, y, 26, 26, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Periodic ridge height (px) over the full width: integer frequencies so the seam is invisible. */
function ridge(x: number, seed: number, base: number, amp: number): number {
  const t = (x / TEX_W) * Math.PI * 2
  const rand = rng(seed)
  let h = 0
  let norm = 0
  for (let k = 0; k < 5; k++) {
    const f = 3 + Math.floor(rand() * 9) + k * 4
    const ph = rand() * Math.PI * 2
    const a = 1 / (1 + k * 0.9)
    h += Math.sin(t * f + ph) * a
    norm += a
  }
  return base + (h / norm) * amp
}

function paintRidge(ctx: CanvasRenderingContext2D, horizon: number, seed: number, base: number, amp: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, horizon + 4)
  for (let x = 0; x <= TEX_W; x += 4) ctx.lineTo(x, horizon - ridge(x, seed, base, amp))
  ctx.lineTo(TEX_W, horizon + 4)
  ctx.closePath()
  ctx.fill()
}

/** Sky gradient to the horizon, ground gradient below it. */
function paintSkyGround(ctx: CanvasRenderingContext2D, sky: [number, string][], ground: [number, string][]) {
  const h = TEX_H / 2
  const sg = ctx.createLinearGradient(0, 0, 0, h)
  for (const [o, c] of sky) sg.addColorStop(o, c)
  ctx.fillStyle = sg
  ctx.fillRect(0, 0, TEX_W, h)
  const gg = ctx.createLinearGradient(0, h, 0, TEX_H)
  for (const [o, c] of ground) gg.addColorStop(o, c)
  ctx.fillStyle = gg
  ctx.fillRect(0, h, TEX_W, h)
}

function paintDaylight(ctx: CanvasRenderingContext2D, sunPx: { x: number; y: number }) {
  const horizon = TEX_H / 2
  paintSkyGround(
    ctx,
    [[0, '#1f6fc4'], [0.35, '#4a9be0'], [0.7, '#8cc6f0'], [0.93, '#cfe6f6'], [1, '#f7ebd0']],
    [[0, '#b9ae8c'], [0.15, '#a99d7c'], [1, '#8b8266']],
  )
  const rand = rng(20261128)
  paintClouds(ctx, rand, 16, horizon * 0.25, horizon * 0.78, 0.9)
  paintClouds(ctx, rand, 10, horizon * 0.78, horizon * 0.92, 0.55)
  paintSun(ctx, sunPx.x, sunPx.y)
  // Distant rolling hills and a treeline, hazier with distance.
  paintRidge(ctx, horizon, 11, 26, 18, '#a9c3cf')
  paintRidge(ctx, horizon, 29, 14, 14, '#86a58f')
  paintRidge(ctx, horizon, 47, 6, 7, '#5f8a62')
  // Treeline: small deterministic bumps.
  const tr = rng(77)
  ctx.fillStyle = '#4b7551'
  for (let x = 0; x < TEX_W; x += 6) {
    const r = 3 + tr() * 5
    ctx.beginPath()
    ctx.ellipse(x, horizon - ridge(x, 47, 6, 7) + 1, r, r * 1.2, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

function paintCity(ctx: CanvasRenderingContext2D) {
  const horizon = TEX_H / 2
  paintSkyGround(
    ctx,
    [[0, '#3f86cf'], [0.4, '#78b4e6'], [0.8, '#bcdaf0'], [1, '#e9eef0']],
    [[0, '#a9a9a6'], [0.2, '#97978f'], [1, '#7a7a76']],
  )
  const rand = rng(424242)
  paintClouds(ctx, rand, 14, horizon * 0.2, horizon * 0.75, 0.85)
  const palettes = {
    far: { bodies: ['#c4ced8', '#cdd5dc', '#bcc7d2'], win: 'rgba(235,242,248,0.35)' },
    mid: { bodies: ['#8d99a8', '#a39a8d', '#7f8d9c', '#b0a898'], win: 'rgba(214,230,244,0.5)' },
    near: { bodies: ['#5f6c7b', '#7b7467', '#506070', '#8a8272', '#6a7684'], win: 'rgba(200,222,240,0.6)' },
  }
  const layer = (seed: number, p: { bodies: string[]; win: string }, minW: number, maxW: number, minH: number, maxH: number, gap: number, grid: number, glow: boolean) => {
    const r = rng(seed)
    let x = 0
    while (x < TEX_W) {
      const w = minW + r() * (maxW - minW)
      const h = minH + Math.pow(r(), 1.6) * (maxH - minH)
      const body = p.bodies[Math.floor(r() * p.bodies.length)]
      const top = horizon - h
      for (const ox of [0, -TEX_W]) {
        ctx.fillStyle = body
        ctx.fillRect(x + ox, top, w, h + 3)
        if (grid > 0) {
          // Architectural window grid.
          ctx.fillStyle = p.win
          const cw = grid, ch = grid * 1.5
          for (let wy = top + 6; wy < horizon - ch; wy += ch + 4) {
            for (let wx = x + ox + 4; wx < x + ox + w - cw - 2; wx += cw + 3) {
              if (r() > 0.12) ctx.fillRect(wx, wy, cw, ch)
            }
          }
        }
        if (glow) {
          ctx.fillStyle = 'rgba(255,255,255,0.1)'
          ctx.fillRect(x + ox, top, w * 0.3, h + 3)
        }
        // Roof cap on some towers.
        if (r() > 0.6) {
          ctx.fillStyle = body
          ctx.fillRect(x + ox + w * 0.35, top - 8, w * 0.3, 8)
        }
      }
      x += w + r() * gap
    }
  }
  layer(5, palettes.far, 26, 60, 18, 60, 6, 0, false)
  layer(9, palettes.mid, 30, 70, 22, 90, 4, 4, true)
  layer(13, palettes.near, 40, 90, 20, 110, 2, 5, true)
  // Haze band at the horizon, then the paved ground edge.
  const haze = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 2)
  haze.addColorStop(0, 'rgba(235,240,244,0)')
  haze.addColorStop(1, 'rgba(235,240,244,0.35)')
  ctx.fillStyle = haze
  ctx.fillRect(0, horizon - 40, TEX_W, 42)
}

/** Paint the panorama of a HDRI-style backdrop into a canvas texture. Null when no 2D canvas is available. */
function makePanorama(kind: 'daylight' | 'city', sunDir: THREE.Vector3): THREE.CanvasTexture | null {
  const c = makeCanvas()
  if (!c) return null
  const sx = pxX(Math.atan2(sunDir.z, sunDir.x))
  const sy = pxY(Math.asin(Math.max(-1, Math.min(1, sunDir.y))))
  if (kind === 'daylight') paintDaylight(c.ctx, { x: sx, y: sy })
  else paintCity(c.ctx)
  const tex = new THREE.CanvasTexture(c.cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.mapping = THREE.EquirectangularReflectionMapping
  tex.needsUpdate = true
  return tex
}

export type BackdropController = {
  apply: (kind: ViewBackdrop) => void
  /** After a WebGL context restore: GPU copies are gone, so rebuild the active backdrop from scratch. */
  restore: () => void
  dispose: () => void
}

/**
 * Applies a backdrop to a scene live (no renderer rebuild). One PMREMGenerator per renderer, created lazily.
 * The scene sun direction (sun.position relative to its target) is used to place the painted sun disc.
 */
export function createBackdropController(renderer: THREE.WebGLRenderer, scene: THREE.Scene, lights: BackdropLights): BackdropController {
  let pmrem: THREE.PMREMGenerator | null = null
  let bgTex: THREE.CanvasTexture | null = null
  let envRT: THREE.WebGLRenderTarget | null = null
  let current: ViewBackdrop = 'dark'

  const releaseMaps = () => {
    bgTex?.dispose()
    envRT?.dispose()
    bgTex = null
    envRT = null
  }

  const tune = (p: LightPreset) => {
    lights.hemi.intensity = p.hemi
    lights.hemi.color.set(p.hemiSky)
    lights.hemi.groundColor.set(p.hemiGround)
    lights.sun.intensity = p.sun
    lights.sun.color.set(p.sunColor)
    lights.fill.intensity = p.fill
  }

  const material = () => {
    // Materials read scene.environment at compile time: ask for a recompile when it changes.
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true })
      else if (m) m.needsUpdate = true
    })
  }

  const solid = (kind: 'dark' | 'light') => {
    releaseMaps()
    scene.background = new THREE.Color(SOLID[kind])
    scene.environment = null
    scene.backgroundBlurriness = 0
    scene.environmentIntensity = 1
    tune(STUDIO)
  }

  return {
    apply(kind) {
      current = kind
      scene.fog = null
      if (kind === 'dark' || kind === 'light') {
        solid(kind)
        material()
        return
      }
      const sunDir = lights.sun.position.clone().sub(lights.sun.target.position).normalize()
      const tex = makePanorama(kind, sunDir)
      if (!tex) { solid('light'); material(); return }
      releaseMaps()
      bgTex = tex
      if (!pmrem) pmrem = new THREE.PMREMGenerator(renderer)
      envRT = pmrem.fromEquirectangular(bgTex)
      scene.background = bgTex
      scene.environment = envRT.texture
      scene.backgroundBlurriness = kind === 'daylight' ? 0.04 : 0.03
      scene.environmentIntensity = 0.65
      tune(kind === 'daylight' ? DAYLIGHT : CITY)
      material()
    },
    restore() {
      // The old PMREM generator and render target belong to the lost context: drop them without GPU calls that matter.
      pmrem?.dispose()
      pmrem = null
      this.apply(current)
    },
    dispose() {
      scene.background = null
      scene.environment = null
      releaseMaps()
      pmrem?.dispose()
      pmrem = null
    },
  }
}
