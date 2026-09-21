import type { ArtistSubmission, ArtworkDecision, ExportField, ReconciliationResult, SourceSnapshot } from '../types'
import { normalizeIdentity } from './identity'

export const EXPORT_FIELDS: ExportField[] = ['firstName', 'surname', 'title', 'email', 'dob', 'download']

export function defaultDecision(verdict: ArtistSubmission['artworks'][number]['verdict'], artworkId: string): ArtworkDecision {
  return {
    artworkId,
    decision: verdict === 'yes' ? 'included' : verdict === 'no' ? 'excluded' : 'undecided',
    manual: false,
    fields: Object.fromEntries(EXPORT_FIELDS.map((field) => [field, true])) as Record<ExportField, boolean>,
  }
}

function fieldChanges(previous: ArtistSubmission['artworks'][number], next: ArtistSubmission['artworks'][number], previousArtist: ArtistSubmission, nextArtist: ArtistSubmission): string[] {
  const changed: string[] = []
  if (previous.title !== next.title) changed.push('title')
  if (previous.imageUrl !== next.imageUrl) changed.push('image')
  if (previous.medium !== next.medium) changed.push('medium')
  if (previous.votes.raw !== next.votes.raw) changed.push('vote result')
  if (previousArtist.fullName !== nextArtist.fullName) changed.push('artist name')
  if (previousArtist.email !== nextArtist.email) changed.push('email')
  if (previousArtist.dateOfBirth !== nextArtist.dateOfBirth) changed.push('DOB')
  if (previousArtist.youngArtistAge !== nextArtist.youngArtistAge) changed.push('Young Artist age')
  return changed
}

export function reconcileSource(previous: SourceSnapshot | undefined, next: SourceSnapshot, existing: Record<string, ArtworkDecision>): ReconciliationResult {
  const decisions: Record<string, ArtworkDecision> = {}
  const changes: Record<string, string[]> = {}
  const usedPrevious = new Set<string>()
  const previousPairs = previous?.artists.flatMap((artist) => artist.artworks.map((artwork) => ({ artist, artwork }))) ?? []

  next.artists.forEach((nextArtist) => nextArtist.artworks.forEach((nextArtwork) => {
    const exact = existing[nextArtwork.id]
    if (exact) {
      decisions[nextArtwork.id] = exact
      usedPrevious.add(nextArtwork.id)
      const previousPair = previousPairs.find(({ artwork }) => artwork.id === nextArtwork.id)
      if (previousPair) changes[nextArtwork.id] = fieldChanges(previousPair.artwork, nextArtwork, previousPair.artist, nextArtist)
      return
    }
    const candidate = previousPairs.find(({ artist, artwork }) => {
      if (usedPrevious.has(artwork.id) || artwork.position !== nextArtwork.position) return false
      const artistMatches = normalizeIdentity(artist.email) === normalizeIdentity(nextArtist.email) || normalizeIdentity(artist.fullName) === normalizeIdentity(nextArtist.fullName)
      const artworkMatches = Boolean(artwork.imageUrl && artwork.imageUrl === nextArtwork.imageUrl) || Boolean(artwork.title && normalizeIdentity(artwork.title) === normalizeIdentity(nextArtwork.title))
      return artistMatches && artworkMatches
    })
    if (candidate && existing[candidate.artwork.id]) {
      decisions[nextArtwork.id] = { ...existing[candidate.artwork.id], artworkId: nextArtwork.id }
      usedPrevious.add(candidate.artwork.id)
      changes[nextArtwork.id] = fieldChanges(candidate.artwork, nextArtwork, candidate.artist, nextArtist)
    } else {
      decisions[nextArtwork.id] = defaultDecision(nextArtwork.verdict, nextArtwork.id)
    }
  }))

  const currentIds = new Set(next.artists.flatMap((artist) => artist.artworks.map((artwork) => artwork.id)))
  const removedCount = previousPairs.filter(({ artwork }) => !currentIds.has(artwork.id) && !usedPrevious.has(artwork.id)).length
  return { decisions, changes: Object.fromEntries(Object.entries(changes).filter(([, fields]) => fields.length)), removedCount }
}
