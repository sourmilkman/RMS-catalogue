import { describe, expect, it } from 'vitest'
import type { ArtistSubmission, ArtworkDecision } from '../types'
import { defaultDecision } from './reconcile'
import { getExportRows } from './exportDocx'

const artist: ArtistSubmission = {
  id: 'artist', sourceRow: 2, fullName: 'Alice Example', firstName: 'Alice', surname: 'Example', email: 'a@example.com', youngArtistAge: 20, warnings: [],
  artworks: [
    { id: 'included', artistId: 'artist', position: 1, imageUrl: 'https://example.com/one.jpg', title: 'One', medium: 'Oil', votes: { yes: 5, no: 0, maybe: 2, valid: true, raw: '' }, verdict: 'yes', warnings: [] },
    { id: 'excluded', artistId: 'artist', position: 2, title: 'Two', votes: { yes: 1, no: 4, maybe: 2, valid: true, raw: '' }, verdict: 'no', warnings: [] },
  ],
}

describe('DOCX row selection', () => {
  it('exports only included artworks in Y/N/M order and respects omitted fields', () => {
    const included: ArtworkDecision = { ...defaultDecision('yes', 'included'), fields: { ...defaultDecision('yes', 'included').fields, email: false } }
    const rows = getExportRows([artist], { included, excluded: defaultDecision('no', 'excluded') }, {})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'One', yes: 5, no: 0, maybe: 2, email: '', dobYoungArtist: 'Young Artist · Age 20' })
  })
})
