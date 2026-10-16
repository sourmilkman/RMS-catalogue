import type { ArtworkSubmission } from '../types'

/**
 * Artwork size: a size given in the data wins; otherwise it is read from the image filename, where most artists
 * write it (e.g. "Louise-Halliday-Fiona-60x70mm Large.jpeg" → "60 × 70 mm").
 * Numbers without a unit ("Ceres_102x98 a") are kept but marked "unit not stated" — never assumed to be mm.
 */
export type SizeSource = 'given' | 'image filename'
export interface ArtworkSize { value: string; source: SizeSource; unitStated: boolean }
export interface FilenameSize { value: string; unitStated: boolean }

const NUM = String.raw`(\d+(?:[.,]\d+)?)`
const UNIT = String.raw`\s*(mm|cm)?`
const sized = (sep: string) => new RegExp(String.raw`(?<![\d.])${NUM}${UNIT}${sep}${NUM}${UNIT}(?:${sep}${NUM}${UNIT})?(?![\d])`, 'gi')
// "60x70mm" first; "83_83mm" only when the name has no x-separated size (so "Rajput 2_89x112mm" reads 89 × 112).
const PATTERNS = [sized(String.raw`\s*[x×]\s*`), sized(String.raw`\s*_\s*`)]
const SINGLE = new RegExp(String.raw`(?<![\d.])${NUM}\s*(mm|cm)\b([\s-]*diameter)?`, 'i')
const DASHED_PAIR = /(?<![\d.])(\d{2,3})-(\d{2,3})$/

function baseName(name: string): string {
  let file = name.split(/[\\/]/).pop() ?? name
  try { file = decodeURIComponent(file) } catch { /* keep as is */ }
  return file.replace(/\.[a-z0-9]{2,5}$/i, '')
}

export function sizeFromFilenameDetailed(name?: string): FilenameSize | undefined {
  if (!name) return undefined
  const file = baseName(name)
  for (const pattern of PATTERNS) {
    for (const match of file.matchAll(pattern)) {
      const [, a, unitA, b, unitB, c, unitC] = match
      const numbers = [a, b, c].filter(Boolean)
      // Bare pairs of 4+ digits are photo sizes or IDs (e.g. "IMG_2048x1536"), not artwork sizes.
      const unit = (unitC ?? unitB ?? unitA)?.toLocaleLowerCase()
      if (!unit && numbers.some((value) => value.replace(/[.,].*/, '').length > 3)) continue
      return { value: `${numbers.join(' × ')}${unit ? ` ${unit}` : ''}`, unitStated: Boolean(unit) }
    }
  }
  const single = file.match(SINGLE)
  if (single) return { value: `${single[1]} ${single[2].toLocaleLowerCase()}${single[3] ? ' diameter' : ''}`, unitStated: true }
  const dashed = file.match(DASHED_PAIR)
  if (dashed) return { value: `${dashed[1]} × ${dashed[2]}`, unitStated: false }
  return undefined
}

/** Size with its unit only (used where an unstated unit must not count). */
export function sizeFromFilename(name?: string): string | undefined {
  const size = sizeFromFilenameDetailed(name)
  return size?.unitStated ? size.value : undefined
}

export function artworkSize(artwork: ArtworkSubmission): ArtworkSize | undefined {
  if (artwork.dimensions?.trim()) return { value: artwork.dimensions.trim(), source: 'given', unitStated: true }
  const fromName = sizeFromFilenameDetailed(artwork.localImageName) ?? sizeFromFilenameDetailed(artwork.imageUrl)
  return fromName ? { value: fromName.value, source: 'image filename', unitStated: fromName.unitStated } : undefined
}

export function sizeLabel(size: ArtworkSize): string {
  if (size.source === 'given') return 'Given'
  return size.unitStated ? 'From image filename' : 'From image filename — unit not stated'
}
