import JSZip from 'jszip'
import { splitName } from './names'

/**
 * Reads the final exhibition lists from Word (.docx) files.
 *
 * Layouts understood:
 *  1. Claire's list tables (no header row): [Age] | FIRST NAME | SURNAME INITIALS (+ award lines) | one artwork per line
 *     "Title (medium) price". The section comes from the file name (…Sculpture…, …Young Artists…, otherwise Miniature).
 *  2. A table whose first row is a header (First name / Surname / Artist, Title, Medium, Price, Section …), one artwork per row.
 *  3. A catalogue-style list, as printed: section headings, artist lines, italic award lines, numbered artwork lines.
 *
 * Nothing is guessed: anything that cannot be read unambiguously is reported in `flags`; every automatic text
 * correction is reported in `fixes`.
 */

export type Section = 'painting' | 'sculpture' | 'young'

interface Line { cells: string[]; raw: string[]; cellLines: string[][]; bold: boolean; italic: boolean }
type Block = { kind: 'line'; line: Line } | { kind: 'table'; rows: Line[] }

export interface WordWork { title: string; medium?: string; price?: string; dimensions?: string; section: Section; source: string }
export interface WordArtist { key: string; firstName: string; surname: string; initials: string; awards: string[]; age?: number; works: WordWork[]; sources: string[] }
export interface WordParseResult { files: string[]; artists: WordArtist[]; flags: string[]; fixes: string[] }

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
  return { raw, cellLines: raw.map((cell) => cell ? [cell] : []), cells: raw.filter(Boolean), bold, italic }
}

function readTable(xml: string): Line[] {
  return (xml.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []).map((row) => {
    const cells = (row.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) ?? []).map((cell) => (cell.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []).map(readParagraph))
    const cellLines = cells.map((paragraphs) => paragraphs.flatMap((paragraph) => paragraph.segments).map((segment) => segment.replace(/\s+/g, ' ').trim()).filter(Boolean))
    const raw = cellLines.map((lines) => lines.join(' '))
    const texty = cells.flat().filter((paragraph) => paragraph.segments.join('').trim())
    return { raw, cellLines, cells: raw.filter(Boolean), bold: texty.length > 0 && texty.every((paragraph) => paragraph.bold), italic: texty.length > 0 && texty.every((paragraph) => paragraph.italic) }
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

// ---------- Text helpers ----------

/** Accent-, case- and punctuation-insensitive key, e.g. "Fátima DOÑA" → "fatima dona". */
export function looseKey(value?: string): string {
  return (value ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

const KNOWN_INITIALS = new Set([
  'RMS', 'ARMS', 'PRMS', 'VPRMS', 'HPRMS', 'PPRMS', 'PVPRMS', 'SRMS', 'HS', 'HSF', 'PHS', 'PPHS', 'SWA', 'SWAC', 'PSWA', 'VPSWA', 'PPSWA', 'HRSWA',
  'SBA', 'FSBA', 'SBAF', 'SLM', 'SWLA', 'RWS', 'ARWS', 'RI', 'RBA', 'ROI', 'AROI', 'RSMA', 'RA', 'ARA', 'NEAC', 'PS', 'PPS', 'MAA', 'MASF',
  'MPSGS', 'WFM', 'TWASI', 'MBE', 'OBE', 'CBE', 'BEM', 'FRSA', 'FRBS', 'ARBS', 'RBS', 'SGA', 'SGFA', 'SFP', 'UA', 'SAA', 'SPS', 'PSA', 'RSW',
  'RSA', 'RE', 'RWA', 'RBSA', 'MFA', 'BA', 'MA', 'DIP', 'FGE', 'CPA', 'GM', 'HONS', 'PPFGSASLM',
])

function isInitialsToken(token: string): boolean {
  const cleaned = token.replace(/[.,()]/g, '').toLocaleUpperCase()
  return KNOWN_INITIALS.has(cleaned) || /^(H|V|P|PP|A|F|HP|VP|PVP|S)(RMS|SWA|HS)$/.test(cleaned)
}

function titleCaseName(value: string): string {
  return value.toLocaleLowerCase()
    .replace(/(^|[\s'’-])(\p{L})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`)
    .replace(/\bMc(\p{L})/gu, (_match, letter: string) => `Mc${letter.toLocaleUpperCase()}`)
}

/** Brand names that must be capitalised in media (the user confirmed: brands everywhere). */
const BRANDS: [RegExp, string][] = [
  [/\bderwent\s*procolou?r\b/gi, 'Derwent Procolour'],
  [/\bderwent\s*inktense\b/gi, 'Derwent Inktense'],
  [/\bderwent\b/gi, 'Derwent'],
  [/\bpolymin\b/gi, 'Polymin'],
  [/\bpolydraw\b/gi, 'Polydraw'],
  [/\bgrafix\b/gi, 'Grafix'],
  [/\bdura-?lar\b/gi, 'Dura-Lar'],
  [/\bflexi-?hex\b/gi, 'Flexi-hex'],
  [/\byupo\b/gi, 'Yupo'],
  [/\bpolychromos\b/gi, 'Polychromos'],
  [/\bprismacolou?r\b/gi, 'Prismacolor'],
  [/\bclaybord\b/gi, 'Claybord'],
  [/\bgessobord\b/gi, 'Gessobord'],
]

/** Fixes spacing slips (joined words, "x(", "&y") and brand capitals. Every change is reported. */
function cleanText(value: string, label: string, fixes: string[], options: { brands?: boolean } = {}): string {
  let text = value.replace(/\s+/g, ' ').trim()
  const before = text
  text = text.replace(/([^\s(])\(/g, '$1 (').replace(/(\S)&/g, '$1 &').replace(/&(\S)/g, '& $1')
  // A lower-case letter running straight into a capital ("IslandColoured", "ain’tGonna"), except Mc/Mac names.
  text = text.replace(/\p{L}+/gu, (word) => (/^(Mc|Mac)\p{Lu}/u.test(word) ? word : word.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')))
  if (options.brands) for (const [pattern, brand] of BRANDS) text = text.replace(pattern, brand)
  if (text !== before) fixes.push(`${label}: "${before}" → "${text}"`)
  return text
}

const TRAILING_PRICE = /\s*(NFS\s*\(\s*£?\s?\d[\d,]*(?:\.\d{2})?\s*\)|NFS|SOLD|POA|P\.O\.A\.?|£\s?\d[\d,]*(?:\.\d{2})?)$/i
const TRAILING_NUMBER_AFTER_BRACKET = /\)\s*(\d[\d,]*(?:\.\d{2})?)$/

function cleanPrice(value?: string): string | undefined {
  const trimmed = value?.trim().replace(/^£\s*/, '').replace(/\s+/g, ' ')
  if (!trimmed) return undefined
  const nfs = trimmed.match(/^nfs(?:\s*\(\s*£?\s*([\d,.]+)\s*\))?$/i)
  if (nfs) return nfs[1] ? `NFS (${nfs[1]})` : 'NFS'
  return /^(sold|poa|p\.o\.a\.?)$/i.test(trimmed) ? trimmed.toLocaleUpperCase() : trimmed
}

/** "Title (medium) price" → parts. The medium is the last bracketed group before the price. */
function parseWorkLine(line: string): { title: string; medium?: string; price?: string; trailing?: string } {
  let rest = line.trim()
  let price: string | undefined
  const trailing = rest.match(TRAILING_PRICE)
  if (trailing) { price = trailing[1]; rest = rest.slice(0, trailing.index).trim() }
  else {
    const afterBracket = rest.match(TRAILING_NUMBER_AFTER_BRACKET)
    if (afterBracket) { price = afterBracket[1]; rest = rest.slice(0, rest.length - afterBracket[0].length + 1).trim() }
  }
  const close = rest.lastIndexOf(')')
  if (close < 0) return { title: rest, price }
  let depth = 0
  for (let index = close; index >= 0; index -= 1) {
    if (rest[index] === ')') depth += 1
    if (rest[index] === '(') depth -= 1
    if (depth === 0) {
      const after = rest.slice(close + 1).trim()
      return { title: rest.slice(0, index).trim(), medium: rest.slice(index + 1, close).trim() || undefined, price, trailing: after || undefined }
    }
  }
  return { title: rest, price }
}

function sectionFromText(text: string): Section | undefined {
  if (/sculpt/i.test(text)) return 'sculpture'
  if (/young/i.test(text)) return 'young'
  if (/paint|miniature/i.test(text)) return 'painting'
  return undefined
}

// ---------- Builder ----------

class Builder {
  artists = new Map<string, WordArtist>()
  flags: string[] = []
  fixes: string[] = []

  artist(firstName: string, surname: string, initials: string, source: string): WordArtist {
    const key = looseKey(`${firstName} ${surname}`)
    let artist = this.artists.get(key)
    if (!artist) {
      artist = { key, firstName, surname, initials, awards: [], works: [], sources: [source] }
      this.artists.set(key, artist)
    } else {
      if (!artist.sources.includes(source)) artist.sources.push(source)
      if (initials && artist.initials && initials !== artist.initials) this.flags.push(`${firstName} ${surname}: different initials in ${artist.sources.join(' and ')} ("${artist.initials}" / "${initials}") — kept "${artist.initials}"`)
      else if (initials && !artist.initials) artist.initials = initials
    }
    return artist
  }

  award(artist: WordArtist, text: string) {
    const award = text.trim().toLocaleUpperCase()
    if (award && !artist.awards.includes(award)) artist.awards.push(award)
  }

  work(artist: WordArtist, line: string, section: Section, source: string) {
    const name = `${artist.firstName} ${artist.surname}`
    const fixed = cleanText(line, name, this.fixes)
    const parts = parseWorkLine(fixed)
    const title = parts.title
    const medium = parts.medium ? cleanText(parts.medium, `${name} — medium`, this.fixes, { brands: true }) : undefined
    const label = `${name} — "${title || line}"`
    if (!title) this.flags.push(`${label}: no title found`)
    if (!medium) this.flags.push(`${label}: no medium in brackets`)
    if (!parts.price) this.flags.push(`${label}: no price`)
    if (parts.trailing) this.flags.push(`${label}: text after the medium not imported — "${parts.trailing}"`)
    artist.works.push({ title, medium, price: cleanPrice(parts.price), section, source })
  }
}

/** Claire's layout: [Age] | FIRST | SURNAME INITIALS (+award lines) | works (one per line). */
function parseRowTable(rows: Line[], builder: Builder, section: Section, source: string): boolean {
  const usable = rows.filter((row) => row.cellLines.some((lines) => lines.length))
  const looksRight = usable.filter((row) => {
    const filled = row.cellLines
    const n = filled.length
    return (n === 3 || n === 4) && filled[n - 1].some((line) => /\(.+\)/.test(line))
  })
  if (!looksRight.length || looksRight.length < usable.length * 0.6) return false
  for (const row of usable) {
    const cells = row.cellLines
    if (cells.every((lines) => !lines.length || /^age$/i.test(lines.join(' ')))) continue
    let offset = 0
    let age: number | undefined
    if (cells.length === 4) {
      const ageText = cells[0].join(' ')
      if (/^\d{1,2}$/.test(ageText)) age = Number(ageText)
      else if (ageText) builder.flags.push(`${source}: age "${ageText}" not understood`)
      offset = 1
    }
    const first = cells[offset].join(' ').trim()
    const surnameLines = cells[offset + 1]
    const workLines = cells[offset + 2]
    if (!surnameLines.length) { builder.flags.push(`${source}: row "${row.raw.join(' | ')}" has no surname — not imported`); continue }
    const [heading, ...awardLines] = surnameLines
    const tokens = heading.split(' ')
    const surname = tokens[0]
    const initials = tokens.slice(1).join(' ')
    const unknown = tokens.slice(1).filter((token) => !isInitialsToken(token))
    const name = `${titleCaseName(first)} ${titleCaseName(surname)}`
    if (unknown.length) builder.flags.push(`${name}: check initials "${unknown.join(' ')}" (not a known society abbreviation)`)
    const artist = builder.artist(titleCaseName(first), titleCaseName(surname), initials, source)
    if (age !== undefined) artist.age = age
    awardLines.forEach((line) => builder.award(artist, line))
    if (!workLines.length) builder.flags.push(`${name}: no artworks in ${source}`)
    workLines.forEach((line) => builder.work(artist, line, section, source))
  }
  return true
}

type Field = 'number' | 'firstName' | 'surname' | 'name' | 'initials' | 'award' | 'section' | 'title' | 'medium' | 'price' | 'young' | 'dimensions' | 'age'
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
  ['dimensions', /(dimension|size)/],
  ['price', /(price|£|value|cost)/],
  ['young', /young/],
  ['age', /^age$/],
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

function parseHeaderTable(rows: Line[], map: Partial<Record<Field, number>>, builder: Builder, defaultSection: Section, source: string) {
  const value = (row: Line, field: Field) => (map[field] === undefined ? '' : row.raw[map[field]!] ?? '').trim()
  let artist: WordArtist | undefined
  rows.forEach((row, index) => {
    if (!row.cells.length) return
    const fullName = value(row, 'name') || [value(row, 'firstName'), value(row, 'surname')].filter(Boolean).join(' ')
    const title = value(row, 'title')
    if (fullName) {
      const tokens = fullName.split(/\s+/)
      const initials: string[] = []
      while (tokens.length > 1 && isInitialsToken(tokens.at(-1)!)) initials.unshift(tokens.pop()!)
      const split = splitName(titleCaseName(tokens.join(' ')))
      const first = value(row, 'firstName') ? titleCaseName(value(row, 'firstName')) : split.firstName
      const surname = value(row, 'surname') ? titleCaseName(value(row, 'surname').split(/\s+/).filter((token) => !isInitialsToken(token)).join(' ')) : split.surname
      artist = builder.artist(first, surname, [initials.join(' '), value(row, 'initials')].filter(Boolean).join(' '), source)
      if (/^\d{1,2}$/.test(value(row, 'age'))) artist.age = Number(value(row, 'age'))
      if (value(row, 'award')) builder.award(artist, value(row, 'award'))
    }
    if (!title) { if (!fullName) builder.flags.push(`${source} row ${index + 2}: no artist or title — not imported`); return }
    if (!artist) { builder.flags.push(`${source} row ${index + 2}: "${title}" has no artist — not imported`); return }
    const sectionText = value(row, 'section')
    let section = sectionText ? sectionFromText(sectionText) ?? defaultSection : defaultSection
    if (sectionText && !sectionFromText(sectionText)) builder.flags.push(`${source} row ${index + 2}: section "${sectionText}" not recognised — used ${defaultSection}`)
    if (/^(y|yes|true|x|✓|✔)$/i.test(value(row, 'young'))) section = 'young'
    const medium = value(row, 'medium')
    const price = value(row, 'price')
    builder.work(artist, `${title}${medium ? ` (${medium})` : ''}${price ? ` ${price}` : ''}`, section, source)
    const work = artist.works.at(-1)!
    if (value(row, 'dimensions')) work.dimensions = value(row, 'dimensions')
  })
}

const SECTION_HEADING = /^(list of exhibits\b.*|(miniature )?paintings?|sculptures?|young (artists?|miniaturists?))(\s*\(continued\))?$/i
const AWARD = /(memorial bowl|memorial exhibit|award|prize|medal|trophy|\bbowl\s+\d{4})/i

/** Printed-catalogue style list (paragraphs or untyped table rows). */
function parseList(lines: Line[], builder: Builder, startSection: Section, source: string) {
  let section = startSection
  let current: WordArtist | undefined
  let worksSinceHeading = 0
  let strayNumbers = 0
  for (const line of lines) {
    const text = line.cells.join(' ').trim()
    if (!text || text === '£') continue
    if (SECTION_HEADING.test(text)) {
      const found = sectionFromText(text)
      if (found) section = found
      else builder.flags.push(`${source}: heading not linked to a section — "${text}"`)
      current = undefined
      continue
    }
    if (/^\d{1,4}$/.test(text)) { strayNumbers += 1; continue }
    const numbered = /^\d{1,4}[.)]?$/.test(line.cells[0]) && line.cells.length >= 2 ? line.cells.slice(1).join(' ') : text.match(/^\d{1,4}[.)]?\s+(.+)$/)?.[1]
    if (numbered) {
      if (!current) { builder.flags.push(`${source}: "${text}" appears before any artist name — not imported`); continue }
      builder.work(current, numbered, section, source)
      worksSinceHeading += 1
      continue
    }
    if (current && worksSinceHeading === 0 && (line.italic || AWARD.test(text))) { builder.award(current, text); continue }
    if (line.bold || (text === text.toLocaleUpperCase() && /\p{Lu}/u.test(text))) {
      const tokens = text.split(/\s+/)
      const initials: string[] = []
      while (tokens.length > 1 && isInitialsToken(tokens.at(-1)!)) initials.unshift(tokens.pop()!)
      const split = splitName(titleCaseName(tokens.join(' ')))
      current = builder.artist(split.firstName, split.surname, initials.join(' '), source)
      if (tokens.length >= 3) builder.flags.push(`${split.firstName} ${split.surname}: name has three or more parts — check the surname (used for A–Z order)`)
      worksSinceHeading = 0
      continue
    }
    builder.flags.push(`${source}: line not understood, not imported — "${text}"`)
  }
  if (strayNumbers) builder.flags.push(`${source}: ignored ${strayNumbers} line${strayNumbers === 1 ? '' : 's'} containing only a number (probably page numbers)`)
}

async function readDocument(data: ArrayBuffer, fileName: string): Promise<Block[]> {
  let zip: JSZip
  try { zip = await JSZip.loadAsync(data) }
  catch { throw new Error(`${fileName} is not a .docx file. If it is an older .doc, open it in Word and use File › Save As › Word Document (.docx).`) }
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) throw new Error(`${fileName} has no readable body.`)
  return readBlocks(documentXml)
}

/** Reads one or more Word files into a single list of artists (an artist in several files is merged). */
export async function parseWordDocuments(files: { name: string; data: ArrayBuffer }[]): Promise<WordParseResult> {
  const builder = new Builder()
  for (const file of files) {
    const section = sectionFromText(file.name) ?? 'painting'
    const blocks = await readDocument(file.data, file.name)
    let pending: Line[] = []
    const flush = () => { if (pending.length) parseList(pending, builder, section, file.name); pending = [] }
    for (const block of blocks) {
      if (block.kind === 'line') { pending.push(block.line); continue }
      const map = block.rows[0] ? headerMap(block.rows[0]) : undefined
      if (map) { flush(); parseHeaderTable(block.rows.slice(1), map, builder, section, file.name); continue }
      if (parseRowTable(block.rows, builder, section, file.name)) { flush(); continue }
      pending.push(...block.rows)
    }
    flush()
  }
  const artists = [...builder.artists.values()].filter((artist) => {
    if (artist.works.length) return true
    builder.flags.push(`"${artist.firstName} ${artist.surname}" has no artworks — ignored`)
    return false
  })
  for (const artist of artists) {
    const sections = new Set(artist.works.map((work) => work.section))
    if (sections.has('young') && sections.size > 1) builder.flags.push(`${artist.firstName} ${artist.surname}: listed under Young Artists and another section — all their works will go under Young Artists`)
  }
  if (!artists.length) throw new Error('No artists or artworks could be read from the Word document(s).')
  return { files: files.map((file) => file.name), artists, flags: builder.flags, fixes: builder.fixes }
}

export async function parseWordDocument(data: ArrayBuffer, fileName = 'Word document'): Promise<WordParseResult> {
  return parseWordDocuments([{ name: fileName, data }])
}
