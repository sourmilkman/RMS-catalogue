export type Verdict = 'yes' | 'maybe' | 'no' | 'tie'
export type CatalogueDecision = 'included' | 'excluded' | 'undecided'
export type MembershipType = 'rms-member' | 'associate-member' | 'non-member'
export type ExportField = 'firstName' | 'surname' | 'title' | 'email' | 'dob' | 'download'

export interface Votes {
  yes: number
  maybe: number
  no: number
  valid: boolean
  raw: string
}

export interface DataWarning {
  code: string
  message: string
}

export interface ArtworkSubmission {
  id: string
  artistId: string
  position: number
  imageUrl?: string
  localImage?: Blob
  localImageName?: string
  title: string
  medium?: string
  dimensions?: string
  price?: string
  votes: Votes
  verdict: Verdict
  warnings: DataWarning[]
}

export interface ArtistSubmission {
  id: string
  sourceRow: number
  fullName: string
  firstName: string
  surname: string
  email?: string
  address?: string
  phone?: string
  membershipType?: MembershipType
  locallyAdded?: boolean
  dateOfBirth?: string
  youngArtistAge?: number
  artworks: ArtworkSubmission[]
  warnings: DataWarning[]
}

export interface SourceSnapshot {
  id: 'latest'
  syncedAt: string
  sourceLabel?: string
  artists: ArtistSubmission[]
}

export interface ArtworkDecision {
  artworkId: string
  decision: CatalogueDecision
  manual: boolean
  fields: Record<ExportField, boolean>
}

export interface ArtistOverride {
  artistId: string
  firstName: string
  surname: string
  youngArtist: boolean
}

export interface ReconciliationResult {
  decisions: Record<string, ArtworkDecision>
  changes: Record<string, string[]>
  removedCount: number
}
