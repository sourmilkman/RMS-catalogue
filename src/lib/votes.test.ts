import { describe, expect, it } from 'vitest'
import { calculateVerdict, parseVotes } from './votes'

describe('vote parsing and verdicts', () => {
  it('parses the RMS vote string', () => {
    expect(parseVotes('Yes: 5; Maybe: 2; No: 0')).toMatchObject({ yes: 5, maybe: 2, no: 0, valid: true })
  })
  it.each([
    [{ yes: 5, maybe: 2, no: 0 }, 'yes'],
    [{ yes: 1, maybe: 4, no: 2 }, 'maybe'],
    [{ yes: 1, maybe: 2, no: 4 }, 'no'],
    [{ yes: 1, maybe: 2, no: 2 }, 'tie'],
  ] as const)('calculates %o as %s', (votes, verdict) => expect(calculateVerdict(votes)).toBe(verdict))
})
