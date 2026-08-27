import { describe, expect, it } from 'vitest'
import { normaliseSheetCsv } from './normalise'

const headers = ['email', 'name', 'date of birth', 'artwork 1 (image attachment)', 'title of artwork 1', 'medium', 'votes - artwork 1', 'artwork 2 (image attachment)', 'title of artwork 2', 'medium', 'votes - artwork 2', 'artwork 3 (image attachment)', 'title of artwork 3', 'medium', 'votes - artwork 3', 'artwork 4 (image attachment)', 'title of artwork 4', 'medium', 'votes - artwork 4']
const csv = [
  headers,
  ['a@example.com', 'Alice Example', '2000-01-02', 'https://example.com/one.jpg', 'First', 'Oil', 'Yes: 5; Maybe: 2; No: 0', '', '', '', '', '', '', '', '', 'https://example.com/four.jpg', 'Fourth', 'Ink', 'Yes: 1; Maybe: 2; No: 2'],
  ['b@example.com', 'Bob Example', '', '', '', '', '', 'https://example.com/two.jpg', 'Artwork 2', '', 'bad votes', '', '', '', '', '', '', '', ''],
].map((row) => row.join(',')).join('\n')

describe('sheet normalisation', () => {
  it('discovers repeating artwork groups and tolerates missing slots', () => {
    const result = normaliseSheetCsv(csv)
    expect(result.artists).toHaveLength(2)
    expect(result.artists[0].artworks.map((artwork) => artwork.position)).toEqual([1, 4])
    expect(result.artists[0].artworks[0]).toMatchObject({ title: 'First', medium: 'Oil', verdict: 'yes' })
    expect(result.artists[0].artworks[1].verdict).toBe('tie')
  })
  it('surfaces malformed data without crashing', () => {
    const artwork = normaliseSheetCsv(csv).artists[1].artworks[0]
    expect(artwork.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['generic-title', 'malformed-votes']))
  })
})
