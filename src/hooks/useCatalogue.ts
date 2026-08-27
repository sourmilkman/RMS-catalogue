import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArtistOverride, ArtworkDecision, CatalogueDecision, ExportField, SourceSnapshot } from '../types'
import { db } from '../lib/db'
import { reconcileSource } from '../lib/reconcile'
import { getRmsReviewData } from '../lib/sheet'

export function useCatalogue() {
  const [source, setSource] = useState<SourceSnapshot>()
  const [decisions, setDecisions] = useState<Record<string, ArtworkDecision>>({})
  const [overrides, setOverrides] = useState<Record<string, ArtistOverride>>({})
  const [changes, setChanges] = useState<Record<string, string[]>>({})
  const [removedCount, setRemovedCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string>()
  const [online, setOnline] = useState(navigator.onLine)
  const sourceRef = useRef<SourceSnapshot | undefined>(undefined)
  const decisionsRef = useRef<Record<string, ArtworkDecision>>({})
  const syncingRef = useRef(false)

  useEffect(() => { sourceRef.current = source }, [source])
  useEffect(() => { decisionsRef.current = decisions }, [decisions])

  const refresh = useCallback(async () => {
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    try {
      const next = await getRmsReviewData()
      const result = reconcileSource(sourceRef.current, next, decisionsRef.current)
      setSource(next)
      setDecisions(result.decisions)
      setChanges(result.changes)
      setRemovedCount(result.removedCount)
      setError(undefined)
      await db.transaction('rw', db.source, db.decisions, async () => {
        await db.source.put(next)
        await db.decisions.clear()
        await db.decisions.bulkPut(Object.values(result.decisions))
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to refresh the Google Sheet.')
    } finally {
      syncingRef.current = false
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      const [cached, storedDecisions, storedOverrides] = await Promise.all([db.source.get('latest'), db.decisions.toArray(), db.artistOverrides.toArray()])
      if (!active) return
      if (cached) setSource(cached)
      const decisionMap = Object.fromEntries(storedDecisions.map((item) => [item.artworkId, item]))
      const overrideMap = Object.fromEntries(storedOverrides.map((item) => [item.artistId, item]))
      setDecisions(decisionMap)
      setOverrides(overrideMap)
      sourceRef.current = cached
      decisionsRef.current = decisionMap
      await refresh()
    })()
    const interval = window.setInterval(() => void refresh(), 60_000)
    const onFocus = () => {
      const lastSync = sourceRef.current ? Date.parse(sourceRef.current.syncedAt) : 0
      if (Date.now() - lastSync > 30_000) void refresh()
    }
    const onOnline = () => { setOnline(true); void refresh() }
    const onOffline = () => setOnline(false)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      active = false
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [refresh])

  const setDecision = useCallback((artworkId: string, decision: CatalogueDecision, manual = true) => {
    setDecisions((current) => {
      const nextItem = { ...current[artworkId], artworkId, decision, manual }
      const next = { ...current, [artworkId]: nextItem }
      decisionsRef.current = next
      void db.decisions.put(nextItem)
      return next
    })
  }, [])

  const setField = useCallback((artworkId: string, field: ExportField, included: boolean) => {
    setDecisions((current) => {
      const existing = current[artworkId]
      if (!existing) return current
      const nextItem = { ...existing, fields: { ...existing.fields, [field]: included } }
      const next = { ...current, [artworkId]: nextItem }
      decisionsRef.current = next
      void db.decisions.put(nextItem)
      return next
    })
  }, [])

  const setRNumber = useCallback((artworkId: string, rNumber: string) => {
    setDecisions((current) => {
      const existing = current[artworkId]
      if (!existing) return current
      const nextItem = { ...existing, rNumber: rNumber.replace(/\D/g, '') }
      const next = { ...current, [artworkId]: nextItem }
      decisionsRef.current = next
      void db.decisions.put(nextItem)
      return next
    })
  }, [])

  const setArtistOverride = useCallback((artistId: string, patch: Partial<ArtistOverride>) => {
    const artist = sourceRef.current?.artists.find((item) => item.id === artistId)
    if (!artist) return
    setOverrides((current) => {
      const existing = current[artistId]
      const nextItem: ArtistOverride = {
        artistId,
        firstName: patch.firstName ?? existing?.firstName ?? artist.firstName,
        surname: patch.surname ?? existing?.surname ?? artist.surname,
        youngArtist: patch.youngArtist ?? existing?.youngArtist ?? false,
      }
      void db.artistOverrides.put(nextItem)
      return { ...current, [artistId]: nextItem }
    })
  }, [])

  const resetDecisions = useCallback(async () => {
    if (!sourceRef.current) return
    const result = reconcileSource(undefined, sourceRef.current, {})
    setDecisions(result.decisions)
    setOverrides({})
    setChanges({})
    await db.transaction('rw', db.decisions, db.artistOverrides, async () => {
      await db.decisions.clear()
      await db.decisions.bulkPut(Object.values(result.decisions))
      await db.artistOverrides.clear()
    })
  }, [])

  return { source, decisions, overrides, changes, removedCount, syncing, error, online, refresh, setDecision, setField, setRNumber, setArtistOverride, resetDecisions }
}
