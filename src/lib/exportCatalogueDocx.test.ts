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
const decisions = Object.fromEntries(all.flatMap((artist) => artist.artworks.map((artwork) => [artwork.id, included])))
const overrides = {
  a: override('a', { societyInitials: 'RMS', awardText: 'Gold Memorial Bowl 2026' }, smith),
  d: override('d', { sculptor: true }, sculptor),
  e: override('e', { sculptor: true }, mcSculptor),
}

describe('printed catalogue Word export', () => {
  it('orders sections Sculptures, Miniature Paintings, Young Artists, each A–Z by surname, numbered continuously', () => {
    const sections = catalogueSections(all, decisions, overrides)
    expect(sections.map((section) => section.key)).toEqual(['sculptures', 'paintings', 'young'])
    expect(sections[0].entries.map((entry) => entry.heading)).toEqual(['AL MCCANN', 'ZOE MUNDY'])
    expect(sections[1].entries.map((entry) => entry.heading)).toEqual(['TOM ABBOT', 'JANE SMITH RMS'])
    expect(sections[2].entries.map((entry) => entry.heading)).toEqual(['AMY BAKER'])
    expect(catalogueEntries(all, decisions, overrides).flatMap((entry) => entry.artworks.map((artwork) => artwork.number))).toEqual(['001', '002', '003', '004', '005', '006'])
  })

  it('formats entries and strips the currency symbol from prices', () => {
    const [entry] = catalogueEntries([smith], decisions, overrides)
    expect(entry).toMatchObject({ heading: 'JANE SMITH RMS', awardText: 'GOLD MEMORIAL BOWL 2026' })
    expect(entry.artworks[0]).toEqual({ number: '001', description: 'Red Fox (watercolour on paper)', price: '275' })
  })

  it('lists a young sculptor under Young Artists and omits empty sections and excluded works', () => {
    const youngSculptor = { d: override('d', { sculptor: true, youngArtist: true }, sculptor) }
    const sections = catalogueSections([sculptor, smith], { 'd-0': included, 'a-0': excluded }, youngSculptor)
    expect(sections.map((section) => section.key)).toEqual(['young'])
  })

  it('creates a portrait A5 Word document with section headings', async () => {
    const blob = await createPrintedCatalogueDocx(all, decisions, overrides, 1)
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    const xml = await zip.file('word/document.xml')!.async('string')
    const order = ['SCULPTURES', 'MINIATURE PAINTINGS', 'YOUNG ARTISTS'].map((title) => xml.indexOf(`LIST OF EXHIBITS – ${title}`))
    expect(order.every((position) => position >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(xml).toContain('£')
    expect(xml).toContain('w:w="8391" w:h="11906"')
    expect(zip.file('word/header1.xml')).toBeNull()
  })
})
