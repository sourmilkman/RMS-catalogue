import type { ArtistSubmission, SourceSnapshot } from '../types'
import { stableHash } from './identity'
import { looseKey, type WordArtist, type WordParseResult } from './wordImport'

/**
 * Lays the confirmed exhibition lists (Word) over the submissions (Google Sheet).
 *
 * - Artists are matched by name (accent/case-insensitive), then surname + first initial, then "all Word name words
 *   appear in the sheet name" (e.g. "Linda Smith" → "Dr Linda Smith PPSWA"). Several sheet rows for one person are
 *   treated as one artist.
 * - Works are matched by title, ignoring "(The) Legend of King Arthur –", a leading "The", "(artwork 3)" and
 *   punctuation; then a close match (≥ 85 % similar, or one title is the start of the other).
 * - Matched works take the Word title, medium and price (image and votes are kept). Unmatched Word works are added.
 * - The Word lists define the exhibition: every artwork not listed (other works of listed artists, duplicate
 *   submissions, submissions not in any list) is omitted from the result. The Sheet itself is untouched.
 * - The overlay is idempotent and re-applied after every Sheet refresh, so the Word data is never lost.
 */

export interface WordOverlay extends WordParseResult { id: 'word'; importedAt: string }

export interface MergeReport {
  matchedArtists: number
  newArtists: string[]
  matchedWorks: number
  addedWorks: number
  nameMatches: string[]
  closeTitles: string[]
  /** The same title submitted twice (e.g. two photos): the first copy is used, the second excluded. */
  duplicates: string[]
  /** Artworks left out because they are not in any Word list. */
  omittedWorks: number
  /** Sheet artists with no work in any Word list — omitted from the app. */
  notInLists: { artistId: string; name: string; artworkIds: string[] }[]
}

export interface MergeResult {
  snapshot: SourceSnapshot
  report: MergeReport
  /** Works in the lists → include; other works of listed artists → exclude. */
  include: string[]
  exclude: string[]
  /** Catalogue name, initials and awards for each listed artist (applied as artist overrides). */
  details: Record<string, { firstName: string; surname: string; societyInitials: string; awardText: string }>
}

export function titleKey(title?: string): string {
  return looseKey(title)
    .replace(/^(the )?legend of king arthur /, '')
    .replace(/^the /, '')
    .replace(/ artwork \d+$/, '')
    .trim()
}

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]
    previous[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length)
}

function sheetName(artist: ArtistSubmission): string {
  return artist.fullName || `${artist.firstName} ${artist.surname}`
}

function findArtists(word: WordArtist, artists: ArtistSubmission[]): { matches: ArtistSubmission[]; how: string } {
  const exact = artists.filter((artist) => looseKey(sheetName(artist)) === word.key || looseKey(`${artist.firstName} ${artist.surname}`) === word.key)
  if (exact.length) return { matches: exact, how: 'exact' }
  const surname = looseKey(word.surname)
  const initial = looseKey(word.firstName).charAt(0)
  const bySurname = artists.filter((artist) => {
    const words = looseKey(sheetName(artist)).split(' ')
    return words.at(-1) === surname && words[0]?.charAt(0) === initial
  })
  const people = new Set(bySurname.map((artist) => looseKey(sheetName(artist))))
  if (bySurname.length && people.size === 1) return { matches: bySurname, how: 'surname + first initial' }
  const wordTokens = word.key.split(' ')
  const contained = artists.filter((artist) => {
    const tokens = new Set(looseKey(sheetName(artist)).split(' '))
    return wordTokens.every((token) => tokens.has(token))
  })
  const containedPeople = new Set(contained.map((artist) => looseKey(sheetName(artist))))
  if (contained.length && containedPeople.size === 1) return { matches: contained, how: 'name contained' }
  return { matches: [], how: '' }
}

export function applyWordOverlay(base: SourceSnapshot, overlay: Pick<WordOverlay, 'artists'>): MergeResult {
  const artists: ArtistSubmission[] = base.artists.map((artist) => ({ ...artist, artworks: artist.artworks.map((artwork) => ({ ...artwork })) }))
  const report: MergeReport = { matchedArtists: 0, newArtists: [], matchedWorks: 0, addedWorks: 0, nameMatches: [], closeTitles: [], duplicates: [], notInLists: [], omittedWorks: 0 }
  const include = new Set<string>()
  const exclude = new Set<string>()
  const details: MergeResult['details'] = {}
  const touched = new Set<string>()

  for (const word of overlay.artists) {
    const displayName = `${word.firstName} ${word.surname}`
    let { matches, how } = findArtists(word, artists)
    if (!matches.length) {
      const id = `word-${stableHash(word.key)}`
      const created: ArtistSubmission = { id, sourceRow: 100000 + artists.length, fullName: displayName, firstName: word.firstName, surname: word.surname, warnings: [], artworks: [] }
      artists.push(created)
      matches = [created]
      report.newArtists.push(displayName)
    } else {
      report.matchedArtists += 1
      if (how !== 'exact') report.nameMatches.push(`${displayName} → "${sheetName(matches[0])}" (${how})`)
    }
    const primary = matches[0]
    matches.forEach((artist) => touched.add(artist.id))
    details[primary.id] = { firstName: word.firstName, surname: word.surname, societyInitials: word.initials, awardText: word.awards.join(' | ') }
    primary.youngArtist = word.works.some((work) => work.section === 'young')
    if (word.age !== undefined && primary.youngArtistAge === undefined) primary.youngArtistAge = word.age

    const pool = matches.flatMap((artist) => artist.artworks)
    const used = new Set<string>()
    for (const work of word.works) {
      const key = titleKey(work.title)
      let target = pool.find((artwork) => !used.has(artwork.id) && titleKey(artwork.title) === key)
      if (!target) {
        const scored = pool.filter((artwork) => !used.has(artwork.id)).map((artwork) => {
          const other = titleKey(artwork.title)
          const prefix = other.length >= 4 && key.length >= 4 && (key.startsWith(other) || other.startsWith(key))
          // "Morning Stretch" inside "Early Morning Stretch" — whole words only, at least 8 characters.
          const contained = Math.min(key.length, other.length) >= 8 && (` ${key} `.includes(` ${other} `) || ` ${other} `.includes(` ${key} `))
          return { artwork, score: prefix || contained ? 0.9 : similarity(key, other) }
        }).sort((a, b) => b.score - a.score)[0]
        if (scored && scored.score >= 0.85) {
          target = scored.artwork
          report.closeTitles.push(`${displayName}: "${work.title}" ← sheet "${target.title}"`)
        }
      }
      if (target) report.matchedWorks += 1
      else {
        const owner = primary
        target = {
          id: `word-${stableHash(`${owner.id}|${key}`)}`, artistId: owner.id,
          position: Math.max(0, ...owner.artworks.map((artwork) => artwork.position)) + 1,
          title: work.title, votes: { yes: 0, maybe: 0, no: 0, valid: false, raw: '' }, verdict: 'tie', warnings: [],
        }
        owner.artworks.push(target)
        report.addedWorks += 1
      }
      used.add(target.id)
      // Several submission rows for one person become one card: move the work to the primary row.
      if (target.artistId !== primary.id) {
        const from = matches.find((artist) => artist.id === target!.artistId)
        if (from) from.artworks = from.artworks.filter((artwork) => artwork.id !== target!.id)
        target.artistId = primary.id
        target.position = Math.max(0, ...primary.artworks.map((artwork) => artwork.position)) + 1
        primary.artworks.push(target)
      }
      target.title = work.title
      target.medium = work.medium
      target.price = work.price
      if (work.dimensions) target.dimensions = work.dimensions
      target.sculpture = work.section === 'sculpture' ? true : undefined
      target.warnings = target.warnings.filter((warning) => !['missing-votes', 'generic-title', 'word-no-price'].includes(warning.code))
      if (!work.price) target.warnings.push({ code: 'word-no-price', message: 'No price in the Word list' })
      include.add(target.id)
    }
    const usedKeys = new Set(pool.filter((artwork) => used.has(artwork.id)).map((artwork) => titleKey(artwork.title)))
    pool.filter((artwork) => !used.has(artwork.id)).forEach((artwork) => {
      exclude.add(artwork.id)
      if (usedKeys.has(titleKey(artwork.title))) report.duplicates.push(`${displayName}: "${artwork.title}" submitted twice — second copy excluded`)
    })
  }

  for (const artist of artists) {
    if (touched.has(artist.id) || !artist.artworks.length) continue
    report.notInLists.push({ artistId: artist.id, name: sheetName(artist), artworkIds: artist.artworks.map((artwork) => artwork.id) })
  }
  // Only the listed works are in the exhibition: everything else is left out of the app.
  const listed = new Set(include)
  const kept = artists
    .map((artist) => ({ ...artist, artworks: artist.artworks.filter((artwork) => listed.has(artwork.id)) }))
    .filter((artist) => artist.artworks.length)
  report.omittedWorks = artists.reduce((sum, artist) => sum + artist.artworks.length, 0) - kept.reduce((sum, artist) => sum + artist.artworks.length, 0)
  return { snapshot: { ...base, artists: kept }, report, include: [...include], exclude: [...exclude], details }
}

export function overlayFromParse(parsed: WordParseResult): WordOverlay {
  return { ...parsed, id: 'word', importedAt: new Date().toISOString() }
}

