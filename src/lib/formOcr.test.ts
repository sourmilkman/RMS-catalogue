import { describe, expect, it } from 'vitest'
import { blankEntry, findDuplicateArtist, parseOcrText, preserveArtworkImages } from './formOcr'

describe('entry form OCR', () => {
  it('creates an editable blank member entry', () => {
    const entry = blankEntry('associate-member')
    expect(entry.membershipType).toBe('associate-member')
    expect(entry.artworks).toHaveLength(1)
  })

  it('extracts labelled contact and artwork fields from OCR text', () => {
    const entry = parseOcrText('YOUR NAME: jane smith\nEMAIL: jane@example.com\nPHONE NUMBER: 01234\nTITLE: Red Fox\nMEDIUM: Watercolour', 'rms-member')
    expect(entry).toMatchObject({ fullName: 'jane smith', email: 'jane@example.com', phone: '01234', membershipType: 'rms-member' })
    expect(entry.artworks[0]).toMatchObject({ title: 'Red Fox', medium: 'Watercolour' })
  })

  it('detects an existing artist by normalized name or email', () => {
    const draft = { ...blankEntry('non-member'), fullName: 'Jane  Smith', email: 'JANE@example.com' }
    const artist = { id: 'a1', sourceRow: 1, fullName: 'Jane Smith', firstName: 'Jane', surname: 'Smith', email: 'jane@example.com', artworks: [], warnings: [] }
    expect(findDuplicateArtist([artist], draft)?.id).toBe('a1')
  })

  it('preserves existing artwork images when an artist is overwritten', () => {
    const artwork = { id: 'old-1', artistId: 'a1', position: 1, title: 'Red Fox', imageUrl: 'https://example.com/fox.jpg', localImageName: 'fox.jpg', votes: { yes: 0, no: 0, maybe: 0, valid: false, raw: '' }, verdict: 'tie' as const, warnings: [] }
    const existing = { id: 'a1', sourceRow: 1, fullName: 'Jane Smith', firstName: 'Jane', surname: 'Smith', artworks: [artwork], warnings: [] }
    const replacement = { ...existing, locallyAdded: true, artworks: [{ ...artwork, id: 'new-1', imageUrl: undefined, localImageName: undefined }] }
    expect(preserveArtworkImages(existing, replacement).artworks[0]).toMatchObject({ imageUrl: 'https://example.com/fox.jpg', localImageName: 'fox.jpg' })
  })
})
