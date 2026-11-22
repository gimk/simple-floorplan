// Sketch-on-photo dimension overlays (docs/plan.md 7.4): the full-screen editor, the
// thumbnail overlay, the marks badge, and the pure helpers of ./logic.
export { MarksBadge, PhotoMarksOverlay, PhotoSketch } from './PhotoSketch'
export {
  markIsMeasured,
  markLabelText,
  markMiddle,
  markPixelLength,
  markRows,
  markSummary,
  markValueCm,
  marksCount,
  marksOf,
  normPoint,
  photoIndexOf,
  pxPoint,
  surveyOfMark,
  surveyOptionsForPin,
  withMark,
  withPatchedMark,
  withPhotoMarks,
  withoutMark,
} from './logic'
export type { PhotoBox, PhotoPoint } from './logic'
