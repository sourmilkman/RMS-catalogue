import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { ExportRow } from './exportDocx'
import { createOfflineBackup, offlineImageNames } from './exportOfflineZip'

const row = (artworkId: string, name: string): ExportRow => ({ artworkId, artistId: 'artist', rNumber: '', firstName: '', surname: '', title: '', yes: 0, no: 0, maybe: 0, email: '', dobYoungArtist: '', includeDownload: true, verdict: 'tie', localImage: new Blob(['image']), localImageName: name })

describe('offline export images', () => {
  it('creates safe unique image paths for duplicate filenames', () => {
    const names = offlineImageNames([row('one', 'portrait.jpg'), row('two', 'portrait.jpg')])
    expect(names.get('one')).toBe('portrait.jpg')
    expect(names.get('two')).toBe('portrait-2.jpg')
  })

  it('packages the Excel workbook and local images together', async () => {
    const zip = await JSZip.loadAsync(await createOfflineBackup([row('one', 'portrait.jpg')]))
    expect(zip.file('RMS-Catalogue-Selection.xlsx')).toBeTruthy()
    expect(zip.file('images/portrait.jpg')).toBeTruthy()
    expect(await zip.file('README.txt')!.async('string')).toContain('Extract the ZIP')
  })
})
