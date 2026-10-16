import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArtistOverride, ArtistSubmission, ArtworkDecision, CatalogueDecision, ExportField, SourceSnapshot } from '../types'
import { db } from '../lib/db'
import { reconcileSource } from '../lib/reconcile'
import { getRmsReviewData } from '../lib/sheet'
import { assignLocalImage, carryLocalImages } from '../lib/imports'
import { matchImages, type ImageMatchResult } from '../lib/imageMatch'
import type { WordParseResult } from '../lib/wordImport'
import { applyWordOverlay, overlayFromParse, type MergeReport, type WordOverlay } from '../lib/wordMerge'

/** The catalogue data is saved without image files; images live in their own table (see attachImages). */
function withoutImages(snapshot: SourceSnapshot): SourceSnapshot {
  return { ...snapshot, artists: snapshot.artists.map((artist) => ({ ...artist, artworks: artist.artworks.map(({ localImage: _image, ...artwork }) => artwork) })) }
}
async function persistSource(snapshot: SourceSnapshot) {
  await db.source.put(withoutImages(snapshot))
}
function attachImages(snapshot: SourceSnapshot, images: Map<string, { name: string; blob: Blob }>): SourceSnapshot {
  return { ...snapshot, artists: snapshot.artists.map((artist) => ({ ...artist, artworks: artist.artworks.map((artwork) => {
    const image = images.get(artwork.id)
    return image ? { ...artwork, localImage: image.blob, localImageName: image.name } : artwork
  }) })) }
}

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
  const overlayRef = useRef<WordOverlay | undefined>(undefined)
  const [wordLists, setWordLists] = useState<{ files: string[]; importedAt: string }>()

  /** Re-applies the imported Word lists on top of fresh Sheet data, so they survive every refresh. */
  const withOverlay = (snapshot: SourceSnapshot) => overlayRef.current ? applyWordOverlay(snapshot, overlayRef.current).snapshot : snapshot

  useEffect(() => { sourceRef.current = source }, [source])
  useEffect(() => { decisionsRef.current = decisions }, [decisions])

  const refresh = useCallback(async (force = false) => {
    if (!force && sourceRef.current?.sourceLabel) return
    if (syncingRef.current) return
    syncingRef.current = true
    setSyncing(true)
    try {
      const fetched = await getRmsReviewData()
      for (const local of sourceRef.current?.artists.filter((artist) => artist.locallyAdded) ?? []) {
        const index = fetched.artists.findIndex((artist) => artist.id === local.id)
        if (index >= 0) fetched.artists[index] = local; else fetched.artists.push(local)
      }
      const next = carryLocalImages(sourceRef.current, withOverlay(fetched))
      const result = reconcileSource(sourceRef.current, next, decisionsRef.current)
      setSource(next)
      setDecisions(result.decisions)
      setChanges(result.changes)
      setRemovedCount(result.removedCount)
      setError(undefined)
      await db.transaction('rw', db.source, db.decisions, async () => {
        await persistSource(next)
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
      const [stored, storedDecisions, storedOverrides, storedOverlay, storedImages] = await Promise.all([db.source.get('latest'), db.decisions.toArray(), db.artistOverrides.toArray(), db.overlays.get('word'), db.images.toArray()])
      if (!active) return
      // Older versions kept images inside the catalogue data: move them to the image table once.
      const legacy = stored?.artists.flatMap((artist) => artist.artworks.filter((artwork) => artwork.localImage).map((artwork) => ({ artworkId: artwork.id, name: artwork.localImageName ?? `${artwork.id}.jpg`, blob: artwork.localImage! }))) ?? []
      if (legacy.length) { await db.images.bulkPut(legacy); if (stored) await persistSource(stored) }
      const imageMap = new Map([...legacy, ...storedImages].map((image) => [image.artworkId, image]))
      const cached = stored ? attachImages(stored, imageMap) : undefined
      overlayRef.current = storedOverlay
      if (storedOverlay) setWordLists({ files: storedOverlay.files, importedAt: storedOverlay.importedAt })
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

  /** `finalList`: the import is the confirmed exhibition list (Word import) — its prices win and every artwork without a manual decision is included. */
  const importSource = useCallback(async (incoming: SourceSnapshot, options: { finalList?: boolean } = {}) => {
    for (const local of sourceRef.current?.artists.filter((artist) => artist.locallyAdded) ?? []) {
      const index = incoming.artists.findIndex((artist) => artist.id === local.id)
      if (index >= 0) incoming.artists[index] = local; else incoming.artists.push(local)
    }
    const next = carryLocalImages(sourceRef.current, withOverlay(incoming), { keepIncomingPrices: options.finalList })
    const result = reconcileSource(sourceRef.current, next, decisionsRef.current)
    if (options.finalList) {
      for (const [artworkId, decision] of Object.entries(result.decisions)) {
        if (!decision.manual) result.decisions[artworkId] = { ...decision, decision: 'included' }
      }
    }
    setSource(next)
    sourceRef.current = next
    setDecisions(result.decisions)
    decisionsRef.current = result.decisions
    setChanges(result.changes)
    setRemovedCount(result.removedCount)
    setError(undefined)
    await db.transaction('rw', db.source, db.decisions, async () => {
      await persistSource(next)
      await db.decisions.clear()
      await db.decisions.bulkPut(Object.values(result.decisions))
    })
  }, [])

  /** Matches a folder of images to artworks (artist first, then title) and stores them on this device. */
  const importImages = useCallback(async (files: File[], overridesNow: Record<string, ArtistOverride>): Promise<ImageMatchResult<{ name: string; path: string; file: File }>> => {
    if (!sourceRef.current) throw new Error('Import catalogue data before importing images.')
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(avif|bmp|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name))
    const result = matchImages(sourceRef.current.artists, overridesNow, images.map((file) => ({ name: file.name, path: file.webkitRelativePath || file.name, file })))
    let next = sourceRef.current
    for (const assignment of result.assignments) next = assignLocalImage(next, assignment.artworkId, assignment.file.file)
    setSource(next)
    sourceRef.current = next
    await db.images.bulkPut(result.assignments.map((assignment) => ({ artworkId: assignment.artworkId, name: assignment.file.name, blob: assignment.file.file })))
    await persistSource(next)
    return result
  }, [])

  const setLocalImage = useCallback(async (artworkId: string, file: File) => {
    if (!sourceRef.current) return
    const next = assignLocalImage(sourceRef.current, artworkId, file)
    setSource(next)
    sourceRef.current = next
    await db.images.put({ artworkId, name: file.name, blob: file })
    await persistSource(next)
  }, [])

  const setArtworkPrice = useCallback(async (artworkId: string, price: string) => {
    if (!sourceRef.current) return
    const next = { ...sourceRef.current, artists: sourceRef.current.artists.map((artist) => ({ ...artist, artworks: artist.artworks.map((artwork) => artwork.id === artworkId ? { ...artwork, price: price.replace(/^£\s*/, '') } : artwork) })) }
    setSource(next)
    sourceRef.current = next
    await persistSource(next)
  }, [])

  const addLocalArtist = useCallback(async (artist: ArtistSubmission, initial: Record<string, Pick<ArtworkDecision, 'decision'>>, replaceArtistId?: string) => {
    const current = sourceRef.current ?? { id: 'latest' as const, syncedAt: new Date().toISOString(), artists: [] }
    const replaced = replaceArtistId ? current.artists.find((item) => item.id === replaceArtistId) : undefined
    const removedArtworkIds = new Set(replaced?.artworks.map((artwork) => artwork.id) ?? [])
    const next = { ...current, syncedAt: new Date().toISOString(), artists: replaceArtistId ? current.artists.map((item) => item.id === replaceArtistId ? artist : item) : [...current.artists, artist] }
    const nextDecisions = { ...decisionsRef.current }
    for (const artworkId of removedArtworkIds) delete nextDecisions[artworkId]
    for (const artwork of artist.artworks) {
      const seed = initial[artwork.id]
      nextDecisions[artwork.id] = {
        artworkId: artwork.id,
        decision: seed?.decision ?? 'undecided',
        manual: true,
        fields: { firstName: true, surname: true, title: true, email: true, dob: true, download: true },
      }
    }
    setSource(next)
    sourceRef.current = next
    setDecisions(nextDecisions)
    decisionsRef.current = nextDecisions
    await db.transaction('rw', db.source, db.decisions, async () => {
      await persistSource(next)
      if (removedArtworkIds.size) await db.decisions.bulkDelete([...removedArtworkIds])
      await db.decisions.bulkPut(artist.artworks.map((artwork) => nextDecisions[artwork.id]))
    })
  }, [])

  const setSculpture = useCallback((artworkId: string, sculpture: boolean) => {
    setDecisions((current) => {
      const existing = current[artworkId]
      if (!existing) return current
      const nextItem = { ...existing, sculpture }
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

  const setArtistOverride = useCallback((artistId: string, patch: Partial<ArtistOverride>) => {
    const artist = sourceRef.current?.artists.find((item) => item.id === artistId)
    if (!artist) return
    setOverrides((current) => {
      const existing = current[artistId]
      const nextItem: ArtistOverride = {
        artistId,
        firstName: patch.firstName ?? existing?.firstName ?? artist.firstName,
        surname: patch.surname ?? existing?.surname ?? artist.surname,
        youngArtist: patch.youngArtist ?? existing?.youngArtist ?? artist.youngArtist ?? false,
        youngArtistSet: patch.youngArtist !== undefined || existing?.youngArtistSet,
        societyInitials: patch.societyInitials ?? existing?.societyInitials ?? '',
        awardText: patch.awardText ?? existing?.awardText ?? '',
      }
      void db.artistOverrides.put(nextItem)
      return { ...current, [artistId]: nextItem }
    })
  }, [])

  /** Merges the confirmed Word lists into the cards: listed works included (Word title/medium/price), other works of listed artists excluded. */
  const importWordLists = useCallback(async (parsed: WordParseResult): Promise<MergeReport> => {
    const overlay = overlayFromParse(parsed)
    const base = sourceRef.current ?? { id: 'latest' as const, syncedAt: new Date().toISOString(), artists: [] }
    const merged = applyWordOverlay(base, overlay)
    const next = carryLocalImages(base, merged.snapshot, { keepIncomingPrices: true })
    const result = reconcileSource(base, next, decisionsRef.current)
    for (const id of merged.include) if (result.decisions[id]) result.decisions[id] = { ...result.decisions[id], decision: 'included', manual: false }
    for (const id of merged.exclude) if (result.decisions[id]) result.decisions[id] = { ...result.decisions[id], decision: 'excluded', manual: false }
    overlayRef.current = overlay
    setWordLists({ files: overlay.files, importedAt: overlay.importedAt })
    setSource(next)
    sourceRef.current = next
    setDecisions(result.decisions)
    decisionsRef.current = result.decisions
    setChanges(result.changes)
    await db.transaction('rw', db.source, db.decisions, db.overlays, async () => {
      await db.overlays.put(overlay)
      await persistSource(next)
      await db.decisions.clear()
      await db.decisions.bulkPut(Object.values(result.decisions))
    })
    for (const [artistId, details] of Object.entries(merged.details)) setArtistOverride(artistId, details)
    return merged.report
  }, [setArtistOverride])

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

  return { source, decisions, overrides, changes, removedCount, syncing, error, online, refresh, importSource, importImages, setLocalImage, setArtworkPrice, addLocalArtist, setDecision, setField, setSculpture, setArtistOverride, resetDecisions, importWordLists, wordLists }
}
