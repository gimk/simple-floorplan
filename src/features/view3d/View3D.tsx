// 3D Views mode renderer (docs/3d-and-finishes.md). Draws the SceneData of buildScene with Three.js.
// Loaded lazily from App.tsx so that 'three' stays out of the 2D entry bundle.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useDoc } from '../../model/store'
import type { ViewProjection } from '../../model/types'
import { useUi } from '../../shell/uiStore'
import type { ViewBackdrop } from '../../shell/uiStore'
import { DEFAULT_WALL_OUTER_COLOR, buildScene, clipSpanToHeight, computeWallTargetHeights, wallSideOffsets } from './buildScene'
import type { FloorMeshData, SceneData, WallSegmentData } from './buildScene'
import type { FurniturePartData } from './furnitureSolids'
import { PRESET_FOV, computePresetPose } from './cameraPresets'
import type { CameraSnapshot, View3DHandle } from './cameraPresets'
import { backdropCssColor, createBackdropController } from './backdrops'
import type { BackdropController } from './backdrops'
import { FLOOR_TILE_CM, floorBaseColor, disposeAll, getFloorTexture } from './floorTextures'

const FOV = PRESET_FOV
const FLY_MS = 450
const PNG_WIDTH = 1920
const PNG_HEIGHT = 1080
const INTRO_MS = 650
const END_ELEV = (48 * Math.PI) / 180
const START_ELEV = (88 * Math.PI) / 180
const AZIMUTH = 0.55
const MIN_SCALE = 0.001
const THRESHOLD_Y = 0.05
const EDGE_OPACITY = 0.2
const THUMB_WIDTH = 320
const THUMB_HEIGHT = 180

const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
const range = (ms: number, from: number, to: number) => easeOut((ms - from) / (to - from))

/** A running camera flight: eased from one pose to another (ortho also eases the visible half-height). */
type Flight = { t0: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromVis: number; toVis: number }

type Api = { setProjection: (p: ViewProjection) => void; setBackdrop: (b: ViewBackdrop) => void; setShadows: (on: boolean) => void }
type SavedCamera = { artboardId: string; pos: THREE.Vector3; target: THREE.Vector3; orthoHalfH: number; zoom: number }

/** Floor-plane outline of a floor or threshold as a Shape in (x, -z), so rotateX(-PI/2) lays it on XZ facing +Y. */
function flatGeometry(
  verts: { x: number; z: number }[],
  pattern: FloorMeshData['floorPattern'],
  angleDeg: number | undefined,
  y: number,
): THREE.BufferGeometry {
  const shape = new THREE.Shape(verts.map((p) => new THREE.Vector2(p.x, -p.z)))
  const geo = new THREE.ShapeGeometry(shape)
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, y, 0)
  const tile = pattern && pattern !== 'solid' ? FLOOR_TILE_CM[pattern] : null
  if (tile) {
    // UV = position in cm, turned by the pattern angle (SVG rotate is clockwise on screen), in tile units.
    const a = ((angleDeg ?? 0) * Math.PI) / 180
    const cos = Math.cos(a), sin = Math.sin(a)
    const pos = geo.getAttribute('position')
    const uv = new Float32Array(pos.count * 2)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i)
      uv[i * 2] = (x * cos + z * sin) / tile.w
      uv[i * 2 + 1] = -(-x * sin + z * cos) / tile.h
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  }
  return geo
}

/** Rounded-corner slab: `w` by `d` footprint (radii order tl, tr, br, bl), `h` tall, centred on the origin. */
function roundedBoxGeometry(w: number, h: number, d: number, radii: [number, number, number, number]): THREE.BufferGeometry {
  const [tl, tr, br, bl] = radii
  if (tl + tr + br + bl <= 0) return new THREE.BoxGeometry(w, h, d)
  const hw = w / 2, hd = d / 2
  // Shape in (x, -z): the top of the 2D plan is -z, so it is +y here.
  const s = new THREE.Shape()
  s.moveTo(-hw + bl, -hd)
  s.lineTo(hw - br, -hd)
  if (br > 0) s.quadraticCurveTo(hw, -hd, hw, -hd + br)
  s.lineTo(hw, hd - tr)
  if (tr > 0) s.quadraticCurveTo(hw, hd, hw - tr, hd)
  s.lineTo(-hw + tl, hd)
  if (tl > 0) s.quadraticCurveTo(-hw, hd, -hw, hd - tl)
  s.lineTo(-hw, -hd + bl)
  if (bl > 0) s.quadraticCurveTo(-hw, -hd, -hw + bl, -hd)
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 10 })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, -h / 2, 0)
  return geo
}

/** Geometry of one furniture part, centred on its own origin (the mesh is moved to the part centre). */
function partGeometry(p: FurniturePartData): THREE.BufferGeometry {
  if (p.kind === 'cylinder') {
    const geo = new THREE.CylinderGeometry(p.sx / 2, p.sx / 2, p.sy, 24)
    if (p.sx !== p.sz && p.sx > 0) geo.scale(1, 1, p.sz / p.sx)
    if (p.rotationX) geo.rotateX(p.rotationX)
    return geo
  }
  if (p.kind === 'roundedBox' && p.cornerRadiiCm && p.cornerRadiiCm.some((r) => r > 0)) {
    return roundedBoxGeometry(p.sx, p.sy, p.sz, p.cornerRadiiCm)
  }
  return new THREE.BoxGeometry(p.sx, p.sy, p.sz)
}

/** A wall solid or glass pane that is clipped (not squashed) to the current wall height. */
type ClipPart = { meshes: THREE.Object3D[]; y0: number; y1: number }
type WallEntry = { group: THREE.Group; data: WallSegmentData; parts: ClipPart[]; ratio: number }

// Fence (balcony railing) sizes in cm: a top handrail, a bottom rail, end posts and thin balusters.
const FENCE_TOP_RAIL_H = 4
const FENCE_BOTTOM_RAIL_H = 3
const FENCE_BOTTOM_RAIL_Y = 6
const FENCE_POST_W = 3.5
const FENCE_BALUSTER_W = 2
const FENCE_BALUSTER_STEP = 18
/** A fence piece shorter than this gets one centred post instead of two end posts. */
const FENCE_MIN_POST_SPAN = 2 * FENCE_POST_W

/** Show only the part of `part` below `height` cm: scale and move it, or hide it when nothing remains. */
function applyWallHeight(part: ClipPart, height: number) {
  const span = clipSpanToHeight(part.y0, part.y1, height)
  for (const m of part.meshes) {
    m.visible = !!span
    if (!span) continue
    const full = part.y1 - part.y0
    m.scale.y = (span.y1 - span.y0) / full
    m.position.y = (span.y0 + span.y1) / 2
  }
}
type PostEntry = { group: THREE.Group; wallIds: [string, string] }

type Built = {
  scene: THREE.Scene
  sun: THREE.DirectionalLight
  hemi: THREE.HemisphereLight
  fill: THREE.DirectionalLight
  walls: WallEntry[]
  posts: PostEntry[]
  furniture: THREE.Group[]
  dispose: () => void
}

function buildThreeScene(data: SceneData, shadows: boolean): Built {
  const scene = new THREE.Scene()
  const b = data.bounds
  const R = Math.max(Math.hypot(b.sizeX, b.sizeZ) / 2, 100)

  // Lights.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.0)
  scene.add(hemi)
  const sun = new THREE.DirectionalLight(0xffffff, 1.5)
  sun.position.set(b.centerX + R * 0.8, R * 1.8, b.centerZ + R * 0.5)
  sun.target.position.set(b.centerX, 0, b.centerZ)
  sun.castShadow = shadows
  const sc = sun.shadow.camera
  const ext = R * 1.3
  sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext
  sc.near = 1; sc.far = R * 5
  sc.updateProjectionMatrix() // not automatic: without it the shadow frustum stays at its +-5 default
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.6
  scene.add(sun, sun.target)
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.4)
  fill.position.set(b.centerX - R, R * 0.8, b.centerZ - R * 0.6)
  fill.target.position.set(b.centerX, 0, b.centerZ)
  scene.add(fill, fill.target)

  const materials = new Map<string, THREE.Material>()
  const mat = (key: string, make: () => THREE.Material) => {
    let m = materials.get(key)
    if (!m) { m = make(); materials.set(key, m) }
    return m
  }
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
    mat(`std|${color}|${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra }))
  const edgeMat = mat('edge', () => new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: EDGE_OPACITY }))
  const glassMat = mat('glass', () => new THREE.MeshStandardMaterial({
    color: 0x9fd3ff, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.1, depthWrite: false,
  }))
  const geometries: THREE.BufferGeometry[] = []
  const geo = <T extends THREE.BufferGeometry>(g: T): T => { geometries.push(g); return g }

  // Floors and door thresholds.
  // Thresholds sit 0.5 mm above the floor: pull them towards the camera so they never z-fight at far zoom.
  const THRESHOLD_OFFSET = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }
  const floorMaterial = (pattern: FloorMeshData['floorPattern'], fill: string | undefined, threshold = false) => {
    const extra: THREE.MeshStandardMaterialParameters = threshold ? THRESHOLD_OFFSET : {}
    const suffix = threshold ? '|threshold' : ''
    const tex = getFloorTexture(pattern, fill)
    if (tex) return mat(`floor|${pattern}|${fill ?? ''}${suffix}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0, ...extra }))
    return mat(`floor|solid|${fill ?? ''}${suffix}`, () => new THREE.MeshStandardMaterial({ color: floorBaseColor(fill), roughness: 0.9, metalness: 0, ...extra }))
  }
  for (const f of data.floors) {
    const m = new THREE.Mesh(geo(flatGeometry(f.vertices, f.floorPattern, f.floorPatternAngleDeg, 0)), floorMaterial(f.floorPattern, f.fill))
    m.receiveShadow = true
    scene.add(m)
  }
  for (const t of data.thresholds) {
    const m = new THREE.Mesh(geo(flatGeometry(t.vertices, t.floorPattern, t.floorPatternAngleDeg, THRESHOLD_Y)), floorMaterial(t.floorPattern, t.fill, true))
    m.receiveShadow = true
    scene.add(m)
  }

  // Walls: a pivot group at the wall start, on the floor. Scaling its y animates the height.
  const walls: WallEntry[] = []
  for (const w of data.walls) {
    const group = new THREE.Group()
    const dx = w.end.x - w.start.x, dz = w.end.z - w.start.z
    const theta = Math.atan2(-dz, dx)
    group.position.set(w.start.x, 0, w.start.z)
    group.rotation.y = theta
    const s = w.outwardNormal.x * Math.sin(theta) + w.outwardNormal.z * Math.cos(theta) >= 0 ? 1 : -1
    const [o0, o1] = wallSideOffsets(w)
    const zc = (s * (o0 + o1)) / 2
    // Push wall faces back a little so the edge lines never z-fight with them.
    const pushBack = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }
    const inner = std(w.innerColor, pushBack), outer = std(w.outerColor, pushBack)
    // Face away from the room: the paint of the room on the other side of a shared wall, else the outer paint.
    const opposite = w.oppositeColor ? std(w.oppositeColor, pushBack) : outer
    const parts: ClipPart[] = []
    const mats = [outer, outer, outer, outer, s > 0 ? opposite : inner, s > 0 ? inner : opposite]
    // A fence bar (rail, post or baluster): a small box centred at (x, y) that clips on its own span.
    const bar = (bw: number, bh: number, bd: number, x: number, y: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(geo(new THREE.BoxGeometry(bw, bh, bd)), m)
      mesh.position.set(x, y, zc)
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      parts.push({ meshes: [mesh], y0: y - bh / 2, y1: y + bh / 2 })
    }
    if (w.kind === 'fence') {
      // Balcony railing: a handrail, a bottom rail, end posts and thin balusters, no solid slab.
      const railMat = std(w.innerColor, pushBack)
      const railDepth = Math.min(12, Math.max(3, w.thicknessCm * 1.5))
      for (const p of w.pieces) {
        const span = p.u1 - p.u0, full = p.y1 - p.y0
        if (span <= 0 || full <= 0) continue
        const midU = (p.u0 + p.u1) / 2
        // Top handrail, kept inside the piece when the piece is short.
        const topH = Math.min(FENCE_TOP_RAIL_H, full)
        const topRailBottom = p.y1 - topH
        bar(span, topH, railDepth, midU, p.y1 - topH / 2, railMat)
        // Bottom rail, only when the piece is tall enough to show the open gap above it.
        const hasBottom = full > 12
        if (hasBottom) bar(span, FENCE_BOTTOM_RAIL_H, railDepth * 0.85, midU, p.y0 + FENCE_BOTTOM_RAIL_Y, railMat)
        const barBottom = hasBottom ? p.y0 + FENCE_BOTTOM_RAIL_Y + FENCE_BOTTOM_RAIL_H / 2 : p.y0
        // End posts over the full height of the piece, or one centred post on a very short piece.
        const postY = (p.y0 + p.y1) / 2
        if (span > FENCE_MIN_POST_SPAN) {
          bar(FENCE_POST_W, full, railDepth, p.u0 + FENCE_POST_W / 2, postY, railMat)
          bar(FENCE_POST_W, full, railDepth, p.u1 - FENCE_POST_W / 2, postY, railMat)
        } else bar(FENCE_POST_W, full, railDepth, midU, postY, railMat)
        // Thin balusters between the bottom rail and the handrail, about FENCE_BALUSTER_STEP apart.
        const from = p.u0 + FENCE_POST_W * 1.5, to = p.u1 - FENCE_POST_W * 1.5
        const n = to - from > FENCE_BALUSTER_W ? Math.floor((to - from) / FENCE_BALUSTER_STEP) : 0
        if (n > 0 && topRailBottom - barBottom > 1) {
          const h = topRailBottom - barBottom
          for (let i = 1; i <= n; i++) {
            bar(FENCE_BALUSTER_W, h, FENCE_BALUSTER_W, from + ((to - from) * i) / (n + 1), (barBottom + topRailBottom) / 2, railMat)
          }
        }
      }
    } else {
      for (const p of w.pieces) {
        const g = geo(new THREE.BoxGeometry(p.u1 - p.u0, p.y1 - p.y0, w.thicknessCm))
        const mesh = new THREE.Mesh(g, mats)
        mesh.position.set((p.u0 + p.u1) / 2, (p.y0 + p.y1) / 2, zc)
        mesh.castShadow = true
        mesh.receiveShadow = true
        group.add(mesh)
        const lines = new THREE.LineSegments(geo(new THREE.EdgesGeometry(g)), edgeMat)
        lines.position.copy(mesh.position)
        group.add(lines)
        parts.push({ meshes: [mesh, lines], y0: p.y0, y1: p.y1 })
      }
    }
    // Window and door models (frames, glass, leaves, handles, sliding panels). Each part clips to the wall height
    // like a wall piece, so a lowered wall never leaves a frame or a leaf floating above it. The window panes
    // of the wall data are drawn by the models (their glass), not a second time.
    for (const model of w.openingModels) {
      for (const p of model.parts) {
        const g = geo(new THREE.BoxGeometry(p.su, p.sy, p.sd))
        const mesh = new THREE.Mesh(g, p.kind === 'glass' ? glassMat : std(p.color, { roughness: 0.6 }))
        mesh.position.set(p.u, p.y, s * p.d)
        mesh.rotation.y = -s * p.rotation
        const meshes: THREE.Object3D[] = [mesh]
        if (p.solid) {
          mesh.castShadow = true
          mesh.receiveShadow = true
          const lines = new THREE.LineSegments(geo(new THREE.EdgesGeometry(g)), edgeMat)
          lines.position.copy(mesh.position)
          lines.rotation.copy(mesh.rotation)
          meshes.push(lines)
        } else mesh.renderOrder = 2
        group.add(...meshes)
        parts.push({ meshes, y0: p.y0, y1: p.y1 })
      }
    }
    const entry: WallEntry = { group, data: w, parts, ratio: MIN_SCALE }
    for (const part of parts) applyWallHeight(part, MIN_SCALE * w.heightCm)
    scene.add(group)
    walls.push(entry)
  }

  // Corner posts.
  const posts: PostEntry[] = []
  for (const p of data.cornerPosts) {
    const shape = new THREE.Shape(p.vertices.map((v) => new THREE.Vector2(v.x, -v.z)))
    const g = geo(new THREE.ExtrudeGeometry(shape, { depth: p.heightCm, bevelEnabled: false }))
    g.rotateX(-Math.PI / 2)
    const mesh = new THREE.Mesh(g, std(DEFAULT_WALL_OUTER_COLOR))
    mesh.castShadow = true
    mesh.receiveShadow = true
    const group = new THREE.Group()
    group.add(mesh)
    group.scale.y = MIN_SCALE
    scene.add(group)
    posts.push({ group, wallIds: p.wallIds })
  }

  // Furniture: a pivot group on the floor; each part mesh sits at its item-local position.
  const furniture: THREE.Group[] = []
  for (const f of data.furniture) {
    const group = new THREE.Group()
    group.position.set(f.x, 0, f.z)
    group.rotation.y = f.rotationY
    for (const p of f.parts) {
      const g = geo(partGeometry(p))
      const mesh = new THREE.Mesh(g, p.translucent ? glassMat : std(p.color, { roughness: 0.7 }))
      mesh.position.set(p.cx, p.cy, p.cz)
      mesh.castShadow = !p.translucent
      mesh.receiveShadow = true
      group.add(mesh)
      // Blueprint look: an edge outline on every part.
      const lines = new THREE.LineSegments(geo(new THREE.EdgesGeometry(g, 30)), edgeMat)
      lines.position.copy(mesh.position)
      group.add(lines)
    }
    group.scale.y = MIN_SCALE
    scene.add(group)
    furniture.push(group)
  }

  return {
    scene, sun, hemi, fill, walls, posts, furniture,
    dispose: () => {
      scene.traverse((o) => { if ((o as THREE.Light).isLight) (o as THREE.DirectionalLight).shadow?.dispose() })
      for (const g of geometries) g.dispose()
      for (const m of materials.values()) m.dispose()
      disposeAll()
    },
  }
}

export default function View3D({ handleRef }: { handleRef?: RefObject<View3DHandle | null> } = {}) {
  const activeId = useUi((s) => s.activeArtboardId)
  const artboards = useDoc((s) => s.doc.artboards)
  const artboard = artboards.find((a) => a.id === activeId) ?? artboards[0]
  const wallViewMode = useUi((s) => s.wallViewMode)
  const viewProjection = useUi((s) => s.viewProjection)
  const viewBackdrop = useUi((s) => s.viewBackdrop)
  const viewShadows = useUi((s) => s.viewShadows)

  const [webglFailed, setWebglFailed] = useState(false)
  const [contextLost, setContextLost] = useState(false)
  const artboardId = artboard?.id
  const scene = useMemo(() => (artboard ? buildScene(artboard) : null), [artboard])

  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<Api | null>(null)
  const wallModeRef = useRef(wallViewMode)
  const projectionRef = useRef(viewProjection)
  const backdropRef = useRef(viewBackdrop)
  const shadowsRef = useRef(viewShadows)
  const savedCamera = useRef<SavedCamera | null>(null)

  useEffect(() => { wallModeRef.current = wallViewMode }, [wallViewMode])
  useEffect(() => {
    projectionRef.current = viewProjection
    apiRef.current?.setProjection(viewProjection)
  }, [viewProjection])
  useEffect(() => {
    backdropRef.current = viewBackdrop
    apiRef.current?.setBackdrop(viewBackdrop)
  }, [viewBackdrop])

  // Shadows toggle live: no renderer rebuild, only the shadow flags and a material recompile.
  useEffect(() => {
    shadowsRef.current = viewShadows
    apiRef.current?.setShadows(viewShadows)
  }, [viewShadows])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !scene) return
    setContextLost(false)
    const built = buildThreeScene(scene, shadowsRef.current)
    const b = scene.bounds
    const R = Math.max(Math.hypot(b.sizeX, b.sizeZ) / 2, 100)
    const dist = (R / Math.sin((FOV * Math.PI) / 360)) * 0.9

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      // No WebGL (blocked, old GPU, headless): free the scene and show a message instead of crashing the app.
      built.dispose()
      setWebglFailed(true)
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = shadowsRef.current
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    const canvas = renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    container.appendChild(canvas)

    let width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight)
    const persp = new THREE.PerspectiveCamera(FOV, width / height, 5, R * 60)
    let orthoHalfH = savedCamera.current?.artboardId === artboardId ? savedCamera.current.orthoHalfH : dist * Math.tan((FOV * Math.PI) / 360)
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -R * 40, R * 40)
    const updateOrtho = () => {
      ortho.left = -orthoHalfH * (width / height); ortho.right = orthoHalfH * (width / height)
      ortho.top = orthoHalfH; ortho.bottom = -orthoHalfH
      ortho.updateProjectionMatrix()
    }
    if (savedCamera.current?.artboardId === artboardId) ortho.zoom = savedCamera.current.zoom
    updateOrtho()
    let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = projectionRef.current === 'ortho' ? ortho : persp

    const half0 = Math.tan((FOV * Math.PI) / 360)
    const target = new THREE.Vector3(b.centerX, 0, b.centerZ)
    const endTarget = target.clone()
    const place = (elev: number, d = dist, t = target) => {
      persp.position.set(
        t.x + d * Math.cos(elev) * Math.sin(AZIMUTH),
        t.y + d * Math.sin(elev),
        t.z + d * Math.cos(elev) * Math.cos(AZIMUTH),
      )
      ortho.position.copy(persp.position)
    }

    const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = !reducedMotion
    controls.enableZoom = true
    controls.enablePan = true
    controls.enableRotate = true
    controls.maxPolarAngle = Math.PI / 2 - 0.04
    controls.minPolarAngle = 0.02
    controls.minDistance = 30
    controls.maxDistance = dist * 4
    controls.minZoom = 0.2
    controls.maxZoom = 8

    const saved = savedCamera.current?.artboardId === artboardId ? savedCamera.current : null
    let intro = !saved && !reducedMotion
    let snap = !intro
    // The intro starts on the 2D pan/zoom: same centre, same visible height (2D screen = (world - view.xy) * zoom).
    // Falls back to the artboard bounds when the 2D view is unusable or far from the artboard.
    const endZoom = ortho.zoom
    const introStart = { target: endTarget.clone(), dist, zoom: ortho.zoom }
    if (intro) {
      const v = useUi.getState().view
      const cx = v.x + width / (2 * v.zoom), cz = v.y + height / (2 * v.zoom)
      const visH = height / v.zoom
      const mx = Math.max(b.sizeX * 0.5, 100), mz = Math.max(b.sizeZ * 0.5, 100)
      const usable = Number.isFinite(cx) && Number.isFinite(cz) && Number.isFinite(visH) && v.zoom > 0 && visH > 1
        && cx >= b.minX - mx && cx <= b.maxX + mx && cz >= b.minZ - mz && cz <= b.maxZ + mz
      if (usable) {
        introStart.target.set(cx, 0, cz)
        introStart.dist = Math.min(controls.maxDistance, Math.max(controls.minDistance, visH / 2 / half0))
        introStart.zoom = Math.min(controls.maxZoom, Math.max(controls.minZoom, orthoHalfH / (visH / 2)))
      }
    }
    if (saved) {
      persp.position.copy(saved.pos); ortho.position.copy(saved.pos)
      target.copy(saved.target)
    } else if (intro) {
      target.copy(introStart.target)
      place(START_ELEV, introStart.dist, target)
      ortho.zoom = introStart.zoom
    } else place(END_ELEV)
    controls.target.copy(target)
    persp.lookAt(target); ortho.lookAt(target)
    controls.update()

    let flight: Flight | null = null
    const stopIntro = () => { intro = false }
    // Any user drag, pinch or wheel takes the camera back at once.
    const stopFlight = () => { flight = null }
    controls.addEventListener('start', stopIntro)
    controls.addEventListener('start', stopFlight)

    const setProjection = (p: ViewProjection) => {
      const next = p === 'ortho' ? ortho : persp
      if (next === camera) return
      const half = Math.tan((FOV * Math.PI) / 360)
      const d = Math.max(1, camera.position.distanceTo(controls.target))
      next.position.copy(camera.position)
      next.quaternion.copy(camera.quaternion)
      if (next === ortho) {
        // Same visible height at the target as the perspective view.
        orthoHalfH = d * half
        ortho.zoom = 1
        updateOrtho()
      } else {
        // Back to perspective: pick the distance whose view matches what the zoomed ortho view shows.
        const nd = Math.min(controls.maxDistance, Math.max(controls.minDistance, orthoHalfH / ortho.zoom / half))
        persp.position.copy(controls.target).addScaledVector(camera.position.clone().sub(controls.target).normalize(), nd)
      }
      camera = next
      controls.object = camera
      controls.update()
    }
    const backdrops: BackdropController = createBackdropController(renderer, built.scene, { hemi: built.hemi, sun: built.sun, fill: built.fill })
    const setBackdrop = (bd: ViewBackdrop) => backdrops.apply(bd)
    setBackdrop(backdropRef.current)
    const setShadows = (on: boolean) => {
      renderer.shadowMap.enabled = on
      built.sun.castShadow = on
      // Materials compile with or without the shadow code: ask for a recompile.
      built.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
        if (Array.isArray(m)) m.forEach((x) => { x.needsUpdate = true })
        else if (m) m.needsUpdate = true
      })
    }
    apiRef.current = { setProjection, setBackdrop, setShadows }
    const half = Math.tan((FOV * Math.PI) / 360)

    /** Set the height of every wall (and the corner posts that follow them) from a ratio per wall. */
    const setWalls = (ratioOf: (w: WallEntry) => number) => {
      const wallScale = new Map<string, number>()
      for (const w of built.walls) {
        w.ratio = ratioOf(w)
        for (const part of w.parts) applyWallHeight(part, w.ratio * w.data.heightCm)
        wallScale.set(w.data.id, w.ratio)
      }
      for (const p of built.posts) {
        const a = wallScale.get(p.wallIds[0]) ?? 1, c = wallScale.get(p.wallIds[1]) ?? 1
        p.group.scale.y = Math.max(MIN_SCALE, Math.min(a, c))
      }
    }

    // ----- Handle: snapshot, fly-to, presets, PNG capture -----
    const getSnapshot = (): CameraSnapshot => {
      const pos = camera.position.clone()
      const t = controls.target
      if (camera === ortho) {
        // An ortho view is framed by its zoom, not by its distance: store the distance that frames the same height.
        const dir = pos.clone().sub(t)
        if (dir.lengthSq() > 0) pos.copy(t).addScaledVector(dir.normalize(), orthoHalfH / ortho.zoom / half)
      }
      const r = (n: number) => Math.round(n * 100) / 100
      return {
        position: [r(pos.x), r(pos.y), r(pos.z)],
        target: [r(t.x), r(t.y), r(t.z)],
        fov: FOV,
        projection: camera === ortho ? 'ortho' : 'perspective',
        wallMode: wallModeRef.current,
      }
    }

    const applyFlight = (f: Flight, k: number) => {
      camera.position.lerpVectors(f.fromPos, f.toPos, k)
      controls.target.lerpVectors(f.fromTarget, f.toTarget, k)
      if (camera === ortho) {
        const vis = Math.max(1e-3, f.fromVis + (f.toVis - f.fromVis) * k)
        ortho.zoom = Math.max(1e-3, orthoHalfH / vis)
        ortho.updateProjectionMatrix()
      }
    }

    const flyTo: View3DHandle['flyTo'] = (view) => {
      const ui = useUi.getState()
      if (ui.wallViewMode !== view.wallMode) ui.set({ wallViewMode: view.wallMode })
      wallModeRef.current = view.wallMode
      const proj: ViewProjection = view.projection ?? 'perspective'
      if (ui.viewProjection !== proj) ui.set({ viewProjection: proj })
      projectionRef.current = proj
      setProjection(proj)
      intro = false
      const toPos = new THREE.Vector3(...view.position)
      const toTarget = new THREE.Vector3(...view.target)
      const f: Flight = {
        t0: performance.now(),
        fromPos: camera.position.clone(), toPos,
        fromTarget: controls.target.clone(), toTarget,
        fromVis: camera === ortho ? orthoHalfH / ortho.zoom : 0,
        toVis: Math.max(1, toPos.distanceTo(toTarget)) * half,
      }
      if (reducedMotion) {
        flight = null
        applyFlight(f, 1)
        controls.update()
      } else flight = f
    }

    const applyPreset: View3DHandle['applyPreset'] = (preset) => {
      const pose = computePresetPose(scene.bounds, preset)
      flyTo({ position: pose.position, target: pose.target, wallMode: wallModeRef.current, projection: camera === ortho ? 'ortho' : 'perspective' })
    }

    let lost = false
    const capturePngBlob: View3DHandle['capturePngBlob'] = async (opts) => {
      if (lost) return null
      const W = Math.max(1, Math.round(opts?.width ?? PNG_WIDTH))
      const H = Math.max(1, Math.round(opts?.height ?? PNG_HEIGHT))
      const view = opts?.view
      const cam = view ? (view.projection === 'ortho' ? ortho : persp) : camera
      const savedPos = cam.position.clone()
      const savedQuat = cam.quaternion.clone()
      const savedZoom = ortho.zoom
      const savedRatios = new Map(built.walls.map((w) => [w, w.ratio] as const))
      const savedFurn = built.furniture.map((g) => g.scale.y)
      const prevPixelRatio = renderer.getPixelRatio()
      const setOrthoExtents = (halfH: number) => {
        ortho.left = -halfH * (W / H); ortho.right = halfH * (W / H)
        ortho.top = halfH; ortho.bottom = -halfH
        ortho.updateProjectionMatrix()
      }
      let blob: Promise<Blob | null>
      try {
        renderer.setPixelRatio(1)
        renderer.setSize(W, H, false)
        if (cam === persp) { persp.aspect = W / H; persp.updateProjectionMatrix() } else setOrthoExtents(orthoHalfH)
        if (view) {
          const pos = new THREE.Vector3(...view.position)
          const tgt = new THREE.Vector3(...view.target)
          cam.position.copy(pos)
          cam.lookAt(tgt)
          if (cam === ortho) { ortho.zoom = 1; setOrthoExtents(Math.max(1, pos.distanceTo(tgt)) * half) }
          // Snap walls to the heights of that view (no partial lerp) and show every furniture item in full.
          const targets = computeWallTargetHeights(scene.walls, pos, tgt, view.wallMode)
          setWalls((w) => Math.max(MIN_SCALE, (targets.get(w.data.id) ?? w.data.heightCm) / w.data.heightCm))
          for (const g of built.furniture) g.scale.y = 1
        }
        built.scene.updateMatrixWorld()
        renderer.render(built.scene, cam)
        // toBlob copies the drawing buffer when it is called, so the live size can come back right after.
        blob = new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      } finally {
        cam.position.copy(savedPos)
        cam.quaternion.copy(savedQuat)
        ortho.zoom = savedZoom
        setWalls((w) => savedRatios.get(w) ?? w.ratio)
        built.furniture.forEach((g, i) => { g.scale.y = savedFurn[i] })
        renderer.setPixelRatio(prevPixelRatio)
        renderer.setSize(width, height, false)
        persp.aspect = width / height
        persp.updateProjectionMatrix()
        updateOrtho()
        renderer.render(built.scene, camera)
      }
      return blob
    }

    // Thumbnails reuse the PNG path: one synchronous render at thumbnail size, then everything is put back
    // before the browser paints, so the live canvas never shows the small frame.
    const captureThumbnail: View3DHandle['captureThumbnail'] = async (snapshot, w = THUMB_WIDTH, h = THUMB_HEIGHT) => {
      const blob = await capturePngBlob({ width: w, height: h, view: snapshot })
      return blob ? URL.createObjectURL(blob) : null
    }

    const handle: View3DHandle = { getSnapshot, flyTo, applyPreset, capturePngBlob, captureThumbnail }
    if (handleRef) handleRef.current = handle

    const resize = () => {
      width = Math.max(1, container.clientWidth); height = Math.max(1, container.clientHeight)
      renderer.setSize(width, height, false)
      persp.aspect = width / height
      persp.updateProjectionMatrix()
      updateOrtho()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    const start = performance.now()
    let last = start
    let raf = 0
    let furnS = intro ? MIN_SCALE : 1
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
      last = now
      const ms = now - start
      let wallK = 1, furnK = 1
      if (intro) {
        if (ms >= INTRO_MS) {
          intro = false
          target.copy(endTarget)
          controls.target.copy(endTarget)
          ortho.zoom = endZoom
          ortho.updateProjectionMatrix()
          place(END_ELEV)
        } else {
          const e = easeOut(ms / INTRO_MS)
          target.lerpVectors(introStart.target, endTarget, e)
          controls.target.copy(target)
          ortho.zoom = introStart.zoom + (endZoom - introStart.zoom) * e
          ortho.updateProjectionMatrix()
          place(START_ELEV + (END_ELEV - START_ELEV) * e, introStart.dist + (dist - introStart.dist) * e, target)
          wallK = range(ms, 100, 550)
          furnK = range(ms, 200, 650)
          persp.lookAt(target); ortho.lookAt(target)
        }
      }
      if (flight) {
        const k = easeOut((now - flight.t0) / FLY_MS)
        applyFlight(flight, k)
        if (k >= 1) flight = null
      }
      controls.update()

      const targets = computeWallTargetHeights(scene.walls, camera.position, controls.target, wallModeRef.current)
      const k = snap || intro || reducedMotion ? 1 : 1 - Math.exp(-dt * 10)
      setWalls((w) => {
        const want = Math.max(MIN_SCALE, ((targets.get(w.data.id) ?? w.data.heightCm) / w.data.heightCm) * wallK)
        const cur = w.ratio
        return k >= 1 ? want : Math.abs(want - cur) < 1e-4 ? want : cur + (want - cur) * k
      })
      // Furniture grows with the intro, then eases to full height (no pop when the user cancels the intro).
      furnS = intro || snap ? furnK : furnS + (1 - furnS) * k
      for (const f of built.furniture) f.scale.y = Math.max(MIN_SCALE, furnS)
      snap = false

      renderer.render(built.scene, camera)
    }
    raf = requestAnimationFrame(frame)

    // WebGL context loss (GPU reset, too many contexts): stop drawing and show a message, then resume on restore.
    const onContextLost = (e: Event) => {
      e.preventDefault()
      lost = true
      cancelAnimationFrame(raf)
      setContextLost(true)
    }
    const onContextRestored = () => {
      lost = false
      backdrops.restore()
      last = performance.now()
      snap = true
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(frame)
      setContextLost(false)
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)

    return () => {
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      cancelAnimationFrame(raf)
      ro.disconnect()
      savedCamera.current = { artboardId: artboardId ?? '', pos: camera.position.clone(), target: controls.target.clone(), orthoHalfH, zoom: ortho.zoom }
      apiRef.current = null
      if (handleRef && handleRef.current === handle) handleRef.current = null
      controls.removeEventListener('start', stopIntro)
      controls.removeEventListener('start', stopFlight)
      controls.dispose()
      backdrops.dispose()
      built.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [scene, artboardId, handleRef])

  return (
    <div
      ref={containerRef}
      data-testid="views-3d-canvas"
      className="absolute inset-0 overflow-hidden"
      style={{ background: backdropCssColor(viewBackdrop), touchAction: 'none' }}
    >
      {contextLost && !webglFailed && (
        <div data-testid="views-3d-contextlost" role="status" className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-400">
          The 3D view paused because the graphics context was lost. It resumes on its own.
        </div>
      )}
      {webglFailed && (
        <div data-testid="views-3d-nowebgl" className="absolute inset-0 flex items-center justify-center p-4 text-center text-xs text-slate-400">
          The 3D view needs WebGL, which is not available in this browser.
        </div>
      )}
    </div>
  )
}
