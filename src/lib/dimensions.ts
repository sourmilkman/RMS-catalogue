import type { ArtworkSubmission } from '../types'

/**
 * Artwork size: a size given in the data wins; otherwise it is read from the image filename, where many artists
 * write it (e.g. "Louise-Halliday-Fiona-60x70mm Large.jpeg" → "60 × 70 mm"). A size is only read when a unit
 * (mm or cm) is written — nothing is guessed.
 */
export type SizeSource = 'given' | 'image filename'
export interface ArtworkSize { value: string; source: SizeSource }

const SIZE = /(\d+(?:[.,]\d+)?)\s*(mm|cm)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?(?:\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm)?)?/i

export function sizeFromFilename(name?: string): string | undefined {
  if (!name) return undefined
  let file = name.split(/[\\/]/).pop() ?? name
  try { file = decodeURIComponent(file) } catch { /* keep as is */ }
  const match = file.replace(/\.[a-z0-9]{2,5}$/i, '').match(SIZE)
  if (!match) return undefined
  const [, a, unitA, b, unitB, c, unitC] = match
  const unit = (unitC ?? unitB ?? unitA)?.toLocaleLowerCase()
  if (!unit) return undefined
  return `${[a, b, c].filter(Boolean).join(' × ')} ${unit}`
}

export function artworkSize(artwork: ArtworkSubmission): ArtworkSize | undefined {
  if (artwork.dimensions?.trim()) return { value: artwork.dimensions.trim(), source: 'given' }
  const fromName = sizeFromFilename(artwork.localImageName) ?? sizeFromFilename(artwork.imageUrl)
  return fromName ? { value: fromName, source: 'image filename' } : undefined
}
