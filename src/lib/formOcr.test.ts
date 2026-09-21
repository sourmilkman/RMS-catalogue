import { describe, expect, it } from 'vitest'
import { blankEntry, parseOcrText } from './formOcr'

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
})
