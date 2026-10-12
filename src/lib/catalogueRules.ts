import type { ArtistOverride, ArtistSubmission, ArtworkDecision, ArtworkSubmission } from '../types'

/** A Sheet-supplied age always counts; otherwise the on-screen toggle (or the imported value before any edit) decides. */
export function isYoungArtist(artist: ArtistSubmission, override?: ArtistOverride): boolean {
  if (artist.youngArtistAge !== undefined) return true
  return override ? override.youngArtist : artist.youngArtist ?? false
}

/** The per-artwork toggle wins; otherwise the value from a Word import; otherwise a miniature painting. */
export function isSculpture(artwork: ArtworkSubmission, decision?: ArtworkDecision): boolean {
  return decision?.sculpture ?? artwork.sculpture ?? false
}
