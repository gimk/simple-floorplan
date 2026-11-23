export { ApartmentCard, ApartmentPanel } from './ApartmentPanel'
export {
  apartmentTotals,
  compareReference,
  parseCeilingInput,
  parseSurfaceInput,
  SOURCE_LABELS,
  SOURCE_VALUES,
  totalAreaM2,
  type ApartmentTotals,
  type ComparisonLevel,
  type ReferenceComparison,
} from './logic'
// Conversion report (walls-plan 5c step 4): the toast text, the section and its commands.
export {
  CONVERSION_SECTION_ID,
  CONVERSION_SECTION_TITLE,
  conversionCountsText,
  conversionEntryText,
  conversionNoticeText,
  conversionToShow,
  conversionToastText,
  hideConversionReport,
  mergedWallCount,
  openConversionSection,
  useConversionNotice,
} from './conversion'
export { ConversionNotice, WallConversionSection } from './WallConversionSection'
