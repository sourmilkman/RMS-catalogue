import {
  AlignmentType, BorderStyle, Document, Footer, PageNumber, Packer, Paragraph, Table, TableCell,
  TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx'
import type { ArtistOverride, ArtistSubmission, ArtworkDecision } from '../types'
import { capitaliseName } from './names'

const FONT = 'Times New Roman'
const PAGE_WIDTH = 8391
const CONTENT_WIDTH = 6900
const noBorders = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } }

function paragraph(text: string, options: { bold?: boolean; italic?: boolean; align?: typeof AlignmentType.RIGHT; before?: number; after?: number; keepNext?: boolean; size?: number } = {}): Paragraph {
  return new Paragraph({
    alignment: options.align,
    keepNext: options.keepNext,
    spacing: { before: options.before ?? 0, after: options.after ?? 0, line: 240 },
    children: [new TextRun({ text, font: FONT, size: options.size ?? 21, bold: options.bold, italics: options.italic, color: '000000' })],
  })
}

function cell(content: Paragraph[], width: number, left = 0): TableCell {
  return new TableCell({ width: { size: width, type: WidthType.DXA }, margins: { top: 0, bottom: 0, left, right: 0 }, borders: noBorders, children: content })
}

export type CatalogueSectionKey = 'sculptures' | 'paintings' | 'young'

export const CATALOGUE_SECTIONS: { key: CatalogueSectionKey; title: string }[] = [
  { key: 'sculptures', title: 'LIST OF EXHIBITS – SCULPTURES' },
  { key: 'paintings', title: 'LIST OF EXHIBITS – MINIATURE PAINTINGS' },
  { key: 'young', title: 'LIST OF EXHIBITS – YOUNG ARTISTS' },
]

export function catalogueSectionFor(artist: ArtistSubmission, override?: ArtistOverride): CatalogueSectionKey {
  // Young Artists take priority, so a young sculptor is listed under Young Artists.
  if (artist.youngArtistAge !== undefined || override?.youngArtist) return 'young'
  if (override?.sculptor) return 'sculptures'
  return 'paintings'
}

function sortKey(artist: ArtistSubmission, overrides: Record<string, ArtistOverride>): string {
  return `${overrides[artist.id]?.surname ?? artist.surname} ${overrides[artist.id]?.firstName ?? artist.firstName}`.trim()
}

/** Sections in fixed order (Sculptures, Miniature Paintings, Young Artists), each A–Z by surname, numbered continuously. Empty sections are omitted. */
export function catalogueSections(artists: ArtistSubmission[], decisions: Record<string, ArtworkDecision>, overrides: Record<string, ArtistOverride>, startNumber = 1) {
  let number = startNumber
  const accepted = artists
    .filter((artist) => artist.artworks.some((artwork) => decisions[artwork.id]?.decision === 'included'))
    .sort((a, b) => sortKey(a, overrides).localeCompare(sortKey(b, overrides), 'en-GB', { sensitivity: 'base' }))
  return CATALOGUE_SECTIONS.flatMap((section) => {
    const entries = accepted.filter((artist) => catalogueSectionFor(artist, overrides[artist.id]) === section.key).map((artist) => {
      const override = overrides[artist.id]
      const name = capitaliseName(`${override?.firstName ?? artist.firstName} ${override?.surname ?? artist.surname}`).toLocaleUpperCase()
      return {
        artistId: artist.id,
        heading: [name, override?.societyInitials?.trim().toLocaleUpperCase()].filter(Boolean).join(' '),
        awardText: override?.awardText?.trim().toLocaleUpperCase() ?? '',
        artworks: artist.artworks.filter((artwork) => decisions[artwork.id]?.decision === 'included').map((artwork) => ({
          number: String(number++).padStart(3, '0'),
          description: artwork.medium ? `${artwork.title || 'Untitled'} (${artwork.medium})` : artwork.title || 'Untitled',
          price: artwork.price?.replace(/^£\s*/, '') ?? '',
        })),
      }
    })
    return entries.length ? [{ ...section, entries }] : []
  })
}

/** Flat list of all entries in catalogue order. */
export function catalogueEntries(artists: ArtistSubmission[], decisions: Record<string, ArtworkDecision>, overrides: Record<string, ArtistOverride>, startNumber = 1) {
  return catalogueSections(artists, decisions, overrides, startNumber).flatMap((section) => section.entries)
}

export async function createPrintedCatalogueDocx(artists: ArtistSubmission[], decisions: Record<string, ArtworkDecision>, overrides: Record<string, ArtistOverride>, startNumber = 1): Promise<Blob> {
  const sections = catalogueSections(artists, decisions, overrides, startNumber)
  const children: (Paragraph | Table)[] = []
  sections.forEach((section, index) => {
    children.push(new Paragraph({ pageBreakBefore: index > 0, keepNext: true, spacing: { after: 0 }, alignment: AlignmentType.RIGHT, children: [new TextRun({ text: '£', font: FONT, size: 21, color: '000000' })] }))
    children.push(paragraph(section.title, { bold: true, size: 27, after: 300, keepNext: true }))
    for (const entry of section.entries) {
      const rows = [
        new TableRow({ cantSplit: true, children: [cell([paragraph('')], 650), cell([paragraph(entry.heading, { bold: true, before: 160, after: entry.awardText ? 0 : 65, keepNext: true })], 5350, 100), cell([paragraph('')], 900)] }),
        ...(entry.awardText ? [new TableRow({ cantSplit: true, children: [cell([paragraph('')], 650), cell([paragraph(entry.awardText, { italic: true, after: 55, keepNext: true })], 5350, 100), cell([paragraph('')], 900)] })] : []),
        ...entry.artworks.map((artwork) => new TableRow({ cantSplit: true, children: [
          cell([paragraph(artwork.number, { align: AlignmentType.RIGHT })], 650),
          cell([paragraph(artwork.description)], 5350, 100),
          cell([paragraph(artwork.price, { align: AlignmentType.RIGHT })], 900),
        ] })),
      ]
      children.push(new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: [650, 5350, 900], borders: noBorders, rows }))
    }
  })
  return Packer.toBlob(new Document({
    creator: 'RMS Catalogue Selection', title: 'RMS Exhibition Catalogue', description: 'Catalogue-ready list of accepted RMS exhibition artworks.',
    sections: [{
      properties: { page: { size: { width: PAGE_WIDTH, height: 11906 }, margin: { top: 700, right: 745, bottom: 700, left: 745, header: 260, footer: 260 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 17 })] })] }) },
      children,
    }],
  }))
}

export async function downloadPrintedCatalogueDocx(artists: ArtistSubmission[], decisions: Record<string, ArtworkDecision>, overrides: Record<string, ArtistOverride>, startNumber = 1): Promise<void> {
  const blob = await createPrintedCatalogueDocx(artists, decisions, overrides, startNumber)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `RMS-Exhibition-Catalogue-${new Date().toISOString().slice(0, 10)}.docx`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
