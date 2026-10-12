import { describe, expect, it } from 'vitest'
import type { ArtistSubmission, ArtworkDecision } from '../types'
import { catalogueGroupOf, sectionOf } from './catalogueRules'

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

describe('catalogueGroupOf (on-screen catalogue order)', () => {
  it('splits Young Artists into 14–17 and 18–30 by age, and flags a missing age', () => {
    const young = (age?: number) => ({ ...artist, youngArtist: true, youngArtistAge: age })
    expect(catalogueGroupOf(young(17), artwork, undefined, decision())).toBe('young-14-17')
    expect(catalogueGroupOf(young(18), artwork, undefined, decision())).toBe('young-18-30')
    expect(catalogueGroupOf(young(undefined), artwork, undefined, decision())).toBe('young-no-age')
    expect(catalogueGroupOf(artist, artwork, undefined, decision(true))).toBe('sculptures')
  })
})
