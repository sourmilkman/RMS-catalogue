import type { ArtistOverride, ArtistSubmission, ArtworkDecision } from '../types'
import { awardLines, catalogueSections } from './exportCatalogueDocx'
import { artworkSize, sizeLabel } from './dimensions'

/**
 * One row per catalogued artwork for the online exhibition, numbered exactly as the printed catalogue.
 */
export interface WebsiteRow {
  artworkId: string
  catalogueNumber: string
  section: string
  firstName: string
  surname: string
  initials: string
  award: string
  title: string
  medium: string
  dimensions: string
  sizeSource: string
  price: string
  imageUrl: string
  imageFile: string
  localImage?: Blob
  localImageName?: string
  driveImageUrl?: string
}

export const WEBSITE_HEADER = ['Cat No', 'Section', 'First Name', 'Surname', 'Society Initials', 'Award', 'Title', 'Medium', 'Size', 'Size Source', 'Price (£)', 'Image Link', 'Image File']
const SECTION_LABEL = { 'sculptures': 'Sculpture', 'paintings': 'Miniature Painting', 'young-14-17': 'Young Artist (14–17)', 'young-18-30': 'Young Artist (18–30)', 'young-no-age': 'Young Artist (age not given)' } as const

export function websiteRows(artists: ArtistSubmission[], decisions: Record<string, ArtworkDecision>, overrides: Record<string, ArtistOverride>): WebsiteRow[] {
  const byId = new Map(artists.flatMap((artist) => artist.artworks.map((artwork) => [artwork.id, { artist, artwork }] as const)))
  return catalogueSections(artists, decisions, overrides).flatMap((section) => section.entries.flatMap((entry) => entry.artworks.map((item) => {
    const { artist, artwork } = byId.get(item.artworkId)!
    const override = overrides[artist.id]
    const size = artworkSize(artwork)
    return {
      artworkId: artwork.id,
      catalogueNumber: item.number,
      section: SECTION_LABEL[section.key],
      firstName: override?.firstName ?? artist.firstName,
      surname: override?.surname ?? artist.surname,
      initials: override?.societyInitials?.trim() ?? '',
      award: awardLines(override?.awardText).join(' / '),
      title: artwork.title,
      medium: artwork.medium ?? '',
      dimensions: size?.value ?? '',
      sizeSource: size ? sizeLabel(size) : '',
      price: item.price,
      imageUrl: artwork.imageUrl ?? '',
      imageFile: artwork.localImageName ?? '',
      localImage: artwork.localImage,
      localImageName: artwork.localImageName,
    }
  })))
}

export function websiteValues(row: WebsiteRow): string[] {
  return [row.catalogueNumber, row.section, row.firstName, row.surname, row.initials, row.award, row.title, row.medium, row.dimensions, row.sizeSource, row.price, row.driveImageUrl || row.imageUrl, row.imageFile]
}

export async function downloadWebsiteWorkbook(rows: WebsiteRow[]): Promise<void> {
  const XLSX = await import('@e965/xlsx')
  const sheet = XLSX.utils.aoa_to_sheet([WEBSITE_HEADER, ...rows.map(websiteValues)])
  sheet['!cols'] = [6, 20, 14, 16, 22, 24, 40, 40, 16, 18, 10, 50, 28].map((wch) => ({ wch }))
  rows.forEach((row, index) => {
    const link = row.driveImageUrl || row.imageUrl
    const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: 11 })]
    if (link && cell) cell.l = { Target: link }
  })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Website')
  XLSX.writeFile(book, `RMS-Website-Exhibition-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
