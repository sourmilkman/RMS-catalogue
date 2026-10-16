import type { ArtistOverride, ArtistSubmission } from '../types'
import { looseKey } from './wordImport'
import { titleKey } from './wordMerge'

/**
 * Matches a folder of image files (e.g. the secretary's WeTransfer) to artworks: artist first, then title.
 *
 * - Artist: the surname must appear in the filename (allowing small spelling slips such as Brookes/Brooks,
 *   Buttigieg/Buttgieg); the first name, a shortened first name ("pam") or the initial ("c-hart-davies") breaks ties.
 * - Title: word overlap and spelling similarity with the artwork title, ignoring "(The) Legend of King Arthur".
 *   Numbered works must agree ("Shoebill 1" never matches "Shoebill 2").
 * - Extra copies ("…-scale", "…-framed", a second photo) are kept as spares, not matched over a main image.
 * Anything uncertain is reported; nothing is matched on a guess.
 */

export interface ImageFileRef { name: string; path: string }
export interface ImageMatchResult<T extends ImageFileRef> {
  assignments: { artworkId: string; file: T; approximate: boolean; label: string }[]
  approximate: string[]
  spares: string[]
  unmatchedFiles: string[]
  ambiguousFiles: string[]
  worksWithoutImage: string[]
}

const NOISE = new Set(['jpg', 'jpeg', 'png', 'large', 'small', 'copy', 'final', 'img', 'image', 'photo', 'watercolour', 'watercolor', 'oil', 'acrylic', 'by', 'mm', 'cm', 'a', 'b', 'c', 'grid', 'plain', 'diameter'])
const SPARE = /\b(scale|framed|frame|detail|back|side|reverse|alt|alternative|in situ)\b/i

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length)
}

function fileTokens(name: string): string[] {
  const base = (name.split(/[\\/]/).pop() ?? name).replace(/\.[a-z0-9]{2,5}$/i, '')
  // Split joined words like "BirdForAllSeasons" / "DormanOGowan" before normalising.
  return looseKey(base.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')).split(' ').filter(Boolean)
}

interface Person { artist: ArtistSubmission; surname: string[]; firstNames: string[] }

/** How strongly a filename names this artist (0 = not at all). */
function artistScore(tokens: string[], person: Person): { score: number; used: Set<number> } {
  const used = new Set<number>()
  const n = person.surname.length
  let best = 0
  let at = -1
  for (let index = 0; index + n <= tokens.length; index += 1) {
    const score = person.surname.reduce((sum, part, offset) => {
      const token = tokens[index + offset]
      return sum + (part.length >= 4 && token.length >= 4 ? similarity(part, token) : part === token ? 1 : 0)
    }, 0) / n
    if (score > best) { best = score; at = index }
  }
  // A joined surname in the file ("hartdavies") also counts.
  if (n > 1) {
    const joined = person.surname.join('')
    tokens.forEach((token, index) => { const score = similarity(joined, token); if (score > best) { best = score; at = -2 - index } })
  }
  if (best < 0.8) return { score: 0, used }
  if (at >= 0) for (let offset = 0; offset < n; offset += 1) used.add(at + offset)
  else used.add(-2 - at)
  let firstBonus = 0
  tokens.forEach((token, index) => {
    if (used.has(index)) return
    for (const first of person.firstNames) {
      if (token === first || (token.length >= 3 && first.startsWith(token)) || (first.length >= 4 && token.length >= 4 && similarity(first, token) >= 0.8)) { firstBonus = Math.max(firstBonus, 0.2); used.add(index) }
      else if (token.length === 1 && token === first[0] && index < tokens.length - 1) firstBonus = Math.max(firstBonus, 0.1)
    }
  })
  return { score: best + firstBonus, used }
}

/** Work numbers: 1–2 digit numbers anywhere, Roman numerals only as the last word ("Paradise II", not "Look I'm Here"). */
const numbersIn = (tokens: string[]) => tokens.filter((token, index) => /^\d{1,2}$/.test(token) || (index === tokens.length - 1 && /^(i|ii|iii|iv|v)$/.test(token)))
const stem = (token: string) => token.replace(/(ing|s)$/, '')

/** How well the rest of the filename matches an artwork title (0–1). */
function titleScore(rest: string[], title: string): number {
  const titleTokens = titleKey(title).split(' ').filter((token) => token && !NOISE.has(token))
  const restKey = titleKey(rest.join(' ')).split(' ').filter((token) => token && !NOISE.has(token))
  if (!titleTokens.length || !restKey.length) return 0
  const titleNumbers = numbersIn(titleTokens)
  // Ignore sizes ("100x100mm", "83mm") and long ID numbers when reading a file's work number.
  const fileNumbers = numbersIn(restKey.filter((token) => !/\d+x\d+|\d(mm|cm|m)$|^\d{3,}$/.test(token)))
  // Numbered works must agree: "Shoebill 1" ≠ "shoebill 2", "Paradise I" ≠ "Paradise II".
  if (titleNumbers.length && (fileNumbers[0] !== titleNumbers[0] || !titleNumbers.every((value) => fileNumbers.includes(value)))) return 0
  const words = titleTokens.filter((token) => !/^\d+$/.test(token))
  const hits = words.filter((word) => restKey.some((token) => token === word || (word.length >= 4 && token.length >= 4 && (stem(token) === stem(word) || similarity(word, token) >= 0.8))))
  const overlap = words.length ? hits.length / words.length : 0
  const fileWords = restKey.filter((token) => !/\d/.test(token))
  const whole = similarity(words.join(' '), fileWords.join(' '))
  // A shortened title in the filename ("Wendy-Sabine-Wren" for "Wren on silver box"): every file word is in the title.
  const shortened = fileWords.length && fileWords.every((token) => words.some((word) => token === word || (word.length >= 4 && token.length >= 4 && (stem(token) === stem(word) || similarity(word, token) >= 0.8)))) ? 0.8 : 0
  return Math.max(overlap, whole, shortened)
}

export function matchImages<T extends ImageFileRef>(artists: ArtistSubmission[], overrides: Record<string, ArtistOverride>, files: T[]): ImageMatchResult<T> {
  const people: Person[] = artists.map((artist) => {
    const override = overrides[artist.id]
    return { artist, surname: looseKey(override?.surname ?? artist.surname).split(' ').filter(Boolean), firstNames: looseKey(override?.firstName ?? artist.firstName).split(' ').filter((token) => token.length > 1) }
  }).filter((person) => person.surname.length)
  const result: ImageMatchResult<T> = { assignments: [], approximate: [], spares: [], unmatchedFiles: [], ambiguousFiles: [], worksWithoutImage: [] }
  const byArtist = new Map<string, { file: T; rest: string[]; spare: boolean }[]>()

  for (const file of files) {
    const tokens = fileTokens(file.name)
    const scored = people.map((person) => ({ person, ...artistScore(tokens, person) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score)
    if (!scored.length) { result.unmatchedFiles.push(file.name); continue }
    if (scored[1] && Math.abs(scored[0].score - scored[1].score) < 0.05 && scored[0].person.artist.id !== scored[1].person.artist.id) {
      result.ambiguousFiles.push(`${file.name} — could be ${scored[0].person.artist.fullName} or ${scored[1].person.artist.fullName}`)
      continue
    }
    const { person, used } = scored[0]
    const rest = tokens.filter((_, index) => !used.has(index))
    const list = byArtist.get(person.artist.id) ?? []
    list.push({ file, rest, spare: SPARE.test(file.name) })
    byArtist.set(person.artist.id, list)
  }

  for (const person of people) {
    const candidates = byArtist.get(person.artist.id) ?? []
    const name = `${person.artist.firstName} ${person.artist.surname}`
    const pairs = person.artist.artworks.flatMap((artwork) => candidates.map((candidate) => ({ artwork, candidate, score: titleScore(candidate.rest, artwork.title) })))
      .filter((pair) => pair.score >= 0.5)
      .sort((a, b) => Number(a.candidate.spare) - Number(b.candidate.spare) || b.score - a.score)
    const doneWorks = new Set<string>()
    const doneFiles = new Set<T>()
    for (const pair of pairs) {
      if (doneWorks.has(pair.artwork.id) || doneFiles.has(pair.candidate.file)) continue
      doneWorks.add(pair.artwork.id)
      doneFiles.add(pair.candidate.file)
      const approximate = pair.score < 0.95
      const label = `${name}: "${pair.artwork.title}" ← ${pair.candidate.file.name}`
      result.assignments.push({ artworkId: pair.artwork.id, file: pair.candidate.file, approximate, label })
      if (approximate) result.approximate.push(label)
    }
    // A lone remaining work and a lone remaining main file for the same artist are paired, but flagged.
    const leftWorks = person.artist.artworks.filter((artwork) => !doneWorks.has(artwork.id))
    const leftFiles = candidates.filter((candidate) => !doneFiles.has(candidate.file) && !candidate.spare)
    if (leftWorks.length === 1 && leftFiles.length === 1) {
      const label = `${name}: "${leftWorks[0].title}" ← ${leftFiles[0].file.name} (only image left for this artist — please check)`
      result.assignments.push({ artworkId: leftWorks[0].id, file: leftFiles[0].file, approximate: true, label })
      result.approximate.push(label)
      doneWorks.add(leftWorks[0].id)
      doneFiles.add(leftFiles[0].file)
    }
    person.artist.artworks.filter((artwork) => !doneWorks.has(artwork.id)).forEach((artwork) => result.worksWithoutImage.push(`${name}: "${artwork.title}"`))
    for (const candidate of candidates.filter((item) => !doneFiles.has(item.file))) {
      // Extra photos of works already matched are spares; anything else is reported as unmatched.
      if (candidate.spare || leftWorks.length === 0 || doneWorks.size === person.artist.artworks.length) result.spares.push(`${name}: ${candidate.file.name}`)
      else result.unmatchedFiles.push(`${candidate.file.name} (${name} — no title match)`)
    }
  }
  return result
}
