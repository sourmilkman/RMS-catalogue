import Papa from 'papaparse'
import type { ArtistSubmission, DataWarning, SourceSnapshot } from '../types'
import { isValidHttpUrl, normalizeIdentity, stableHash } from './identity'
import { splitName } from './names'
import { calculateVerdict, parseVotes } from './votes'

type ArtworkColumns = { position: number; image?: number; title?: number; medium?: number; votes?: number }

function cleanHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function findColumns(headers: string[]): { email?: number; name?: number; dob?: number; age?: number; artworks: ArtworkColumns[] } {
  const normalised = headers.map(cleanHeader)
  const groups = new Map<number, ArtworkColumns>()
  const ensure = (position: number) => {
    if (!groups.has(position)) groups.set(position, { position })
    return groups.get(position)!
  }
  normalised.forEach((header, index) => {
    const position = Number.parseInt(header.match(/artwork\s*(\d+)/)?.[1] ?? '', 10)
    if (!Number.isFinite(position)) return
    const group = ensure(position)
    if (/image|attachment/.test(header)) group.image = index
    else if (/title/.test(header)) group.title = index
    else if (/vote/.test(header)) group.votes = index
  })
  normalised.forEach((header, index) => {
    if (header !== 'medium') return
    const group = [...groups.values()].find(({ title, votes }) => title !== undefined && votes !== undefined && index > title && index < votes)
    if (group) group.medium = index
  })
  return {
    email: normalised.indexOf('email') >= 0 ? normalised.indexOf('email') : undefined,
    name: normalised.indexOf('name') >= 0 ? normalised.indexOf('name') : undefined,
    dob: normalised.indexOf('date of birth') >= 0 ? normalised.indexOf('date of birth') : undefined,
    age: normalised.findIndex((header) => /^age\b/.test(header)) >= 0 ? normalised.findIndex((header) => /^age\b/.test(header)) : undefined,
    artworks: [...groups.values()].sort((a, b) => a.position - b.position),
  }
}

function cell(row: string[], index?: number): string {
  return index === undefined ? '' : (row[index] ?? '').trim()
}

export function normaliseSheetCsv(csv: string, syncedAt = new Date().toISOString()): SourceSnapshot {
  const parsed = Papa.parse<string[]>(csv, { skipEmptyLines: 'greedy' })
  if (parsed.errors.length && !parsed.data.length) throw new Error('The Google Sheet returned malformed CSV data.')
  const [headers = [], ...rows] = parsed.data
  const columns = findColumns(headers)
  if (columns.name === undefined || columns.artworks.length === 0) throw new Error('Required name or artwork columns are missing from the Sheet.')
  const duplicateOccurrences = new Map<string, number>()
  const artists: ArtistSubmission[] = []

  rows.forEach((row, rowIndex) => {
    const fullName = cell(row, columns.name)
    const email = cell(row, columns.email)
    const dateOfBirth = cell(row, columns.dob)
    const ageValue = cell(row, columns.age)
    const parsedAge = Number.parseInt(ageValue, 10)
    const youngArtistAge = /^\d+$/.test(ageValue) && parsedAge >= 0 && parsedAge <= 120 ? parsedAge : undefined
    const hasArtworkData = columns.artworks.some((group) => [group.image, group.title, group.medium, group.votes].some((index) => cell(row, index)))
    if (!fullName && !email && !hasArtworkData) return

    const duplicateKey = `${normalizeIdentity(email)}|${normalizeIdentity(fullName)}|${normalizeIdentity(dateOfBirth)}`
    const occurrence = (duplicateOccurrences.get(duplicateKey) ?? 0) + 1
    duplicateOccurrences.set(duplicateKey, occurrence)
    const artistId = `artist-${stableHash(`${duplicateKey}|${occurrence}`)}`
    const name = splitName(fullName)
    const artistWarnings: DataWarning[] = []
    if (!email) artistWarnings.push({ code: 'missing-email', message: 'Missing email address' })
    if (ageValue && youngArtistAge === undefined) artistWarnings.push({ code: 'invalid-age', message: 'Young Artist age needs review' })
    if (name.suspicious) artistWarnings.push({ code: 'name-review', message: 'Name split needs review' })
    if (occurrence > 1) artistWarnings.push({ code: 'duplicate-row', message: 'Duplicate-looking or continuation row' })

    const artworks = columns.artworks.flatMap((group) => {
      const imageUrl = cell(row, group.image)
      const title = cell(row, group.title)
      const medium = cell(row, group.medium)
      const rawVotes = cell(row, group.votes)
      if (!imageUrl && !title && !medium && !rawVotes) return []
      const warnings: DataWarning[] = []
      if (!title) warnings.push({ code: 'missing-title', message: 'Missing artwork title' })
      if (/^artwork\s*\d*$/i.test(title)) warnings.push({ code: 'generic-title', message: 'Generic artwork title' })
      if (!imageUrl) warnings.push({ code: 'missing-image', message: 'Missing image URL' })
      else if (!isValidHttpUrl(imageUrl)) warnings.push({ code: 'invalid-image', message: 'Invalid image URL' })
      const votes = parseVotes(rawVotes)
      if (!rawVotes) warnings.push({ code: 'missing-votes', message: 'Missing vote information' })
      else if (!votes.valid) warnings.push({ code: 'malformed-votes', message: 'Vote string needs review' })
      const anchor = normalizeIdentity(imageUrl || title || medium || `slot-${group.position}`)
      const id = `art-${stableHash(`${artistId}|${group.position}|${anchor}`)}`
      return [{ id, artistId, position: group.position, imageUrl: imageUrl || undefined, title, medium: medium || undefined, votes, verdict: calculateVerdict(votes), warnings }]
    })

    artists.push({ id: artistId, sourceRow: rowIndex + 2, fullName, firstName: name.firstName, surname: name.surname, email: email || undefined, dateOfBirth: dateOfBirth || undefined, youngArtistAge, artworks, warnings: artistWarnings })
  })

  const seenArtwork = new Map<string, string>()
  artists.forEach((artist) => artist.artworks.forEach((artwork) => {
    const duplicateKey = `${normalizeIdentity(artwork.title)}|${normalizeIdentity(artwork.imageUrl)}`
    if (duplicateKey !== '|' && seenArtwork.has(duplicateKey)) artwork.warnings.push({ code: 'duplicate-artwork', message: 'Repeated title/image variant' })
    else seenArtwork.set(duplicateKey, artwork.id)
  }))
  return { id: 'latest', syncedAt, artists }
}
