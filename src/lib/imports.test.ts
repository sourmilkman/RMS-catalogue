import { describe, expect, it } from 'vitest'
import { applyLocalImages, importDifference, parseSpreadsheetFile } from './imports'
import { normaliseSheetCsv } from './normalise'

const csv = [
  'Name,Email,Artwork 1 Image,Artwork 1 Title,Medium,Artwork 1 Vote',
  'Alice Example,a@example.com,https://example.com/Alice-Oak-Tree.jpg,Oak Tree,Oil,Yes: 5; Maybe: 1; No: 0',
].join('\n')

describe('offline imports', () => {
  it('matches local images by the spreadsheet filename', () => {
    const source = normaliseSheetCsv(csv)
    const file = new File(['image'], 'Alice-Oak-Tree.jpg', { type: 'image/jpeg' })
    const result = applyLocalImages(source, [file])
    expect(result.matched).toBe(1)
    expect(result.unmatched).toEqual([])
    expect(result.snapshot.artists[0].artworks[0].localImageName).toBe(file.name)
  })

  it('warns when imported catalogue content differs', () => {
    const previous = normaliseSheetCsv(csv)
    const next = normaliseSheetCsv(csv.replace('Oak Tree', 'Elm Tree'))
    expect(importDifference(previous, next)).toContain('differs from the cached catalogue')
  })

  it('reads an XLSX workbook', async () => {
    const XLSX = await import('@e965/xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(csv.split('\n').map((row) => row.split(','))), 'Selection')
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
    const result = await parseSpreadsheetFile(new File([bytes], 'selection.xlsx'))
    expect(result.artists[0].artworks[0].title).toBe('Oak Tree')
    expect(result.sourceLabel).toBe('selection.xlsx')
  })
})
