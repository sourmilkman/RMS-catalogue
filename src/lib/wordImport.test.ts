import { describe, expect, it } from 'vitest'
import { Document, Packer, Paragraph, Tab, Table, TableCell, TableRow, TextRun } from 'docx'
import type { ArtistOverride, ArtistSubmission, ArtworkDecision } from '../types'
import { catalogueSections, createPrintedCatalogueDocx } from './exportCatalogueDocx'
import { parseWordDocument } from './wordImport'

async function docxBuffer(children: (Paragraph | Table)[]): Promise<ArrayBuffer> {
  const blob = await Packer.toBlob(new Document({ sections: [{ children }] }))
  return blob.arrayBuffer()
}
const p = (text: string, options: { bold?: boolean; italics?: boolean } = {}) => new Paragraph({ children: [new TextRun({ text, ...options })] })
const tabs = (...parts: string[]) => new Paragraph({ children: parts.map((part, index) => new TextRun({ children: index ? [new Tab(), part] : [part] })) })

describe('Word import — catalogue-style list (like the printed catalogue)', () => {
  it('reads sections, artists, initials, awards, mediums and prices', async () => {
    const buffer = await docxBuffer([
      p('LIST OF EXHIBITS – MINIATURE PAINTINGS (continued)', { bold: true }),
      p('£'),
      p('LUIS RICARDO CAUDRA', { bold: true }),
      tabs('126', 'Portrait of Elena at the age of five (graphite on paper)', 'NFS (1200)'),
      tabs('127', 'Portrait of Thomas Wriothesley after Hans Holbein'),
      tabs('(watercolour on vellum)', '2000'),
      p('MICHAEL COE RMS HS MAA MASF MPSGS', { bold: true }),
      p('GOLD MEMORIAL BOWL 1998', { italics: true }),
      tabs('132', 'Girl with the Silver Nose Ring (watercolour on vellum)', 'NFS'),
      p('GORDON McCONNACHIE', { bold: true }),
      p('282 Kestrel (watercolour on vellum) 190'),
      p('LAURA CRITCHLOW RMS', { bold: true }),
      tabs('139', 'Miss Nikki Ball (acrylic on board) As seen on 2025 advertising', '875'),
      p('40'),
      p('LIST OF EXHIBITS – SCULPTURES', { bold: true }),
      p('BILL MUNDY RMS HS MAA MASF', { bold: true }),
      p('GOLD MEMORIAL BOWL 1986', { italics: true }),
      p('MEMORIAL EXHIBIT', { italics: true }),
      tabs('400', 'Hare (bronze)', '650'),
      p('LIST OF EXHIBITS – YOUNG ARTISTS', { bold: true }),
      p('AMY BAKER', { bold: true }),
      tabs('500', 'Wren (graphite on paper)', '90'),
      p('Some stray note in lower case'),
    ])
    const result = await parseWordDocument(buffer, 'list.docx')
    const byName = Object.fromEntries(result.snapshot.artists.map((artist) => [artist.fullName, artist]))

    expect(Object.keys(byName)).toEqual(['Luis Ricardo Caudra', 'Michael Coe', 'Gordon McConnachie', 'Laura Critchlow', 'Bill Mundy', 'Amy Baker'])
    expect(byName['Luis Ricardo Caudra'].artworks.map((artwork) => [artwork.title, artwork.medium, artwork.price])).toEqual([
      ['Portrait of Elena at the age of five', 'graphite on paper', 'NFS (1200)'],
      ['Portrait of Thomas Wriothesley after Hans Holbein', 'watercolour on vellum', '2000'],
    ])
    expect(byName['Gordon McConnachie']).toMatchObject({ firstName: 'Gordon', surname: 'McConnachie' })
    expect(byName['Gordon McConnachie'].artworks[0]).toMatchObject({ title: 'Kestrel', medium: 'watercolour on vellum', price: '190' })
    expect(result.artistDetails[byName['Michael Coe'].id]).toEqual({ societyInitials: 'RMS HS MAA MASF MPSGS', awardText: 'GOLD MEMORIAL BOWL 1998' })
    expect(result.artistDetails[byName['Bill Mundy'].id].awardText).toBe('GOLD MEMORIAL BOWL 1986 | MEMORIAL EXHIBIT')
    expect(byName['Bill Mundy'].artworks[0].sculpture).toBe(true)
    expect(byName['Amy Baker'].youngArtist).toBe(true)
    expect(byName['Michael Coe'].youngArtist).toBeUndefined()
    expect(result.stats).toEqual({ artists: 6, artworks: 7, sculptures: 1, youngArtists: 1 })

    // Flagged, not guessed
    expect(result.flags).toContain('Exhibit 139: Text after the medium was not imported: "As seen on 2025 advertising"')
    expect(result.flags).toContain('Line not understood, not imported: "Some stray note in lower case"')
    expect(result.flags.some((flag) => flag.startsWith('Luis Ricardo Caudra: Name has three or more parts'))).toBe(true)
    expect(result.flags.some((flag) => flag.includes('page numbers'))).toBe(true)
    expect(result.flags.some((flag) => flag.startsWith('Exhibit 127'))).toBe(false)
  })

  it('does not treat a bare trailing year as a price', async () => {
    const result = await parseWordDocument(await docxBuffer([p('JANE DOE', { bold: true }), p('12 Untitled 2024')]))
    expect(result.snapshot.artists[0].artworks[0]).toMatchObject({ title: 'Untitled 2024', price: undefined })
    expect(result.flags).toContain('Exhibit 12: No price found')
  })

  it('drops capitalised headings that have no artworks', async () => {
    const result = await parseWordDocument(await docxBuffer([p('ANNUAL EXHIBITION 2026'), p('JANE DOE', { bold: true }), p('1 Fox (oil on panel) 300')]))
    expect(result.snapshot.artists.map((artist) => artist.fullName)).toEqual(['Jane Doe'])
    expect(result.flags).toContain('"ANNUAL EXHIBITION 2026" was read as an artist name but has no artworks — ignored')
  })
})

describe('Word import — table with a header row', () => {
  it('reads one artwork per row, merges an artist across sections and flags unknown sections', async () => {
    const row = (...cells: string[]) => new TableRow({ children: cells.map((text) => new TableCell({ children: [p(text)] })) })
    const buffer = await docxBuffer([new Table({ rows: [
      row('First name', 'Surname', 'Initials', 'Section', 'Title', 'Medium', 'Price (£)'),
      row('Jenny', 'Musker', 'VPRMS', 'Miniature painting', 'Little Jenny Wren', 'watercolour on Polymin', '£395'),
      row('', '', '', 'Sculpture', 'Wren in Bronze', 'bronze', '600'),
      row('Sam', 'Lee', '', 'Young artist', 'Moth', 'graphite on paper', '80'),
      row('Ann', 'Ray', '', 'Engraving', 'Oak', 'wood engraving', '120'),
    ] })])
    const result = await parseWordDocument(buffer)
    const [musker, lee, ray] = result.snapshot.artists
    expect(musker).toMatchObject({ fullName: 'Jenny Musker', surname: 'Musker' })
    expect(musker.artworks.map((artwork) => [artwork.title, artwork.medium, artwork.price, artwork.sculpture])).toEqual([
      ['Little Jenny Wren', 'watercolour on Polymin', '395', undefined],
      ['Wren in Bronze', 'bronze', '600', true],
    ])
    expect(result.artistDetails[musker.id].societyInitials).toBe('VPRMS')
    expect(lee.youngArtist).toBe(true)
    expect(ray.artworks[0].sculpture).toBeUndefined()
    expect(result.flags).toContain('Table row 5: section "Engraving" not recognised — listed as a miniature painting')
  })

  it('rejects files that are not .docx', async () => {
    await expect(parseWordDocument(new TextEncoder().encode('not a zip').buffer as ArrayBuffer)).rejects.toThrow(/not a \.docx/)
  })
})

describe('Word import — round trip through the catalogue export', () => {
  it('re-imports an exported catalogue into the same sections and order', async () => {
    const make = (id: string, firstName: string, surname: string, works: [string, string, string, boolean?][], extra: Partial<ArtistSubmission> = {}): ArtistSubmission => ({
      id, sourceRow: 1, fullName: `${firstName} ${surname}`, firstName, surname, warnings: [], ...extra,
      artworks: works.map(([title, medium, price, sculpture], index) => ({ id: `${id}${index}`, artistId: id, position: index + 1, title, medium, price, sculpture, votes: { yes: 1, no: 0, maybe: 0, valid: true, raw: '' }, verdict: 'yes', warnings: [] })),
    })
    const artists = [
      make('a', 'Tom', 'Mulliner', [['St Michael the Archangel', 'oil on paper', '480'], ['St Sebastian', 'oil on paper', '480']]),
      make('b', 'Jenny', 'Musker', [['Little Jenny Wren', 'watercolour on Polymin', '395'], ['Wren in Bronze', 'bronze', '600', true]]),
      make('c', 'Amy', 'Baker', [['Wren', 'graphite on paper', '90']], { youngArtistAge: 15 }),
    ]
    const decisions: Record<string, ArtworkDecision> = Object.fromEntries(artists.flatMap((artist) => artist.artworks.map((artwork) => [artwork.id, { artworkId: artwork.id, decision: 'included', manual: true, fields: { firstName: true, surname: true, title: true, email: true, dob: true, download: true } }])))
    const overrides: Record<string, ArtistOverride> = { a: { artistId: 'a', firstName: 'Tom', surname: 'Mulliner', youngArtist: false, societyInitials: 'RMS', awardText: '' }, b: { artistId: 'b', firstName: 'Jenny', surname: 'Musker', youngArtist: false, societyInitials: 'VPRMS', awardText: 'Gold Memorial Bowl 2020 | Memorial Exhibit' } }
    const exported = await createPrintedCatalogueDocx(artists, decisions, overrides)

    const result = await parseWordDocument(await exported.arrayBuffer())
    expect(result.flags).toEqual([])
    const reDecisions = Object.fromEntries(result.snapshot.artists.flatMap((artist) => artist.artworks.map((artwork) => [artwork.id, { ...decisions.a0, artworkId: artwork.id }])))
    const reOverrides = Object.fromEntries(result.snapshot.artists.map((artist) => [artist.id, { artistId: artist.id, firstName: artist.firstName, surname: artist.surname, youngArtist: artist.youngArtist ?? false, ...result.artistDetails[artist.id] }]))
    const summary = (sections: ReturnType<typeof catalogueSections>) => sections.map((section) => [section.key, section.entries.map((entry) => [entry.heading, entry.awardText, entry.artworks])])
    expect(summary(catalogueSections(result.snapshot.artists, reDecisions, reOverrides))).toEqual(summary(catalogueSections(artists, decisions, overrides)))
  })
})
