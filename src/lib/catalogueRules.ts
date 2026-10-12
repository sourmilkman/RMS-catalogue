import type { ArtistOverride, ArtistSubmission, ArtworkDecision, ArtworkSubmission } from '../types'

/**
 * The on-screen toggle decides once used; otherwise the Word lists decide (an artist the secretary placed in the
 * Miniature list is not a Young Artist even if their submission gave an age); otherwise a Sheet-supplied age counts.
 */
export function isYoungArtist(artist: ArtistSubmission, override?: ArtistOverride): boolean {
  if (override?.youngArtistSet) return override.youngArtist
  if (artist.youngArtist !== undefined) return artist.youngArtist
  return artist.youngArtistAge !== undefined || (override?.youngArtist ?? false)
}

/** The per-artwork toggle wins; otherwise the value from a Word import; otherwise a miniature painting. */
export function isSculpture(artwork: ArtworkSubmission, decision?: ArtworkDecision): boolean {
  return decision?.sculpture ?? artwork.sculpture ?? false
}

export type CatalogueSectionKey = 'sculptures' | 'paintings' | 'young'

/** Young Artists take priority, so a young artist's sculptures stay in Young Artists. */
export function sectionOf(artist: ArtistSubmission, artwork: ArtworkSubmission, override?: ArtistOverride, decision?: ArtworkDecision): CatalogueSectionKey {
  if (isYoungArtist(artist, override)) return 'young'
  return isSculpture(artwork, decision) ? 'sculptures' : 'paintings'
}

export type CatalogueGroupKey = 'sculptures' | 'paintings' | 'young-14-17' | 'young-18-30' | 'young-no-age'

/** On-screen catalogue order: Sculptures, Miniature paintings, Young Artists 14–17, Young Artists 18–30. */
export const CATALOGUE_GROUPS: { key: CatalogueGroupKey; label: string }[] = [
  { key: 'sculptures', label: 'Sculptures' },
  { key: 'paintings', label: 'Miniature paintings' },
  { key: 'young-14-17', label: 'Young Artists (14–17)' },
  { key: 'young-18-30', label: 'Young Artists (18–30)' },
  { key: 'young-no-age', label: 'Young Artists (age not given)' },
]

export function catalogueGroupOf(artist: ArtistSubmission, artwork: ArtworkSubmission, override?: ArtistOverride, decision?: ArtworkDecision): CatalogueGroupKey {
  const section = sectionOf(artist, artwork, override, decision)
  if (section !== 'young') return section
  if (artist.youngArtistAge === undefined) return 'young-no-age'
  return artist.youngArtistAge <= 17 ? 'young-14-17' : 'young-18-30'
}
