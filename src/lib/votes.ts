import type { Verdict, Votes } from '../types'

const LABELS = {
  yes: /(?:^|[^a-z])(?:yes|y)\s*[:=]?\s*(\d+)/i,
  maybe: /(?:^|[^a-z])(?:maybe|m)\s*[:=]?\s*(\d+)/i,
  no: /(?:^|[^a-z])(?:no|n)\s*[:=]?\s*(\d+)/i,
}

export function parseVotes(rawValue?: string): Votes {
  const raw = (rawValue ?? '').trim()
  const values = Object.fromEntries(
    Object.entries(LABELS).map(([key, pattern]) => {
      const match = raw.match(pattern)
      return [key, match ? Number.parseInt(match[1], 10) : 0]
    }),
  ) as Pick<Votes, 'yes' | 'maybe' | 'no'>
  const valid = raw.length > 0 && Object.values(LABELS).every((pattern) => pattern.test(raw))
  return { ...values, valid, raw }
}

export function calculateVerdict(votes: Pick<Votes, 'yes' | 'maybe' | 'no'>): Verdict {
  const entries = [
    ['yes', votes.yes],
    ['maybe', votes.maybe],
    ['no', votes.no],
  ] as const
  const highest = Math.max(...entries.map(([, value]) => value))
  const winners = entries.filter(([, value]) => value === highest)
  return winners.length === 1 ? winners[0][0] : 'tie'
}
