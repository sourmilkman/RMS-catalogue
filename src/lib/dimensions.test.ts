import { describe, expect, it } from 'vitest'
import type { ArtworkSubmission } from '../types'
import { artworkSize, sizeFromFilename } from './dimensions'

describe('artwork size from the image filename', () => {
  it('reads the sizes artists write in their filenames', () => {
    expect(sizeFromFilename('https://eu.jotform.com/uploads/x/Louise-Halliday-Fiona-60x70mm%20Large.jpeg')).toBe('60 × 70 mm')
    expect(sizeFromFilename('Tiffany-Budd-BirdForAllseasons-Mallard-60mmx60mm.jpeg')).toBe('60 × 60 mm')
    expect(sizeFromFilename('Mina-Stoten-Crisp-Packet01-30x20x10mm.jpg')).toBe('30 × 20 × 10 mm')
    expect(sizeFromFilename('Przemysław_Sołdek_Viola_suavis_50x60mm (1).jpg')).toBe('50 × 60 mm')
    expect(sizeFromFilename('Wells Cathedral 11 x 13 cm.JPG')).toBe('11 × 13 cm')
  })

  it('keeps numbers without a unit, marked "unit not stated" (never assumed mm)', async () => {
    const { sizeFromFilenameDetailed } = await import('./dimensions')
    expect(sizeFromFilenameDetailed('Anthony_Meadows_Ceres_102x98 a.JPG')).toEqual({ value: '102 × 98', unitStated: false })
    expect(sizeFromFilenameDetailed('paul-eaton-aquila-1-216x203x127.jpg')).toEqual({ value: '216 × 203 × 127', unitStated: false })
    expect(sizeFromFilenameDetailed('Stephen-D-Overy-Waterside-Castle-Combe-85-50.jpg')).toEqual({ value: '85 × 50', unitStated: false })
    expect(sizeFromFilenameDetailed('Charles DormanOGowan_Shah Wali_Rajput 2_89x112mm (2).jpg')).toEqual({ value: '89 × 112 mm', unitStated: true })
    expect(sizeFromFilenameDetailed('Geoff_Goddard_Anne_is_not_pleased_83_83mm.jpg')).toEqual({ value: '83 × 83 mm', unitStated: true })
    expect(sizeFromFilenameDetailed('pam-duley-morning-stretch-110x99mm_4397.jpg')).toEqual({ value: '110 × 99 mm', unitStated: true })
    expect(sizeFromFilenameDetailed('Tiffany-Budd-StPaulsCathedral-7cm-diameter-plain_6244.jpg')).toEqual({ value: '7 cm diameter', unitStated: true })
  })

  it('never guesses: no unit or no size means no value', () => {
    expect(sizeFromFilename('IMG_2048x1536.jpg')).toBeUndefined()
    expect(sizeFromFilename('Anthony_Meadows_Ceres_102x98 a.JPG')).toBeUndefined()
    expect(sizeFromFilename('Tiffany-Budd-Four-Seasons-2.jpeg')).toBeUndefined()
    expect(sizeFromFilename(undefined)).toBeUndefined()
  })

  it('prefers a size given in the data, then a local image, then the online image', () => {
    const base = { id: 'w', artistId: 'a', position: 1, title: 'T', votes: { yes: 0, no: 0, maybe: 0, valid: false, raw: '' }, verdict: 'tie' as const, warnings: [] }
    const art = (extra: Partial<ArtworkSubmission>) => ({ ...base, ...extra }) as ArtworkSubmission
    expect(artworkSize(art({ dimensions: '6 x 4 cm', imageUrl: 'x-60x70mm.jpg' }))).toEqual({ value: '6 x 4 cm', source: 'given', unitStated: true })
    expect(artworkSize(art({ localImageName: 'claire-80x90mm.jpg', imageUrl: 'x-60x70mm.jpg' }))).toEqual({ value: '80 × 90 mm', source: 'image filename', unitStated: true })
    expect(artworkSize(art({ imageUrl: 'x.jpg' }))).toBeUndefined()
  })
})
