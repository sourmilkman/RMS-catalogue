import { describe, expect, it } from 'vitest'
import type { SourceSnapshot } from '../types'
import { defaultDecision, reconcileSource } from './reconcile'

function snapshot(id: string, title: string, imageUrl: string, votes = 'Yes: 5; Maybe: 2; No: 0'): SourceSnapshot {
  return { id: 'latest', syncedAt: '2026-08-27T10:00:00Z', artists: [{
    id: 'artist-1', sourceRow: 2, fullName: 'Alice Example', firstName: 'Alice', surname: 'Example', email: 'a@example.com', dateOfBirth: '2000-01-01', warnings: [],
    artworks: [{ id, artistId: 'artist-1', position: 1, title, imageUrl, votes: { yes: 5, maybe: 2, no: 0, valid: true, raw: votes }, verdict: 'yes', warnings: [] }],
  }] }
}

describe('source reconciliation', () => {
  it('preserves a manual decision across a title correction', () => {
    const previous = snapshot('old', 'Old title', 'https://example.com/a.jpg')
    const next = snapshot('new', 'Correct title', 'https://example.com/a.jpg')
    const manual = { ...defaultDecision('yes', 'old'), decision: 'excluded' as const, manual: true }
    const result = reconcileSource(previous, next, { old: manual })
    expect(result.decisions.new).toMatchObject({ decision: 'excluded', manual: true })
    expect(result.changes.new).toContain('title')
  })
  it('does not map an obviously different replacement onto the old decision', () => {
    const previous = snapshot('old', 'Old title', 'https://example.com/a.jpg')
    const next = snapshot('new', 'New work', 'https://example.com/b.jpg')
    const result = reconcileSource(previous, next, { old: { ...defaultDecision('yes', 'old'), decision: 'excluded', manual: true } })
    expect(result.decisions.new).toMatchObject({ decision: 'included', manual: false })
    expect(result.removedCount).toBe(1)
  })
})
