import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { ArtistSubmission, ArtworkDecision } from '../types'
import { catalogueEntries, createPrintedCatalogueDocx } from './exportCatalogueDocx'
import { defaultDecision } from './reconcile'

const artist: ArtistSubmission = { id: 'a', sourceRow: 1, fullName: 'Jane Smith', firstName: 'Jane', surname: 'Smith', warnings: [], artworks: [
  { id: 'one', artistId: 'a', position: 1, title: 'Red Fox', medium: 'watercolour on paper', price: '275', votes: { yes: 1, no: 0, maybe: 0, valid: true, raw: '' }, verdict: 'yes', warnings: [] },
] }
const included: ArtworkDecision = defaultDecision('yes', 'included')

describe('printed catalogue Word export', () => {
  it('groups accepted works and numbers them from 001', () => {
    const entries = catalogueEntries([artist], { one: included }, { a: { artistId: 'a', firstName: 'Jane', surname: 'Smith', youngArtist: false, societyInitials: 'RMS', awardText: 'Gold Memorial Bowl 2026' } })
    expect(entries[0]).toMatchObject({ heading: 'JANE SMITH RMS', awardText: 'GOLD MEMORIAL BOWL 2026' })
    expect(entries[0].artworks[0]).toEqual({ number: '001', description: 'Red Fox (watercolour on paper)', price: '275' })
  })

  it('creates a portrait A5 Word document', async () => {
    const blob = await createPrintedCatalogueDocx([artist], { one: included }, {}, 1)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('LIST OF EXHIBITS - MINIATURE PAINTINGS')
    expect(xml).toContain('w:w="8391" w:h="11906"')
    expect(xml).toContain('001')
    expect(zip.file('word/header1.xml')).toBeNull()
  })
})
