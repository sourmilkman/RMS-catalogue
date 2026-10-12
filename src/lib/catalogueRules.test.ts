import { describe, expect, it } from 'vitest'
import type { ArtistSubmission, ArtworkDecision } from '../types'
import { sectionOf } from './catalogueRules'

const artwork = { id: 'w', artistId: 'a', position: 1, title: 'Hare', votes: { yes: 0, no: 0, maybe: 0, valid: false, raw: '' }, verdict: 'tie' as const, warnings: [] }
const artist: ArtistSubmission = { id: 'a', sourceRow: 1, fullName: 'Ann Ray', firstName: 'Ann', surname: 'Ray', warnings: [], artworks: [artwork] }
const decision = (sculpture?: boolean): ArtworkDecision => ({ artworkId: 'w', decision: 'included', manual: false, sculpture, fields: { firstName: true, surname: true, title: true, email: true, dob: true, download: true } })

describe('sectionOf (used by the show/hide switches and the catalogue)', () => {
  it('puts a work in paintings by default, sculptures when toggled, young artists above both', () => {
    expect(sectionOf(artist, artwork, undefined, decision())).toBe('paintings')
    expect(sectionOf(artist, artwork, undefined, decision(true))).toBe('sculptures')
    expect(sectionOf({ ...artist, youngArtist: true }, artwork, undefined, decision(true))).toBe('young')
  })
})
