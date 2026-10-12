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
