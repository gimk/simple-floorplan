// PDF rendering for background import. pdfjs-dist is lazy-loaded via dynamic
// import() so it stays out of the main bundle.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

/** Target size (px) of the longest side of the rendered page. */
export const PDF_TARGET_LONGEST_PX = 4000

/** Render scale so the longest page side becomes ~target px. */
export const renderScale = (pageWidth: number, pageHeight: number, target = PDF_TARGET_LONGEST_PX): number => {
  const longest = Math.max(pageWidth, pageHeight)
  if (!(longest > 0)) return 1
  return target / longest
}

type Pdfjs = typeof import('pdfjs-dist')

let pdfjsPromise: Promise<Pdfjs> | null = null

/** Lazy-load pdfjs-dist once and point it at the bundled worker. */
const loadPdfjs = (): Promise<Pdfjs> => {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl
      return m
    })
  }
  return pdfjsPromise
}

const openDoc = async (file: File) => {
  const pdfjs = await loadPdfjs()
  const data = new Uint8Array(await file.arrayBuffer())
  return pdfjs.getDocument({ data }).promise
}

/** Number of pages of a PDF file. */
export const pdfPageCount = async (file: File): Promise<number> => {
  const doc = await openDoc(file)
  return doc.numPages
}

export type RenderedPage = { dataUrl: string; width: number; height: number }

/**
 * Render one page of a PDF to a PNG data URL. The canvas is scaled so the
 * longest side is about PDF_TARGET_LONGEST_PX px.
 */
export const renderPdfPage = async (file: File, pageNum: number): Promise<RenderedPage> => {
  const doc = await openDoc(file)
  const page = await doc.getPage(pageNum)
  const base = page.getViewport({ scale: 1 })
  const scale = renderScale(base.width, base.height)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d canvas context')
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
}
