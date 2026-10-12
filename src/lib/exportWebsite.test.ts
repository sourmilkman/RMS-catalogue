import { describe, expect, it } from 'vitest'
import type { ArtistSubmission, ArtworkDecision } from '../types'
import { catalogueEntries } from './exportCatalogueDocx'
import { websiteRows, websiteValues } from './exportWebsite'

const decision: ArtworkDecision = { artworkId: '', decision: 'included', manual: false, fields: { firstName: true, surname: true, title: true, email: true, dob: true, download: true } }
const artist = (id: string, first: string, surname: string, works: [string, string, string, boolean?][], extra: Partial<ArtistSubmission> = {}): ArtistSubmission => ({
  id, sourceRow: 1, fullName: `${first} ${surname}`, firstName: first, surname, warnings: [], ...extra,
  artworks: works.map(([title, medium, price, sculpture], index) => ({ id: `${id}${index}`, artistId: id, position: index + 1, title, medium, price, sculpture, imageUrl: `https://img/${id}${index}`, votes: { yes: 0, no: 0, maybe: 0, valid: false, raw: '' }, verdict: 'tie', warnings: [] })),
})

describe('website sheet', () => {
  it('uses the same numbers and order as the printed catalogue, with section, initials and image link', () => {
    const artists = [
      artist('m', 'Jenny', 'Musker', [['Wren', 'watercolour on Polymin', '395'], ['Bronze Wren', 'bronze', '600', true]]),
      artist('a', 'Dorothy J', 'Abrehart', [['A Fine Catch', 'watercolour on ivorine', '200']]),
      artist('y', 'Jack', 'Savage', [['Kitchen', 'oil on board', '500']], { youngArtistAge: 25 }),
    ]
    const decisions = Object.fromEntries(artists.flatMap((a) => a.artworks.map((w) => [w.id, { ...decision, artworkId: w.id }])))
    const overrides = { m: { artistId: 'm', firstName: 'Jenny', surname: 'Musker', youngArtist: false, societyInitials: 'VPRMS', awardText: 'Gold Memorial Bowl 2020 | Memorial Exhibit' } }
    const rows = websiteRows(artists, decisions, overrides)
    expect(rows.map(websiteValues)).toEqual([
      ['001', 'Sculpture', 'Jenny', 'Musker', 'VPRMS', 'GOLD MEMORIAL BOWL 2020 / MEMORIAL EXHIBIT', 'Bronze Wren', 'bronze', '', '600', 'https://img/m1', ''],
      ['002', 'Miniature Painting', 'Dorothy J', 'Abrehart', '', '', 'A Fine Catch', 'watercolour on ivorine', '', '200', 'https://img/a0', ''],
      ['003', 'Miniature Painting', 'Jenny', 'Musker', 'VPRMS', 'GOLD MEMORIAL BOWL 2020 / MEMORIAL EXHIBIT', 'Wren', 'watercolour on Polymin', '', '395', 'https://img/m0', ''],
      ['004', 'Young Artist', 'Jack', 'Savage', '', '', 'Kitchen', 'oil on board', '', '500', 'https://img/y0', ''],
    ])
    expect(rows.map((row) => row.catalogueNumber)).toEqual(catalogueEntries(artists, decisions, overrides).flatMap((entry) => entry.artworks.map((item) => item.number)))
  })
})
