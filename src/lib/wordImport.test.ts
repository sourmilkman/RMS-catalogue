import { describe, expect, it } from 'vitest'
import { Document, Packer, Paragraph, Tab, Table, TableCell, TableRow, TextRun } from 'docx'
import { parseWordDocument, parseWordDocuments } from './wordImport'

async function docx(children: (Paragraph | Table)[]): Promise<ArrayBuffer> {
  return (await Packer.toBlob(new Document({ sections: [{ children }] }))).arrayBuffer()
}
const p = (text: string, options: { bold?: boolean; italics?: boolean } = {}) => new Paragraph({ children: [new TextRun({ text, ...options })] })
const tabs = (...parts: string[]) => new Paragraph({ children: parts.map((part, index) => new TextRun({ children: index ? [new Tab(), part] : [part] })) })
const row = (...cells: string[][]) => new TableRow({ children: cells.map((lines) => new TableCell({ children: lines.length ? lines.map((line) => p(line)) : [p('')] })) })

describe("Claire's list tables (no header row)", () => {
  it('reads first name, surname + initials, award lines and one work per line; section from the file name', async () => {
    const miniature = await docx([new Table({ rows: [
      row(['DOROTHY J'], ['ABREHART RMS'], ['A Fine Catch (watercolour on ivorine) 200', 'Brother and Bob(watercolour on ivorine) 190']),
      row(['MICHAEL'], ['COE RMS HS MAA MASF MPSGS', 'GOLD MEMORIAL BOWL 1998'], ['Girl in a Black Jacket (watercolour on vellum) NFS']),
      row(['TIFFANY'], ['BUDD HS'], ['St Pauls Cathedral (derwentprocolour on drafting film) 320', 'Puffin IslandColoured (coloured pencil on polymin) 200']),
      row(['DAVIDE DI'], ['TARANTO'], ['Jake wearing a recycled Flexi-hex (oil on recycled mountboard) 2000']),
      row(['JENNY'], ['BROOKS RMS HS DIP SBA'], ['Ruby Chatting to Granny (watercolour on polymin) NFS (850)']),
      row(['ANKIT'], ['SINGH'], ['The Rabbit (Egg tempera on gesso panel)']),
    ] })])
    const sculpture = await docx([new Table({ rows: [
      row(['TIFFANY'], ['BUDD HS'], ['Four Seasons (acrylic on ceramic egg) 420']),
      row(['RAY'], ['WINDER PRMS', 'GOLD MEMORIAL BOWL 2024'], ['The Sun ain’tGonna Shine Anymore (watercolour, gouache on paper) 750']),
    ] })])
    const young = await docx([new Table({ rows: [
      row(['AGE'], [], [], []),
      row([], [], [], []),
      row(['25'], ['JACK'], ['SAVAGE SRMS'], ['I Grew up in this Kitchen: 2001 (oil on board) 500']),
      row(['20'], ['PRZEMYSŁAW'], ['SOŁDEK'], ['Viola Suavis (watercolour on vellum) 200']),
    ] })])
    const result = await parseWordDocuments([
      { name: 'Catalogue List Miniature.docx', data: miniature },
      { name: 'Catalogue list Sculpture.docx', data: sculpture },
      { name: 'Catalogue List Young Artists (18-30).docx', data: young },
    ])
    const by = Object.fromEntries(result.artists.map((artist) => [`${artist.firstName} ${artist.surname}`, artist]))

    expect(Object.keys(by)).toEqual(['Dorothy J Abrehart', 'Michael Coe', 'Tiffany Budd', 'Davide Di Taranto', 'Jenny Brooks', 'Ankit Singh', 'Ray Winder', 'Jack Savage', 'Przemysław Sołdek'])
    expect(by['Davide Di Taranto']).toMatchObject({ firstName: 'Davide Di', surname: 'Taranto' })
    expect(by['Michael Coe']).toMatchObject({ initials: 'RMS HS MAA MASF MPSGS', awards: ['GOLD MEMORIAL BOWL 1998'] })
    expect(by['Jack Savage']).toMatchObject({ initials: 'SRMS', age: 25 })
    expect(by['Jack Savage'].works[0]).toMatchObject({ title: 'I Grew up in this Kitchen: 2001', medium: 'oil on board', price: '500', section: 'young' })

    // Same artist in two files is merged, each work keeps its own section
    expect(by['Tiffany Budd'].works.map((work) => [work.title, work.medium, work.section])).toEqual([
      ['St Pauls Cathedral', 'Derwent Procolour on drafting film', 'painting'],
      ['Puffin Island Coloured', 'coloured pencil on Polymin', 'painting'],
      ['Four Seasons', 'acrylic on ceramic egg', 'sculpture'],
    ])
    expect(by['Dorothy J Abrehart'].works[1]).toMatchObject({ title: 'Brother and Bob', medium: 'watercolour on ivorine', price: '190' })
    expect(by['Jenny Brooks'].works[0].price).toBe('NFS (850)')
    expect(by['Michael Coe'].works[0].price).toBe('NFS')
    expect(by['Ray Winder'].works[0].title).toBe('The Sun ain’t Gonna Shine Anymore')

    expect(result.fixes).toEqual(expect.arrayContaining([
      expect.stringContaining('"Brother and Bob(watercolour on ivorine) 190" → "Brother and Bob (watercolour on ivorine) 190"'),
      expect.stringContaining('→ "Derwent Procolour on drafting film"'),
      expect.stringContaining('"Puffin Island Coloured'),
      expect.stringContaining('ain’t Gonna'),
    ]))
    expect(result.flags).toContain('Ankit Singh — "The Rabbit": no price')
    expect(result.flags.some((flag) => flag.includes('check initials'))).toBe(false)
  })

  it('flags unknown initials rather than guessing', async () => {
    const result = await parseWordDocument(await docx([new Table({ rows: [row(['ANN'], ['RAY XYZ'], ['Oak (oil on panel) 100'])] })]), 'Catalogue List Miniature.docx')
    expect(result.artists[0]).toMatchObject({ surname: 'Ray', initials: 'XYZ' })
    expect(result.flags).toContain('Ann Ray: check initials "XYZ" (not a known society abbreviation)')
  })
})

describe('header-row tables and printed-catalogue lists still work', () => {
  it('reads a table with a header row including dimensions', async () => {
    const result = await parseWordDocument(await docx([new Table({ rows: [
      row(['First name'], ['Surname'], ['Section'], ['Title'], ['Medium'], ['Dimensions'], ['Price']),
      row(['Jenny'], ['Musker VPRMS'], ['Sculpture'], ['Wren in Bronze'], ['bronze'], ['6 x 4 cm'], ['£600']),
    ] })]))
    expect(result.artists[0]).toMatchObject({ firstName: 'Jenny', surname: 'Musker' })
    expect(result.artists[0].works[0]).toMatchObject({ title: 'Wren in Bronze', medium: 'bronze', dimensions: '6 x 4 cm', price: '600', section: 'sculpture' })
  })

  it('reads a printed-catalogue style list', async () => {
    const result = await parseWordDocument(await docx([
      p('LIST OF EXHIBITS – SCULPTURES', { bold: true }),
      p('BILL MUNDY RMS HS', { bold: true }),
      p('GOLD MEMORIAL BOWL 1986', { italics: true }),
      tabs('400', 'Hare (bronze)', '650'),
    ]))
    expect(result.artists[0]).toMatchObject({ firstName: 'Bill', surname: 'Mundy', initials: 'RMS HS', awards: ['GOLD MEMORIAL BOWL 1986'] })
    expect(result.artists[0].works[0]).toMatchObject({ title: 'Hare', medium: 'bronze', price: '650', section: 'sculpture' })
  })

  it('rejects files that are not .docx', async () => {
    await expect(parseWordDocument(new TextEncoder().encode('nope').buffer as ArrayBuffer, 'old.doc')).rejects.toThrow(/old\.doc is not a \.docx/)
  })
})
