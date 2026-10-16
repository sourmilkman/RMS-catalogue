import { describe, expect, it } from 'vitest'
import type { ArtistSubmission } from '../types'
import { matchImages } from './imageMatch'

const artist = (id: string, firstName: string, surname: string, titles: string[]): ArtistSubmission => ({
  id, sourceRow: 1, fullName: `${firstName} ${surname}`, firstName, surname, warnings: [],
  artworks: titles.map((title, index) => ({ id: `${id}${index}`, artistId: id, position: index + 1, title, votes: { yes: 0, no: 0, maybe: 0, valid: false, raw: '' }, verdict: 'tie', warnings: [] })),
})
const files = (...names: string[]) => names.map((name) => ({ name, path: `Members images/${name}` }))
const pairs = (result: ReturnType<typeof matchImages>) => Object.fromEntries(result.assignments.map((item) => [item.artworkId, item.file.name]))

describe("matching the secretary's image folder (real filenames)", () => {
  it('matches artist first, despite spelling slips, and keeps look-alike artists apart', () => {
    const artists = [
      artist('jb', 'Jenny', 'Brooks', ['Mary Kugelman']), artist('ab', 'Alan Spencer', 'Brooks', ['The Tidal Mill Woodbridge Suffolk']),
      artist('kb', 'Kayleigh', 'Buttgieg', ['Last Bite']), artist('ch', 'Christina', 'Hart-Davies', ['Tree of Life']),
      artist('tg', 'Tara', 'Gill', ['Dormouse']), artist('gw', 'Gill', 'Williams', ['Aurora Over Rattray Head']),
    ]
    const result = matchImages(artists, {}, files('Jenny Brookes-Mary-Kugelman-130x120.jpeg', 'Alan Spencer brooks The tidal mill Woodbridge Suffolk.jpg', 'kayleigh-buttigieg-last-bite-21x21.jpg', 'c-hart-davies-Tree-of-Life-100x85mm.jpeg', 'Tara-Gill-15yo-Dormouse-65mm-oil.png', 'Gill_Williams_Aurora-over-Rattray-Head_110x99mma_6792.JPG'))
    expect(pairs(result)).toEqual({ jb0: 'Jenny Brookes-Mary-Kugelman-130x120.jpeg', ab0: 'Alan Spencer brooks The tidal mill Woodbridge Suffolk.jpg', kb0: 'kayleigh-buttigieg-last-bite-21x21.jpg', ch0: 'c-hart-davies-Tree-of-Life-100x85mm.jpeg', tg0: 'Tara-Gill-15yo-Dormouse-65mm-oil.png', gw0: 'Gill_Williams_Aurora-over-Rattray-Head_110x99mma_6792.JPG' })
  })

  it('never crosses numbered works, and reads Roman numerals only at the end', () => {
    const fonde = artist('df', 'Dominic', 'Fondé', ['Shoebill 1', 'Shoebill 2', 'Peregrin Falcon 2'])
    const trim = artist('pt', 'Pauleen', 'Trim', ['White Bird of Paradise I', 'White Bird of Paradise II'])
    const kracht = artist('lk', 'Linda', 'Kracht', ['Look I’m Here'])
    const result = matchImages([fonde, trim, kracht], {}, files('dominic fonde_shoebill 2_ 75x20mm.jpg', 'dominic fonde_Shoebill 1_75x20mm.jpg', 'Dominic Fonde_Peregrin Flacon 2_60x30mm.jpg', 'Pauleen-Trim-White-Bird-of Paradise-II-100x100mm.jpg', 'Pauleen-Trim-White-Bird-of-Paradise-I-100x100mm.jpg', 'Linda-Kracht-Look-Im-Here.jpg'))
    expect(pairs(result)).toMatchObject({ df0: 'dominic fonde_Shoebill 1_75x20mm.jpg', df1: 'dominic fonde_shoebill 2_ 75x20mm.jpg', df2: 'Dominic Fonde_Peregrin Flacon 2_60x30mm.jpg', pt0: 'Pauleen-Trim-White-Bird-of-Paradise-I-100x100mm.jpg', pt1: 'Pauleen-Trim-White-Bird-of Paradise-II-100x100mm.jpg', lk0: 'Linda-Kracht-Look-Im-Here.jpg' })
    expect(result.approximate.some((item) => item.includes('Peregrin Flacon'))).toBe(true)
  })

  it('keeps scale shots aside, reports unmatched files and works, and refuses a wrong number', () => {
    const russell = artist('cr', 'Claire', 'Russell', ['Athenas Curse - Medusa'])
    const brierton = artist('ib', 'Irene', 'Brierton', ['Boxing Hares', 'A Moment in the Wild', 'Silent Watch'])
    const wali = artist('sw', 'Shah', 'Wali', ['Afghan 1', 'Rajput 1'])
    const result = matchImages([russell, brierton, wali], {}, files('Claire-Russell-Athenas-Curse-50x60mm-scale.jpeg', 'Claire-Russell-Athenas-Curse_50x60mm.jpeg', 'Irene-Brierton-Boxing-Hares.jpeg', 'Irene-Brierton-hare.jpeg', 'Irene-Brierton-Owl.jpeg', 'Charles DormanOGowan_Shah Wali_Afghan 1_89x112mm (2).jpg', 'Charles DormanOGowan_Shah Wali_Rajput 2_89x112mm (2).jpg', 'Random-Photo.jpg'))
    expect(pairs(result).cr0).toBe('Claire-Russell-Athenas-Curse_50x60mm.jpeg')
    expect(result.spares).toEqual(['Claire Russell: Claire-Russell-Athenas-Curse-50x60mm-scale.jpeg'])
    expect(result.worksWithoutImage).toEqual(['Irene Brierton: "A Moment in the Wild"', 'Irene Brierton: "Silent Watch"'])
    expect(result.unmatchedFiles).toEqual(expect.arrayContaining(['Random-Photo.jpg', 'Irene-Brierton-hare.jpeg (Irene Brierton — no title match)']))
    // Rajput 2 is not Rajput 1 — paired only as the artist's last image, and flagged
    expect(result.approximate.some((item) => item.includes('"Rajput 1" ← Charles DormanOGowan_Shah Wali_Rajput 2') && item.includes('please check'))).toBe(true)
  })
})
