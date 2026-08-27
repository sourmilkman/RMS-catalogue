import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { ArtistSubmission, ArtworkDecision } from '../types'
import { defaultDecision } from './reconcile'
import { createCatalogueDocx, getExportRows } from './exportDocx'
import { validateRNumbers } from './googleSheets'

const artist: ArtistSubmission = {
  id: 'artist', sourceRow: 2, fullName: 'Alice Example', firstName: 'Alice', surname: 'Example', email: 'a@example.com', youngArtistAge: 20, warnings: [],
  artworks: [
    { id: 'included', artistId: 'artist', position: 1, imageUrl: 'https://example.com/Arthur’s Crown image.jpg', title: 'One', medium: 'Oil', votes: { yes: 5, no: 0, maybe: 2, valid: true, raw: '' }, verdict: 'yes', warnings: [] },
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

  it('creates valid landscape geometry and URI-safe hyperlink relationships', async () => {
    const decision = defaultDecision('yes', 'included')
    const blob = await createCatalogueDocx([artist], { included: decision }, {})
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const documentXml = await zip.file('word/document.xml')!.async('string')
    const relationshipsXml = await zip.file('word/_rels/document.xml.rels')!.async('string')

    expect(documentXml).toContain('<w:pgSz w:w="15840" w:h="12240" w:orient="landscape"')
    expect(relationshipsXml).toContain('Arthur%E2%80%99s%20Crown%20image.jpg')
    expect(relationshipsXml).not.toContain('Arthur’s Crown image.jpg')
  })

  it('requires a unique, manual R number for every export row', () => {
    const rows = getExportRows([artist], { included: { ...defaultDecision('yes', 'included'), rNumber: 'R225' } }, {})
    expect(validateRNumbers(rows)).toBeUndefined()
    expect(validateRNumbers([{ ...rows[0], rNumber: '' }])).toBeUndefined()
    expect(validateRNumbers([...rows, { ...rows[0] }])).toContain('R225 is used more than once')
  })

  it('adds the R prefix in exports when only digits are entered', () => {
    const rows = getExportRows([artist], { included: { ...defaultDecision('yes', 'included'), rNumber: '225' } }, {})
    expect(rows[0].rNumber).toBe('R225')
  })
})
