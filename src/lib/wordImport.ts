import JSZip from 'jszip'
import type { ArtistSubmission, ArtworkSubmission, DataWarning, SourceSnapshot } from '../types'
import { normalizeIdentity, stableHash } from './identity'
import { splitName } from './names'

/**
 * Reads the final exhibition list from a Word (.docx) file.
 *
 * Two layouts are understood:
 *  1. A table whose first row is a header (First name / Surname / Artist, Title, Medium, Price, Section …), one artwork per row.
 *  2. A catalogue-style list, as printed: section headings ("LIST OF EXHIBITS – SCULPTURES"), artist name lines
 *     (bold or capitals, society initials at the end), optional italic award lines, then numbered artwork lines
 *     "126  Title (medium)  price". Lines may be plain paragraphs (tab-separated) or table rows.
 *
 * Nothing is guessed: anything that cannot be read unambiguously is reported in `flags` (and on the artwork card).
 */

type Section = 'painting' | 'sculpture' | 'young'

interface Line { cells: string[]; raw: string[]; bold: boolean; italic: boolean }
type Block = { kind: 'line'; line: Line } | { kind: 'table'; rows: Line[] }

export interface WordImportResult {
  snapshot: SourceSnapshot
  /** Society initials and award text per artist id, to apply as artist overrides. */
  artistDetails: Record<string, { societyInitials: string; awardText: string }>
  flags: string[]
  stats: { artists: number; artworks: number; sculptures: number; youngArtists: number }
}

// ---------- XML reading ----------

function decodeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    return String.fromCodePoint(lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10))
  })
}

function propertyOn(properties: string, tag: string): boolean {
  const match = properties.match(new RegExp(`<w:${tag}(?:\\s+w:val="([^"]*)")?\\s*/>`))
  return Boolean(match) && !/^(0|false|off|none)$/i.test(match?.[1] ?? '')
}

interface ParagraphText { segments: string[]; bold: boolean; italic: boolean }

function readParagraph(xml: string): ParagraphText {
  const paragraphProps = xml.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)?.[1] ?? ''
  const headingStyle = /<w:pStyle\s+w:val="(Heading|Title|Strong)[^"]*"/i.test(paragraphProps)
  let text = ''
  let boldRuns = 0
  let italicRuns = 0
  let textRuns = 0
  for (const run of xml.match(/<w:r[\s>][\s\S]*?<\/w:r>/g) ?? []) {
    const props = run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? ''
    const caps = propertyOn(props, 'caps')
    let runText = ''
    for (const token of run.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br[^>]*\/>|<w:cr\/>/g) ?? []) {
      if (token === '<w:tab/>') runText += '\t'
      else if (token.startsWith('<w:br') || token === '<w:cr/>') runText += '\n'
      else runText += decodeXml(token.replace(/^<w:t(?:\s[^>]*)?>|<\/w:t>$/g, ''))
    }
    if (caps) runText = runText.toLocaleUpperCase()
    if (runText.trim()) {
      textRuns += 1
      if (propertyOn(props, 'b') || /<w:rStyle\s+w:val="Strong"/i.test(props)) boldRuns += 1
      if (propertyOn(props, 'i')) italicRuns += 1
    }
    text += runText
  }
  return { segments: text.split('\n'), bold: textRuns > 0 && (boldRuns === textRuns || headingStyle), italic: textRuns > 0 && italicRuns === textRuns }
}

function toLine(segment: string, bold: boolean, italic: boolean): Line {
  const raw = segment.split('\t').map((cell) => cell.replace(/\s+/g, ' ').trim())
  return { raw, cells: raw.filter(Boolean), bold, italic }
}

function readTable(xml: string): Line[] {
  return (xml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []).map((row) => {
    const cells = (row.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) ?? []).map((cell) => (cell.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []).map(readParagraph))
    const raw = cells.map((paragraphs) => paragraphs.flatMap((paragraph) => paragraph.segments).join(' ').replace(/\s+/g, ' ').trim())
    const texty = cells.flat().filter((paragraph) => paragraph.segments.join('').trim())
    return { raw, cells: raw.filter(Boolean), bold: texty.length > 0 && texty.every((paragraph) => paragraph.bold), italic: texty.length > 0 && texty.every((paragraph) => paragraph.italic) }
  })
}

function readBlocks(documentXml: string): Block[] {
  const start = documentXml.indexOf('<w:body')
  const body = documentXml.slice(start < 0 ? 0 : start, documentXml.lastIndexOf('</w:body>'))
  const blocks: Block[] = []
  const pattern = /<w:tbl[\s>]|<w:p\/>|<w:p[\s>]/g
  let index = 0
  for (;;) {
    pattern.lastIndex = index
    const match = pattern.exec(body)
    if (!match) break
    if (match[0] === '<w:p/>') { index = match.index + match[0].length; continue }
    if (match[0].startsWith('<w:tbl')) {
      let depth = 0
      const tagPattern = /<w:tbl[\s>]|<\/w:tbl>/g
      tagPattern.lastIndex = match.index
      let end = body.length
      for (let tag = tagPattern.exec(body); tag; tag = tagPattern.exec(body)) {
        depth += tag[0] === '</w:tbl>' ? -1 : 1
        if (depth === 0) { end = tag.index + tag[0].length; break }
      }
      blocks.push({ kind: 'table', rows: readTable(body.slice(match.index, end)) })
      index = end
      continue
    }
    const close = body.indexOf('</w:p>', match.index)
    const end = close < 0 ? body.length : close + 6
    const paragraph = readParagraph(body.slice(match.index, end))
    for (const segment of paragraph.segments) blocks.push({ kind: 'line', line: toLine(segment, paragraph.bold, paragraph.italic) })
    index = end
  }
  return blocks
}

// ---------- Interpretation helpers ----------

const KNOWN_INITIALS = new Set([
  'RMS', 'ARMS', 'PRMS', 'VPRMS', 'HPRMS', 'PPRMS', 'PVPRMS', 'HS', 'HSF', 'SWA', 'PSWA', 'VPSWA', 'PPSWA', 'SBA', 'FSBA', 'SLM', 'SWLA',
  'RWS', 'ARWS', 'RI', 'RBA', 'ROI', 'AROI', 'RSMA', 'RA', 'ARA', 'NEAC', 'PS', 'PPS', 'MAA', 'MASF', 'MPSGS', 'WFM', 'TWASI', 'MBE', 'OBE',
  'CBE', 'BEM', 'FRSA', 'FRBS', 'ARBS', 'RBS', 'SGA', 'SGFA', 'SFP', 'UA', 'SAA', 'SPS', 'PSA', 'RSW', 'RSA', 'RE', 'RWA', 'RBSA', 'MFA', 'BA',
])

function isInitialsToken(token: string): boolean {
  const cleaned = token.replace(/[.,]/g, '')
  return KNOWN_INITIALS.has(cleaned) || /^(H|V|P|PP|A|F|HP|VP|PVP)(RMS|SWA|HS)$/.test(cleaned)
}

function titleCaseName(value: string): string {
  return value.toLocaleLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`)
    .replace(/\bMc(\p{L})/gu, (_match, letter: string) => `Mc${letter.toLocaleUpperCase()}`)
}

function splitHeading(text: string): { name: string; initials: string; warnings: string[] } {
  const tokens = text.replace(/\s+/g, ' ').trim().split(' ')
  const initials: string[] = []
  while (tokens.length > 1 && isInitialsToken(tokens.at(-1)!)) initials.unshift(tokens.pop()!.replace(/[.,]/g, ''))
  const warnings: string[] = []
  const mixedCase = /\p{Ll}/u.test(tokens.join(' '))
  const trailing = tokens.at(-1) ?? ''
  if (tokens.length > 1 && mixedCase && /^[A-Z]{2,6}$/.test(trailing)) warnings.push(`"${trailing}" may be society initials — check the name and initials`)
  if (tokens.length >= 3) warnings.push('Name has three or more parts — check which part is the surname (used for A–Z order)')
  return { name: titleCaseName(tokens.join(' ')), initials: initials.join(' '), warnings }
}

function sectionFromText(text: string): Section | undefined {
  if (/sculpt/i.test(text)) return 'sculpture'
  if (/young/i.test(text)) return 'young'
  if (/paint|miniature/i.test(text)) return 'painting'
  return undefined
}

const SECTION_HEADING = /^(list of exhibits\b.*|(miniature )?paintings?|sculptures?|young (artists?|miniaturists?))(\s*\(continued\))?$/i
const PRICE = /^(£\s?\d[\d,]*(\.\d{2})?|\d[\d,]*(\.\d{2})?|NFS(\s*\(\s*£?\s?\d[\d,]*(\.\d{2})?\s*\))?|SOLD|POA|P\.O\.A\.?)$/i
const TRAILING_SAFE_PRICE = /\s+(£\s?\d[\d,]*(?:\.\d{2})?|NFS(?:\s*\(\s*£?\s?\d[\d,]*(?:\.\d{2})?\s*\))?|SOLD|POA|P\.O\.A\.?)$/i
const TRAILING_NUMBER_AFTER_BRACKET = /\)\s+(\d[\d,]*(?:\.\d{2})?)$/
const AWARD = /(memorial bowl|memorial exhibit|award|prize|medal|trophy|\bbowl\s+\d{4})/i

function cleanPrice(value?: string): string | undefined {
  const trimmed = value?.trim().replace(/^£\s*/, '')
  return trimmed ? trimmed.toLocaleUpperCase().startsWith('NFS') || /^(sold|poa|p\.o\.a\.?)$/i.test(trimmed) ? trimmed.toLocaleUpperCase() : trimmed : undefined
}

/** Splits "Title (medium) [trailing text]" on the last bracketed group. */
function splitDescription(description: string): { title: string; medium?: string; trailing?: string } {
  const close = description.lastIndexOf(')')
  if (close < 0) return { title: description.trim() }
  let depth = 0
  for (let index = close; index >= 0; index -= 1) {
    if (description[index] === ')') depth += 1
    if (description[index] === '(') depth -= 1
    if (depth === 0) {
      const trailing = description.slice(close + 1).trim()
      return { title: description.slice(0, index).trim(), medium: description.slice(index + 1, close).trim() || undefined, trailing: trailing || undefined }
    }
  }
  return { title: description.trim() }
}

// ---------- Builder ----------

interface DraftArtwork { number?: string; description: string; price?: string; section: Section; warnings: DataWarning[]; title: string; medium?: string }
interface DraftArtist { key: string; heading: string; name: string; initials: string; awards: string[]; artworks: DraftArtwork[]; warnings: string[] }

class ImportBuilder {
  artists = new Map<string, DraftArtist>()
  flags: string[] = []
  current?: DraftArtist
  section: Section = 'painting'
  strayNumbers = 0

  artist(heading: string, nameOverride?: { name: string; initials: string }): DraftArtist {
    const parsed = nameOverride ? { ...nameOverride, warnings: [] as string[] } : splitHeading(heading)
    const key = normalizeIdentity(parsed.name)
    let artist = this.artists.get(key)
    if (!artist) {
      artist = { key, heading, name: parsed.name, initials: parsed.initials, awards: [], artworks: [], warnings: parsed.warnings }
      this.artists.set(key, artist)
    } else if (parsed.initials && artist.initials && parsed.initials !== artist.initials) {
      this.flags.push(`${parsed.name}: listed with different initials ("${artist.initials}" and "${parsed.initials}") — kept "${artist.initials}"`)
    } else if (parsed.initials && !artist.initials) artist.initials = parsed.initials
    this.current = artist
    return artist
  }

  artwork(artist: DraftArtist, number: string | undefined, description: string, price: string | undefined, section: Section) {
    const draft: DraftArtwork = { number, description, price: cleanPrice(price), section, warnings: [], title: '' }
    this.describe(draft)
    artist.artworks.push(draft)
  }

  describe(draft: DraftArtwork) {
    const { title, medium, trailing } = splitDescription(draft.description)
    draft.title = title
    draft.medium = medium
    draft.warnings = []
    const label = draft.number ? `Exhibit ${draft.number}` : `"${title}"`
    if (!medium) draft.warnings.push({ code: 'word-no-medium', message: 'No medium in brackets — check the title and medium' })
    if (trailing) draft.warnings.push({ code: 'word-trailing-text', message: `Text after the medium was not imported: "${trailing}"` })
    if (!draft.price) draft.warnings.push({ code: 'word-no-price', message: 'No price found' })
    if (!title) draft.warnings.push({ code: 'word-no-title', message: 'No title found' })
    draft.warnings.forEach((warning) => this.flags.push(`${label}: ${warning.message}`))
  }
}

function parseList(lines: Line[], builder: ImportBuilder) {
  let lastArtwork: DraftArtwork | undefined
  let worksSinceHeading = 0
  for (const line of lines) {
    const text = line.cells.join(' ').trim()
    if (!text || text === '£') continue
    if (SECTION_HEADING.test(text)) {
      const section = sectionFromText(text)
      if (section) builder.section = section
      else builder.flags.push(`Heading not linked to a section: "${text}"`)
      builder.current = undefined
      lastArtwork = undefined
      continue
    }
    if (/^\d{1,4}$/.test(text)) { builder.strayNumbers += 1; continue }

    let number: string | undefined
    let rest: string[] | undefined
    if (/^\d{1,4}[.)]?$/.test(line.cells[0]) && line.cells.length >= 2) { number = line.cells[0].replace(/[.)]/g, ''); rest = line.cells.slice(1) }
    else {
      const match = text.match(/^(\d{1,4})[.)]?\s+(.+)$/)
      if (match) { number = match[1]; rest = [match[2]] }
    }
    if (number && rest) {
      let price: string | undefined
      let description: string
      if (rest.length >= 2 && PRICE.test(rest.at(-1)!)) { price = rest.at(-1); description = rest.slice(0, -1).join(' ') }
      else {
        description = rest.join(' ')
        const safe = description.match(TRAILING_SAFE_PRICE) ?? description.match(TRAILING_NUMBER_AFTER_BRACKET)
        if (safe) { price = safe[1]; description = description.slice(0, description.length - safe[0].length + (safe[0].startsWith(')') ? 1 : 0)).trim() }
      }
      if (!builder.current) { builder.flags.push(`Exhibit ${number} appears before any artist name — not imported: "${text}"`); continue }
      builder.artwork(builder.current, number, description, price, builder.section)
      worksSinceHeading += 1
      lastArtwork = builder.current.artworks.at(-1)
      continue
    }
    if (lastArtwork && !lastArtwork.medium && text.startsWith('(')) {
      // A description that wrapped onto a second line, e.g. "(watercolour on vellum)   2000".
      builder.flags.splice(builder.flags.length - lastArtwork.warnings.length, lastArtwork.warnings.length)
      let continuation = line.cells.join(' ')
      if (!lastArtwork.price && line.cells.length >= 2 && PRICE.test(line.cells.at(-1)!)) { lastArtwork.price = cleanPrice(line.cells.at(-1)); continuation = line.cells.slice(0, -1).join(' ') }
      else if (!lastArtwork.price) {
        const safe = continuation.match(TRAILING_SAFE_PRICE) ?? continuation.match(TRAILING_NUMBER_AFTER_BRACKET)
        if (safe) { lastArtwork.price = cleanPrice(safe[1]); continuation = continuation.slice(0, continuation.length - safe[0].length + (safe[0].startsWith(')') ? 1 : 0)).trim() }
      }
      lastArtwork.description = `${lastArtwork.description} ${continuation}`
      builder.describe(lastArtwork)
      continue
    }
    if (builder.current && worksSinceHeading === 0 && (line.italic || AWARD.test(text))) {
      // An artist listed in two sections repeats their award line — keep it once.
      if (!builder.current.awards.includes(text.toLocaleUpperCase())) builder.current.awards.push(text.toLocaleUpperCase())
      continue
    }
    const capitals = text === text.toLocaleUpperCase() && /\p{Lu}/u.test(text)
    if (line.bold || capitals) {
      builder.artist(text)
      worksSinceHeading = 0
      lastArtwork = undefined
      continue
    }
    builder.flags.push(`Line not understood, not imported: "${text}"`)
  }
}

type Field = 'number' | 'firstName' | 'surname' | 'name' | 'initials' | 'award' | 'section' | 'title' | 'medium' | 'price' | 'young'
const HEADERS: [Field, RegExp][] = [
  ['number', /^(no\.?|number|cat(alogue)?\.? ?(no\.?|number)|exhibit( no\.?| number)?|#)$/],
  ['firstName', /^(first ?names?|forenames?|given names?)$/],
  ['surname', /^(surname|last ?name|family name)$/],
  ['name', /^(artist|artist'?s? name|name|full name|exhibitor)$/],
  ['initials', /(initials|letters|society|qualifications|post.?nominals|designations?)/],
  ['award', /(award|prize|honou?r)/],
  ['section', /^(section|category|type|class|division)$/],
  ['title', /^((artwork|work) )?title( of (work|artwork))?$|^(artwork|work)$/],
  ['medium', /(medium|media|materials?|technique)/],
  ['price', /(price|£|value|cost)/],
  ['young', /young/],
]

function headerMap(row: Line): Partial<Record<Field, number>> | undefined {
  const map: Partial<Record<Field, number>> = {}
  row.raw.forEach((cell, index) => {
    const header = cell.toLocaleLowerCase().replace(/[:*]/g, '').trim()
    const field = HEADERS.find(([key, pattern]) => map[key] === undefined && pattern.test(header))?.[0]
    if (field) map[field] = index
  })
  return map.title !== undefined && (map.name !== undefined || map.surname !== undefined) ? map : undefined
}

function parseTable(rows: Line[], map: Partial<Record<Field, number>>, builder: ImportBuilder) {
  const value = (row: Line, field: Field) => (map[field] === undefined ? '' : row.raw[map[field]!] ?? '').trim()
  let artist: DraftArtist | undefined
  rows.forEach((row, index) => {
    if (!row.cells.length) return
    const fullName = value(row, 'name') || [value(row, 'firstName'), value(row, 'surname')].filter(Boolean).join(' ')
    const title = value(row, 'title')
    if (fullName) {
      const heading = splitHeading(fullName)
      const initials = [heading.initials, value(row, 'initials').toLocaleUpperCase()].filter(Boolean).join(' ')
      artist = builder.artist(fullName, { name: heading.name, initials })
      artist.warnings.push(...heading.warnings.filter((warning) => !artist!.warnings.includes(warning)))
      const award = value(row, 'award')
      if (award && !artist.awards.includes(award.toLocaleUpperCase())) artist.awards.push(award.toLocaleUpperCase())
    }
    if (!title) { if (!fullName) builder.flags.push(`Table row ${index + 2}: no artist or title — not imported`); return }
    if (!artist) { builder.flags.push(`Table row ${index + 2}: "${title}" has no artist — not imported`); return }
    const sectionText = value(row, 'section')
    let section: Section = sectionText ? sectionFromText(sectionText) ?? 'painting' : 'painting'
    if (sectionText && !sectionFromText(sectionText)) builder.flags.push(`Table row ${index + 2}: section "${sectionText}" not recognised — listed as a miniature painting`)
    if (/^(y|yes|true|x|✓|✔)$/i.test(value(row, 'young'))) section = 'young'
    const medium = value(row, 'medium')
    builder.artwork(artist, value(row, 'number') || undefined, medium ? `${title} (${medium})` : title, value(row, 'price') || undefined, section)
  })
}

export async function parseWordDocument(data: ArrayBuffer, fileName = 'Word document', syncedAt = new Date().toISOString()): Promise<WordImportResult> {
  let zip: JSZip
  try { zip = await JSZip.loadAsync(data) }
  catch { throw new Error('This is not a .docx file. If it is an older .doc, open it in Word and use File › Save As › Word Document (.docx).') }
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) throw new Error('The Word document has no readable body.')

  const builder = new ImportBuilder()
  let pending: Line[] = []
  const flush = () => { if (pending.length) parseList(pending, builder); pending = [] }
  for (const block of readBlocks(documentXml)) {
    if (block.kind === 'line') { pending.push(block.line); continue }
    const map = block.rows[0] ? headerMap(block.rows[0]) : undefined
    if (map) { flush(); parseTable(block.rows.slice(1), map, builder) }
    else pending.push(...block.rows)
  }
  flush()

  const artists: ArtistSubmission[] = []
  const artistDetails: WordImportResult['artistDetails'] = {}
  let order = 0
  for (const draft of builder.artists.values()) {
    if (!draft.artworks.length) {
      builder.flags.push(`"${draft.heading}" was read as an artist name but has no artworks — ignored`)
      continue
    }
    const sections = new Set(draft.artworks.map((artwork) => artwork.section))
    if (sections.has('young') && sections.size > 1) builder.flags.push(`${draft.name}: listed under Young Artists and another section — all their works will go under Young Artists`)
    const artistId = `word-${stableHash(draft.key)}`
    const name = splitName(draft.name)
    draft.warnings.forEach((warning) => builder.flags.push(`${draft.name}: ${warning}`))
    const artworks: ArtworkSubmission[] = draft.artworks.map((artwork, index) => ({
      id: `${artistId}-${stableHash(`${index + 1}|${normalizeIdentity(artwork.title)}`)}`,
      artistId,
      position: index + 1,
      title: artwork.title,
      medium: artwork.medium,
      price: artwork.price,
      sculpture: artwork.section === 'sculpture' ? true : undefined,
      votes: { yes: 0, maybe: 0, no: 0, valid: false, raw: '' },
      verdict: 'tie',
      warnings: artwork.warnings,
    }))
    artists.push({
      id: artistId,
      sourceRow: (order += 1),
      fullName: draft.name,
      firstName: name.firstName,
      surname: name.surname,
      youngArtist: sections.has('young') || undefined,
      artworks,
      warnings: draft.warnings.map((message) => ({ code: 'word-name-review', message })),
    })
    artistDetails[artistId] = { societyInitials: draft.initials, awardText: draft.awards.join(' | ') }
  }
  if (builder.strayNumbers) builder.flags.push(`Ignored ${builder.strayNumbers} line${builder.strayNumbers === 1 ? '' : 's'} containing only a number (probably page numbers)`)
  if (!artists.length) throw new Error('No artists or artworks could be read from this Word document. Send it to Claude to check the layout.')

  const allArtworks = artists.flatMap((artist) => artist.artworks)
  return {
    snapshot: { id: 'latest', syncedAt, sourceLabel: fileName, artists },
    artistDetails,
    flags: builder.flags,
    stats: {
      artists: artists.length,
      artworks: allArtworks.length,
      sculptures: allArtworks.filter((artwork) => artwork.sculpture).length,
      youngArtists: artists.filter((artist) => artist.youngArtist).length,
    },
  }
}
