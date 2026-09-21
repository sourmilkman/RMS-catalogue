import JSZip from 'jszip'
import type { ExportRow } from './exportDocx'

function safeName(value: string, fallback: string): string {
  const cleaned = [...value].map((character) => character.charCodeAt(0) < 32 ? '_' : character).join('').replace(/[<>:"/\\|?*]/g, '_').trim()
  return cleaned || fallback
}

export function offlineImageNames(rows: ExportRow[]): Map<string, string> {
  const used = new Set<string>()
  const names = new Map<string, string>()
  for (const row of rows) {
    if (!row.localImage) continue
    const original = safeName(row.localImageName ?? '', `${row.rNumber || row.artworkId}.jpg`)
    const dot = original.lastIndexOf('.')
    const stem = dot > 0 ? original.slice(0, dot) : original
    const ext = dot > 0 ? original.slice(dot) : ''
    let candidate = original
    let suffix = 2
    while (used.has(candidate.toLocaleLowerCase())) candidate = `${stem}-${suffix++}${ext}`
    used.add(candidate.toLocaleLowerCase())
    names.set(row.artworkId, candidate)
  }
  return names
}

export async function createOfflineBackup(rows: ExportRow[]): Promise<Blob> {
  const XLSX = await import('@e965/xlsx')
  const imageNames = offlineImageNames(rows)
  const headers = ['R Number', 'First Name', 'Surname', 'Title', 'Yes', 'No', 'Maybe', 'Email', 'DOB / Young Artist', 'Online Image', 'Drive Image', 'Offline Image']
  const values = [headers, ...rows.map((row) => [
    row.rNumber, row.firstName, row.surname, row.title, row.yes, row.no, row.maybe, row.email, row.dobYoungArtist,
    row.imageUrl ?? '', row.driveImageUrl ?? '', imageNames.has(row.artworkId) ? `images/${imageNames.get(row.artworkId)}` : '',
  ])]
  const sheet = XLSX.utils.aoa_to_sheet(values)
  rows.forEach((row, index) => {
    const excelRow = index + 2
    if (row.imageUrl) sheet[`J${excelRow}`].l = { Target: row.imageUrl, Tooltip: 'Open source image' }
    if (row.driveImageUrl) sheet[`K${excelRow}`].l = { Target: row.driveImageUrl, Tooltip: 'Open uploaded image' }
    const localName = imageNames.get(row.artworkId)
    if (localName) sheet[`L${excelRow}`].l = { Target: `images/${localName}`, Tooltip: 'Open offline image' }
  })
  sheet['!cols'] = headers.map((header) => ({ wch: Math.max(12, header.length + 2) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Selection')
  const zip = new JSZip()
  zip.file('RMS-Catalogue-Selection.xlsx', XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }))
  for (const row of rows) {
    const name = imageNames.get(row.artworkId)
    if (name && row.localImage) zip.file(`images/${name}`, row.localImage)
  }
  zip.file('README.txt', 'Keep the spreadsheet and images folder together. Extract the ZIP before opening the spreadsheet so offline image links work.\r\n')
  return zip.generateAsync({ type: 'blob' })
}

export async function downloadOfflineBackup(rows: ExportRow[]): Promise<void> {
  const blob = await createOfflineBackup(rows)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `RMS-Catalogue-Offline-${new Date().toISOString().slice(0, 10)}.zip`
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
