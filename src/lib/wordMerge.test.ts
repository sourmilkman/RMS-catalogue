import { describe, expect, it } from 'vitest'
import type { ArtistSubmission, SourceSnapshot } from '../types'
import type { WordArtist } from './wordImport'
import { applyWordOverlay, titleKey } from './wordMerge'
import { isYoungArtist } from './catalogueRules'

const votes = { yes: 3, no: 0, maybe: 0, valid: true, raw: 'Yes: 3' }
function sheetArtist(id: string, fullName: string, titles: string[]): ArtistSubmission {
  const [firstName, ...rest] = fullName.split(' ')
  return { id, sourceRow: 1, fullName, firstName, surname: rest.join(' '), warnings: [], artworks: titles.map((title, index) => ({ id: `${id}-${index}`, artistId: id, position: index + 1, title, imageUrl: `https://img/${id}-${index}.jpg`, votes, verdict: 'yes', warnings: [] })) }
}
function word(firstName: string, surname: string, works: [string, string, string, WordArtist['works'][number]['section']?][], extra: Partial<WordArtist> = {}): WordArtist {
  const key = `${firstName} ${surname}`.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return { key, firstName, surname, initials: '', awards: [], sources: ['test.docx'], ...extra, works: works.map(([title, medium, price, section]) => ({ title, medium, price, section: section ?? 'painting', source: 'test.docx' })) }
}
const base: SourceSnapshot = { id: 'latest', syncedAt: '2026-10-12T00:00:00Z', artists: [
  sheetArtist('s1', 'Karen Bendersky', ['Mouse!', 'The Legend of King Arthur-Before the Battle', 'Rejected one']),
  sheetArtist('s2', 'Dr Linda Smith PPSWA', ['Negros Fruit Dove - Critically Endangered']),
  sheetArtist('s3a', 'MAUREEN HALLAHAN', ['My Robin', 'Artwork 2']),
  sheetArtist('s3b', 'MAUREEN HALLAHAN', ['My Magpie']),
  sheetArtist('s4', 'Diana Wyles', ['stor', 'Portrait of a Red Fox']),
  sheetArtist('s5', 'Not Accepted', ['Something']),
] }

describe('Word lists merged into the existing cards', () => {
  const lists = [
    word('Karen', 'Bendersky', [['Mouse!', 'oil on board', '190'], ['Legend of King Arthur - Before the Battle', 'oil on board', '400'], ['Brand New', 'oil on board', '250']]),
    word('Linda', 'Smith', [['Negros Fruit Dove - Critically Endangered', 'egg tempera on paper', '395']], { initials: 'PPSWA' }),
    word('Maureen', 'Hallahan', [['My Robin', 'watercolour and gold leaf on board', '200'], ['My Magpie', 'watercolour and gold leaf on board', '200']]),
    word('Diana M', 'Wyles', [['Storm Watcher', 'watercolour on board', '350']]),
    word('Paul', 'Eaton', [['Aquila', 'solid bronze', '4485', 'sculpture']], { initials: 'VPRMS', awards: ['GOLD MEMORIAL BOWL 2000'] }),
    word('Jack', 'Savage', [['Kitchen', 'oil on board', '500', 'young']], { age: 25 }),
  ]
  const merged = applyWordOverlay(base, { artists: lists })
  const art = (id: string) => merged.snapshot.artists.find((artist) => artist.id === id)!

  it('ignores the "Legend of King Arthur" prefix and keeps images, taking Word title/medium/price', () => {
    expect(titleKey('The Legend of King Arthur-Before the Battle')).toBe(titleKey('Legend of King Arthur - Before the Battle'))
    expect(art('s1').artworks[1]).toMatchObject({ id: 's1-1', title: 'Legend of King Arthur - Before the Battle', medium: 'oil on board', price: '400', imageUrl: 'https://img/s1-1.jpg' })
  })

  it('adds unlisted Word works, includes listed works and excludes the rest of a listed artist', () => {
    const added = art('s1').artworks.find((artwork) => artwork.title === 'Brand New')!
    expect(added.id).toMatch(/^word-/)
    expect(merged.include).toEqual(expect.arrayContaining(['s1-0', 's1-1', added.id]))
    expect(merged.exclude).toContain('s1-2')
  })

  it('matches names loosely and treats duplicate submission rows as one artist', () => {
    expect(merged.report.nameMatches).toEqual(expect.arrayContaining([
      'Linda Smith → "Dr Linda Smith PPSWA" (name contained)',
      'Diana M Wyles → "Diana Wyles" (surname + first initial)',
    ]))
    expect(merged.include).toEqual(expect.arrayContaining(['s3a-0', 's3b-0']))
    expect(merged.exclude).toContain('s3a-1')
    expect(merged.details.s2).toMatchObject({ firstName: 'Linda', surname: 'Smith', societyInitials: 'PPSWA' })
  })

  it('treats a truncated sheet title as a close match and reports it', () => {
    expect(art('s4').artworks[0]).toMatchObject({ title: 'Storm Watcher', imageUrl: 'https://img/s4-0.jpg' })
    expect(merged.report.closeTitles).toContain('Diana M Wyles: "Storm Watcher" ← sheet "stor"')
  })

  it('creates new artists with section, young flag, age, initials and awards', () => {
    const eaton = merged.snapshot.artists.find((artist) => artist.fullName === 'Paul Eaton')!
    expect(eaton.artworks[0]).toMatchObject({ title: 'Aquila', sculpture: true, price: '4485' })
    expect(merged.details[eaton.id]).toMatchObject({ societyInitials: 'VPRMS', awardText: 'GOLD MEMORIAL BOWL 2000' })
    const savage = merged.snapshot.artists.find((artist) => artist.fullName === 'Jack Savage')!
    expect(savage).toMatchObject({ youngArtist: true, youngArtistAge: 25 })
    expect(merged.report.newArtists).toEqual(['Paul Eaton', 'Jack Savage'])
  })

  it('lets the Word lists decide Young Artists even when the submission gave an age', () => {
    const aged = { ...sheetArtist('s9', 'Drithi Puliyanda', ['The Arrival']), youngArtistAge: 22 }
    const result = applyWordOverlay({ ...base, artists: [aged] }, { artists: [word('Drithi', 'Puliyanda', [['The Arrival', 'ink on paper', '340']])] })
    expect(isYoungArtist(result.snapshot.artists[0])).toBe(false)
    expect(isYoungArtist(result.snapshot.artists[0], { artistId: 's9', firstName: 'Drithi', surname: 'Puliyanda', youngArtist: true, youngArtistSet: true, societyInitials: '', awardText: '' })).toBe(true)
  })

  it('lists submissions that are not in any Word list without changing them', () => {
    expect(merged.report.notInLists).toEqual([{ artistId: 's5', name: 'Not Accepted', artworkIds: ['s5-0'] }])
    expect(merged.include).not.toContain('s5-0')
    expect(merged.exclude).not.toContain('s5-0')
  })

  it('is idempotent: re-applying (as after a Sheet refresh) changes nothing', () => {
    const again = applyWordOverlay(merged.snapshot, { artists: lists })
    expect(again.snapshot.artists.map((artist) => [artist.id, artist.artworks.map((artwork) => [artwork.id, artwork.title, artwork.price])]))
      .toEqual(merged.snapshot.artists.map((artist) => [artist.id, artist.artworks.map((artwork) => [artwork.id, artwork.title, artwork.price])]))
    expect(again.report.newArtists).toEqual([])
    const fromRawSheet = applyWordOverlay(base, { artists: lists })
    expect(fromRawSheet.snapshot.artists.map((artist) => artist.id)).toEqual(merged.snapshot.artists.map((artist) => artist.id))
  })
})
