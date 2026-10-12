import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { ArtistOverride, ArtistSubmission, ArtworkDecision } from '../types'
import { catalogueEntries, catalogueSections, createPrintedCatalogueDocx } from './exportCatalogueDocx'
import { defaultDecision } from './reconcile'

function makeArtist(id: string, firstName: string, surname: string, titles: string[], extra: Partial<ArtistSubmission> = {}): ArtistSubmission {
  return { id, sourceRow: 1, fullName: `${firstName} ${surname}`, firstName, surname, warnings: [], ...extra, artworks: titles.map((title, index) => (
    { id: `${id}-${index}`, artistId: id, position: index + 1, title, medium: 'watercolour on paper', price: '£275', votes: { yes: 1, no: 0, maybe: 0, valid: true, raw: '' }, verdict: 'yes', warnings: [] }
  )) }
}
const override = (artistId: string, patch: Partial<ArtistOverride>, artist: ArtistSubmission): ArtistOverride => ({ artistId, firstName: artist.firstName, surname: artist.surname, youngArtist: false, societyInitials: '', awardText: '', ...patch })
const included: ArtworkDecision = defaultDecision('yes', 'included')
const excluded: ArtworkDecision = defaultDecision('no', 'x')

const smith = makeArtist('a', 'Jane', 'Smith', ['Red Fox'])
const abbot = makeArtist('b', 'Tom', 'Abbot', ['Hare', 'Owl'])
const young = makeArtist('c', 'Amy', 'Baker', ['Wren'], { youngArtistAge: 15 })
const sculptor = makeArtist('d', 'Zoe', 'Mundy', ['Bronze Cat'])
const mcSculptor = makeArtist('e', 'Al', 'McCann', ['Stone Owl'])
const all = [smith, abbot, young, sculptor, mcSculptor]
const decisions: Record<string, ArtworkDecision> = Object.fromEntries(all.flatMap((artist) => artist.artworks.map((artwork) => [artwork.id, included])))
decisions['d-0'] = { ...included, sculpture: true }
decisions['e-0'] = { ...included, sculpture: true }
const overrides = {
  a: override('a', { societyInitials: 'RMS', awardText: 'Gold Memorial Bowl 2026' }, smith),
}

describe('printed catalogue Word export', () => {
  it('orders sections Sculptures, Miniature Paintings, Young Artists, each A–Z by surname, numbered continuously', () => {
    const sections = catalogueSections(all, decisions, overrides)
    expect(sections.map((section) => section.key)).toEqual(['sculptures', 'paintings', 'young-14-17'])
    expect(sections[0].entries.map((entry) => entry.heading)).toEqual(['AL MCCANN', 'ZOE MUNDY'])
    expect(sections[1].entries.map((entry) => entry.heading)).toEqual(['TOM ABBOT', 'JANE SMITH RMS'])
    expect(sections[2].entries.map((entry) => entry.heading)).toEqual(['AMY BAKER'])
    expect(catalogueEntries(all, decisions, overrides).flatMap((entry) => entry.artworks.map((artwork) => artwork.number))).toEqual(['001', '002', '003', '004', '005', '006'])
  })

  it('formats entries and strips the currency symbol from prices', () => {
    const [entry] = catalogueEntries([smith], decisions, overrides)
    expect(entry).toMatchObject({ heading: 'JANE SMITH RMS', awardText: 'GOLD MEMORIAL BOWL 2026' })
    expect(entry.artworks[0]).toMatchObject({ number: '001', description: 'Red Fox (watercolour on paper)', price: '275' })
  })

  it('lists a young sculptor under Young Artists and omits empty sections and excluded works', () => {
    const youngSculptor = { d: override('d', { youngArtist: true }, sculptor) }
    const sections = catalogueSections([sculptor, smith], { 'd-0': { ...included, sculpture: true }, 'a-0': excluded }, youngSculptor)
    expect(sections.map((section) => section.key)).toEqual(['young-no-age'])
  })

  it('splits one artist across Sculptures and Miniature Paintings by artwork', () => {
    const both = makeArtist('m', 'Jenny', 'Musker', ['Wren', 'Bronze Wren', 'Robin'])
    const mixed = { 'm-0': included, 'm-1': { ...included, sculpture: true }, 'm-2': included }
    const sections = catalogueSections([both], mixed, {})
    expect(sections.map((section) => [section.key, section.entries.map((entry) => [entry.heading, entry.artworks.map((artwork) => `${artwork.number} ${artwork.description}`)])])).toEqual([
      ['sculptures', [['JENNY MUSKER', ['001 Bronze Wren (watercolour on paper)']]]],
      ['paintings', [['JENNY MUSKER', ['002 Wren (watercolour on paper)', '003 Robin (watercolour on paper)']]]],
    ])
  })

  it('uses the imported sculpture value until the toggle overrides it', () => {
    const imported = makeArtist('w', 'Ann', 'Ray', ['Hare'])
    imported.artworks[0].sculpture = true
    expect(catalogueSections([imported], { 'w-0': included }, {})[0].key).toBe('sculptures')
    expect(catalogueSections([imported], { 'w-0': { ...included, sculpture: false } }, {})[0].key).toBe('paintings')
  })

  it('prints each award line separated by "|" on its own line', async () => {
    const withAwards = { a: override('a', { awardText: 'Gold Memorial Bowl 1986 | Memorial Exhibit' }, smith) }
    const xml = await (await JSZip.loadAsync(await (await createPrintedCatalogueDocx([smith], { 'a-0': included }, withAwards)).arrayBuffer())).file('word/document.xml')!.async('string')
    expect(xml).toContain('>GOLD MEMORIAL BOWL 1986<')
    expect(xml).toContain('>MEMORIAL EXHIBIT<')
  })

  it('splits Young Artists into 14–17 then 18–30, numbering straight through', () => {
    const older = makeArtist('o', 'Ann', 'Adams', ['Moth'], { youngArtistAge: 25 })
    const younger = makeArtist('p', 'Zak', 'Zane', ['Owl'], { youngArtistAge: 15 })
    const sections = catalogueSections([older, younger], { 'o-0': included, 'p-0': included }, {})
    expect(sections.map((section) => [section.title, section.entries.map((entry) => `${entry.artworks[0].number} ${entry.heading}`)])).toEqual([
      ['LIST OF EXHIBITS – YOUNG ARTISTS (14–17)', ['001 ZAK ZANE']],
      ['LIST OF EXHIBITS – YOUNG ARTISTS (18–30)', ['002 ANN ADAMS']],
    ])
  })

  it('creates a portrait A5 Word document with section headings', async () => {
    const blob = await createPrintedCatalogueDocx(all, decisions, overrides, 1)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    const order = ['SCULPTURES', 'MINIATURE PAINTINGS', 'YOUNG ARTISTS (14–17)'].map((title) => xml.indexOf(`LIST OF EXHIBITS – ${title}`))
    expect(order.every((position) => position >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(xml).toContain('£')
    expect(xml).toContain('w:w="8391" w:h="11906"')
    expect(zip.file('word/header1.xml')).toBeNull()
  })
})
