import type { ArtworkSubmission, SourceSnapshot } from '../types'
import { normalizeIdentity } from './identity'
import { normaliseSheetCsv } from './normalise'

export interface ImageImportResult {
  snapshot: SourceSnapshot
  matched: number
  unmatched: string[]
}

function artworkCount(snapshot?: SourceSnapshot): number {
  return snapshot?.artists.reduce((total, artist) => total + artist.artworks.length, 0) ?? 0
}

export function importDifference(previous: SourceSnapshot | undefined, next: SourceSnapshot): string | undefined {
  if (!previous) return undefined
  const compact = (snapshot: SourceSnapshot) => snapshot.artists.map((artist) => [
    artist.fullName, artist.email, artist.youngArtistAge,
    artist.artworks.map((artwork) => [artwork.position, artwork.title, artwork.medium, artwork.votes.raw, artwork.imageUrl]),
  ])
  if (JSON.stringify(compact(previous)) === JSON.stringify(compact(next))) return undefined
  return `This import differs from the cached catalogue. Current: ${previous.artists.length} artists / ${artworkCount(previous)} artworks. Import: ${next.artists.length} artists / ${artworkCount(next)} artworks. Names, titles, votes or image references may also differ. Existing decisions and R numbers will be preserved wherever an artwork can be matched.`
}

export async function parseSpreadsheetFile(file: File): Promise<SourceSnapshot> {
  const XLSX = await import('@e965/xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const firstSheet = workbook.SheetNames[0]
  if (!firstSheet) throw new Error('The spreadsheet contains no worksheets.')
  const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheet], { blankrows: false })
  return { ...normaliseSheetCsv(csv), sourceLabel: file.name }
}

export async function fetchGoogleSheet(link: string): Promise<SourceSnapshot> {
  const supplied = new URL(link.trim())
  const match = supplied.pathname.match(/\/spreadsheets\/d\/([^/]+)/)
  if (!match) throw new Error('Enter a valid Google Sheets link.')
  const gid = supplied.searchParams.get('gid') ?? supplied.hash.match(/gid=(\d+)/)?.[1] ?? '0'
  const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${match[1]}/export`)
  exportUrl.searchParams.set('format', 'csv')
  exportUrl.searchParams.set('gid', gid)
  const response = await fetch(exportUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Google Sheets import failed (${response.status}). Make sure the Sheet is accessible by link.`)
  return { ...normaliseSheetCsv(await response.text()), sourceLabel: supplied.hostname }
}

function fileKey(name: string): string {
  const base = decodeURIComponent(name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '')
  return normalizeIdentity(base)
}

function referenceKey(artwork: ArtworkSubmission): string {
  if (!artwork.imageUrl) return ''
  try { return fileKey(new URL(artwork.imageUrl).pathname) }
  catch { return fileKey(artwork.imageUrl) }
}

function score(file: File, artwork: ArtworkSubmission): number {
  const fileName = fileKey(file.name)
  const reference = referenceKey(artwork)
  const title = normalizeIdentity(artwork.title)
  if (reference && fileName === reference) return 100
  if (reference && (fileName.includes(reference) || reference.includes(fileName))) return 80
  if (title && fileName === title) return 60
  if (title.length >= 5 && (fileName.includes(title) || title.includes(fileName))) return 40
  return 0
}

function withLocalImage(artwork: ArtworkSubmission, file: File): ArtworkSubmission {
  return {
    ...artwork,
    localImage: file,
    localImageName: file.name,
    warnings: artwork.warnings.filter((warning) => !['missing-image', 'invalid-image'].includes(warning.code)),
  }
}

export function applyLocalImages(snapshot: SourceSnapshot, suppliedFiles: File[]): ImageImportResult {
  const files = suppliedFiles.filter((file) => file.type.startsWith('image/') || /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name))
  const unused = new Set(files)
  let matched = 0
  const artists = snapshot.artists.map((artist) => ({
    ...artist,
    artworks: artist.artworks.map((artwork) => {
      const best = [...unused].map((file) => ({ file, score: score(file, artwork) })).sort((a, b) => b.score - a.score)[0]
      if (!best || best.score === 0) return artwork
      unused.delete(best.file)
      matched += 1
      return withLocalImage(artwork, best.file)
    }),
  }))
  return { snapshot: { ...snapshot, artists }, matched, unmatched: [...unused].map((file) => file.name) }
}

export function assignLocalImage(snapshot: SourceSnapshot, artworkId: string, file: File): SourceSnapshot {
  return {
    ...snapshot,
    artists: snapshot.artists.map((artist) => ({
      ...artist,
      artworks: artist.artworks.map((artwork) => artwork.id === artworkId ? withLocalImage(artwork, file) : artwork),
    })),
  }
}

export function carryLocalImages(previous: SourceSnapshot | undefined, next: SourceSnapshot): SourceSnapshot {
  if (!previous) return next
  const prior = previous.artists.flatMap((artist) => artist.artworks).filter((artwork) => artwork.localImage)
  return {
    ...next,
    artists: next.artists.map((artist) => ({
      ...artist,
      artworks: artist.artworks.map((artwork) => {
        const match = prior.find((item) => item.id === artwork.id)
          ?? prior.find((item) => item.imageUrl && item.imageUrl === artwork.imageUrl)
          ?? prior.find((item) => item.title && normalizeIdentity(item.title) === normalizeIdentity(artwork.title))
        return match?.localImage ? withLocalImage(artwork, new File([match.localImage], match.localImageName ?? 'local-image', { type: match.localImage.type })) : artwork
      }),
    })),
  }
}
