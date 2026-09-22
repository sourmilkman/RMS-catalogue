import type { ArtistSubmission, CatalogueDecision, MembershipType } from '../types'

export type OcrProvider = 'offline' | 'online'

export interface OcrArtworkDraft {
  title: string
  medium: string
  dimensions: string
  price: string
  decision: CatalogueDecision
}

export interface OcrEntryDraft {
  membershipType: MembershipType
  fullName: string
  email: string
  address: string
  phone: string
  societyInitials: string
  artworks: OcrArtworkDraft[]
  rawText?: string
}

const emptyArtwork = (): OcrArtworkDraft => ({ title: '', medium: '', dimensions: '', price: '', decision: 'undecided' })

function valueAfter(text: string, label: string): string {
  return text.match(new RegExp(`${label}\\s*[:—-]?\\s*([^\\n]+)`, 'i'))?.[1]?.trim() ?? ''
}

function normaliseDraft(value: Partial<OcrEntryDraft>, membershipType: MembershipType): OcrEntryDraft {
  const artworks: OcrArtworkDraft[] = Array.isArray(value.artworks) ? value.artworks.map((artwork) => {
    const decision: CatalogueDecision = artwork?.decision === 'included' || artwork?.decision === 'excluded' ? artwork.decision : 'undecided'
    return {
      title: String(artwork?.title ?? '').trim(),
      medium: String(artwork?.medium ?? '').trim(),
      dimensions: String(artwork?.dimensions ?? '').trim(),
      price: String(artwork?.price ?? '').replace(/^£\s*/, '').trim(),
      decision,
    }
  }).filter((artwork) => Object.values(artwork).some(Boolean)) : []
  return {
    membershipType,
    fullName: String(value.fullName ?? '').trim(),
    email: String(value.email ?? '').trim(),
    address: String(value.address ?? '').trim(),
    phone: String(value.phone ?? '').trim(),
    societyInitials: String(value.societyInitials ?? '').trim(),
    artworks: artworks.length ? artworks : [emptyArtwork()],
    rawText: value.rawText,
  }
}

export function parseOcrText(text: string, membershipType: MembershipType): OcrEntryDraft {
  const titles = [...text.matchAll(/TITLE\s*[:—-]?\s*([^\n]+)/gi)].map((match) => match[1].trim()).filter(Boolean)
  const media = [...text.matchAll(/MEDIUM\s*[:—-]?\s*([^\n]+)/gi)].map((match) => match[1].trim())
  const artworks = titles.map((title, index) => ({ ...emptyArtwork(), title, medium: media[index] ?? '' }))
  return normaliseDraft({
    fullName: valueAfter(text, 'YOUR NAME'),
    email: valueAfter(text, 'EMAIL'),
    address: valueAfter(text, 'ADDRESS'),
    phone: valueAfter(text, 'PHONE NUMBER'),
    societyInitials: valueAfter(text, 'INITIALS OF ART SOCIETIES OF WHICH YOU ARE A MEMBER'),
    artworks,
    rawText: text,
  }, membershipType)
}

async function firstPdfPage(file: File): Promise<Blob> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString()
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not render the PDF.')), 'image/png'))
}

export async function runOfflineOcr(file: File, membershipType: MembershipType, onProgress?: (progress: number) => void): Promise<OcrEntryDraft> {
  const source = file.type === 'application/pdf' ? await firstPdfPage(file) : file
  const { recognize } = await import('tesseract.js')
  const result = await recognize(source, 'eng', { logger: (message) => { if (message.status === 'recognizing text') onProgress?.(message.progress) } })
  return parseOcrText(result.data.text, membershipType)
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const ONLINE_OCR_URL = import.meta.env.VITE_OCR_API_URL || 'https://rms-catalogue-ocr.vercel.app/api/ocr'

export async function runOnlineOcr(file: File, membershipType: MembershipType): Promise<OcrEntryDraft> {
  const response = await fetch(ONLINE_OCR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ membershipType, mimeType: file.type || 'image/jpeg', data: await dataUrl(file) }),
  })
  const payload = await response.json() as Partial<OcrEntryDraft> & { error?: string }
  if (!response.ok) throw new Error(payload.error || `Online OCR failed (${response.status}). Check the internet connection.`)
  return normaliseDraft(payload, membershipType)
}

export function blankEntry(membershipType: MembershipType): OcrEntryDraft {
  return normaliseDraft({}, membershipType)
}

function identity(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9@]/g, '')
}

export function findDuplicateArtist(artists: ArtistSubmission[], draft: OcrEntryDraft): ArtistSubmission | undefined {
  const email = identity(draft.email)
  const name = identity(draft.fullName)
  return artists.find((artist) => (email && identity(artist.email ?? '') === email) || (name && identity(artist.fullName) === name))
}

export function preserveArtworkImages(existing: ArtistSubmission | undefined, replacement: ArtistSubmission): ArtistSubmission {
  if (!existing) return replacement
  const unused = new Set(existing.artworks.map((artwork) => artwork.id))
  const artworks = replacement.artworks.map((artwork) => {
    const title = identity(artwork.title)
    const matched = existing.artworks.find((candidate) => unused.has(candidate.id) && title && identity(candidate.title) === title)
      ?? existing.artworks.find((candidate) => unused.has(candidate.id) && candidate.position === artwork.position)
    if (!matched) return artwork
    unused.delete(matched.id)
    return { ...artwork, imageUrl: matched.imageUrl, localImage: matched.localImage, localImageName: matched.localImageName }
  })
  return { ...replacement, artworks }
}
