import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx'
import type { ArtistOverride, ArtistSubmission, ArtworkDecision, Verdict } from '../types'
import { isValidHttpUrl } from './identity'

export interface ExportRow {
  artistId: string
  artworkId: string
  firstName: string
  surname: string
  title: string
  yes: number
  no: number
  maybe: number
  email: string
  dobYoungArtist: string
  imageUrl?: string
  includeDownload: boolean
  verdict: Verdict
}

export function getExportRows(artists: ArtistSubmission[], decisions: Record<string, ArtworkDecision>, overrides: Record<string, ArtistOverride>): ExportRow[] {
  return artists.flatMap((artist) => {
    const override = overrides[artist.id]
    const emitted = new Set<string>()
    return artist.artworks.flatMap((artwork) => {
      const state = decisions[artwork.id]
      if (!state || state.decision !== 'included') return []
      const once = (field: 'firstName' | 'surname' | 'email' | 'dob', value: string) => {
        if (!state.fields[field] || emitted.has(field)) return ''
        emitted.add(field)
        return value
      }
      const dobYoung = [artist.dateOfBirth, override?.youngArtist ? 'Young Artist' : ''].filter(Boolean).join(' · ')
      return [{
        artistId: artist.id,
        artworkId: artwork.id,
        firstName: once('firstName', override?.firstName ?? artist.firstName),
        surname: once('surname', override?.surname ?? artist.surname),
        title: state.fields.title ? artwork.title : '',
        yes: artwork.votes.yes,
        no: artwork.votes.no,
        maybe: artwork.votes.maybe,
        email: once('email', artist.email ?? ''),
        dobYoungArtist: once('dob', dobYoung),
        imageUrl: artwork.imageUrl,
        includeDownload: state.fields.download,
        verdict: artwork.verdict,
      }]
    })
  })
}

const widths = [1500, 1600, 3500, 550, 550, 550, 2600, 2000, 1750]
const borders = { style: BorderStyle.SINGLE, size: 4, color: '8A9391' }

function cell(text: string, width: number, options: { fill?: string; bold?: boolean; align?: typeof AlignmentType.CENTER } = {}): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 110, bottom: 110, left: 120, right: 120 },
    shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill } : undefined,
    borders: { top: borders, bottom: borders, left: borders, right: borders },
    children: [new Paragraph({ alignment: options.align, spacing: { before: 0, after: 0 }, children: [new TextRun({ text, bold: options.bold, font: 'Aptos', size: 18 })] })],
  })
}

function downloadCell(row: ExportRow): TableCell {
  const valid = row.includeDownload && isValidHttpUrl(row.imageUrl)
  return new TableCell({
    width: { size: widths[8], type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 110, bottom: 110, left: 120, right: 120 },
    borders: { top: borders, bottom: borders, left: borders, right: borders },
    children: [new Paragraph({
      spacing: { before: 0, after: 0 },
      alignment: AlignmentType.CENTER,
      children: valid
        ? [new ExternalHyperlink({ link: row.imageUrl!, children: [new TextRun({ text: 'Download image', style: 'Hyperlink', font: 'Aptos', size: 18 })] })]
        : [new TextRun({ text: row.includeDownload ? 'No image URL' : '', font: 'Aptos', size: 18 })],
    })],
  })
}

function voteFill(verdict: Verdict, column: 'yes' | 'no' | 'maybe'): string | undefined {
  if (verdict === 'tie') return 'F5E3A5'
  if (verdict === column) return verdict === 'yes' ? 'B7DFC9' : verdict === 'no' ? 'EDB8B4' : 'F5E3A5'
  return undefined
}

export async function createCatalogueDocx(artists: ArtistSubmission[], decisions: Record<string, ArtworkDecision>, overrides: Record<string, ArtistOverride>): Promise<Blob> {
  const rows = getExportRows(artists, decisions, overrides)
  const headers = ['First Name', 'Surname', 'Title', 'Y', 'N', 'M', 'email', 'DOB / Young artists', 'Dwld img']
  const tableRows = [
    new TableRow({ tableHeader: true, children: headers.map((header, index) => cell(header, widths[index], { fill: '465154', bold: true, align: AlignmentType.CENTER })) }),
    ...rows.map((row) => new TableRow({ children: [
      cell(row.firstName, widths[0]),
      cell(row.surname, widths[1]),
      cell(row.title, widths[2]),
      cell(String(row.yes), widths[3], { fill: voteFill(row.verdict, 'yes'), align: AlignmentType.CENTER }),
      cell(String(row.no), widths[4], { fill: voteFill(row.verdict, 'no'), align: AlignmentType.CENTER }),
      cell(String(row.maybe), widths[5], { fill: voteFill(row.verdict, 'maybe'), align: AlignmentType.CENTER }),
      cell(row.email, widths[6]),
      cell(row.dobYoungArtist, widths[7]),
      downloadCell(row),
    ] })),
  ]
  const document = new Document({
    creator: 'RMS Catalogue Selection',
    title: 'RMS Catalogue Selection',
    description: 'Working selection document generated from the RMS catalogue PWA.',
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.LANDSCAPE, width: 15840, height: 12240 },
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: [
        new Paragraph({ spacing: { after: 180 }, children: [new TextRun({ text: 'RMS Catalogue Selection', bold: true, font: 'Aptos Display', size: 32, color: '303739' })] }),
        new Paragraph({ spacing: { after: 260 }, children: [new TextRun({ text: `Generated ${new Date().toLocaleString('en-GB')} · ${rows.length} included artwork${rows.length === 1 ? '' : 's'}`, font: 'Aptos', size: 18, color: '5A6365' })] }),
        new Table({ width: { size: widths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA }, layout: TableLayoutType.FIXED, columnWidths: widths, rows: tableRows }),
      ],
    }],
  })
  return Packer.toBlob(document)
}

export async function downloadCatalogueDocx(artists: ArtistSubmission[], decisions: Record<string, ArtworkDecision>, overrides: Record<string, ArtistOverride>): Promise<void> {
  const blob = await createCatalogueDocx(artists, decisions, overrides)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  const date = new Date().toISOString().slice(0, 10)
  anchor.href = url
  anchor.download = `RMS-Catalogue-Selection-${date}.docx`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
