// One-off: renders public/icon*.svg to PNG (uses `sharp`, present as a transitive dependency).
// Run: node scripts/gen-icons.mjs
import sharp from 'sharp'
const out = [
  ['public/icon.svg', 'public/pwa-192.png', 192],
  ['public/icon.svg', 'public/pwa-512.png', 512],
  ['public/icon.svg', 'public/apple-touch-icon.png', 180],
  ['public/icon-maskable.svg', 'public/pwa-maskable-512.png', 512],
]
for (const [src, dst, size] of out) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(dst)
  console.log('wrote', dst)
}
