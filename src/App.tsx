import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, CircleHelp, Download, ExternalLink,
  ImageOff, RefreshCw, RotateCcw, Search, SlidersHorizontal, X,
} from 'lucide-react'
import './App.css'
import { useCatalogue } from './hooks/useCatalogue'
import { EXPORT_FIELDS } from './lib/reconcile'
import type { ArtistSubmission, ArtworkSubmission, CatalogueDecision, ExportField, Verdict } from './types'

const BUILD = `${__APP_VERSION__} · ${__BUILD_REF__}`
const FIELD_LABELS: Record<ExportField, string> = {
  firstName: 'First Name', surname: 'Surname', title: 'Title', email: 'Email', dob: 'DOB / Young Artist', download: 'Download Image',
}
const FILTERS = [
  ['included', 'Included'], ['excluded', 'Excluded'], ['undecided', 'Undecided'],
  ['yes', 'Yes verdict'], ['maybe', 'Maybe verdict'], ['no', 'No verdict'], ['tie', 'Tie'],
  ['young', 'Young Artist'], ['missing-image', 'Missing image'], ['missing-dob', 'Missing DOB'],
  ['missing-email', 'Missing email'], ['missing-votes', 'Missing votes'],
] as const

function formatSync(value?: string): string {
  if (!value) return 'Not yet synced'
  return `Last synced ${new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
}

function verdictLabel(verdict: Verdict): string {
  return verdict === 'tie' ? 'TIE · NEEDS DECISION' : verdict.toUpperCase()
}

function ImagePreview({ artwork, onOpen }: { artwork: ArtworkSubmission; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  if (!artwork.imageUrl || broken) {
    return <div className="image-state"><ImageOff /><span>{broken ? 'Image could not be loaded' : 'No image supplied'}</span></div>
  }
  return (
    <button className={`artwork-image ${loaded ? 'loaded' : ''}`} onClick={onOpen} aria-label={`Enlarge ${artwork.title || 'artwork'}`}>
      {!loaded && <span className="image-skeleton" />}
      <img src={artwork.imageUrl} alt={artwork.title || 'Submitted artwork'} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />
      <span className="enlarge">Enlarge</span>
    </button>
  )
}

function matchesArtworkFilters(
  artist: ArtistSubmission,
  artwork: ArtworkSubmission,
  decision: CatalogueDecision | undefined,
  youngArtist: boolean,
  filters: Set<string>,
): boolean {
  const decisionFilters = ['included', 'excluded', 'undecided'].filter((filter) => filters.has(filter))
  if (decisionFilters.length && !decisionFilters.includes(decision ?? 'undecided')) return false
  const verdictFilters = ['yes', 'maybe', 'no', 'tie'].filter((filter) => filters.has(filter))
  if (verdictFilters.length && !verdictFilters.includes(artwork.verdict)) return false
  if (filters.has('young') && !youngArtist) return false
  if (filters.has('missing-image') && artwork.imageUrl) return false
  if (filters.has('missing-dob') && artist.dateOfBirth) return false
  if (filters.has('missing-email') && artist.email) return false
  if (filters.has('missing-votes') && artwork.votes.valid) return false
  return true
}

export default function App() {
  const catalogue = useCatalogue()
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [lightbox, setLightbox] = useState<ArtworkSubmission>()
  const [exporting, setExporting] = useState(false)
  const initialExpansion = useRef(false)
  const artists = useMemo(() => catalogue.source?.artists ?? [], [catalogue.source])

  useEffect(() => {
    if (!initialExpansion.current && artists.length) {
      setExpanded(new Set(artists.map((artist) => artist.id)))
      initialExpansion.current = true
    }
  }, [artists])

  const visibleArtists = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return artists.flatMap((artist) => {
      const override = catalogue.overrides[artist.id]
      const artistMatches = [artist.fullName, artist.email, override?.firstName, override?.surname].some((value) => value?.toLocaleLowerCase().includes(needle))
      const artworks = artist.artworks.filter((artwork) => {
        const searchMatches = !needle || artistMatches || artwork.title.toLocaleLowerCase().includes(needle) || artwork.medium?.toLocaleLowerCase().includes(needle)
        return searchMatches && matchesArtworkFilters(artist, artwork, catalogue.decisions[artwork.id]?.decision, override?.youngArtist ?? false, filters)
      })
      if (artworks.length) return [{ artist, artworks }]
      if (artist.artworks.length) return []
      const artworkOnlyFilters = ['included', 'excluded', 'undecided', 'yes', 'maybe', 'no', 'tie', 'missing-image', 'missing-votes']
      const sourceFiltersMatch = (!filters.has('young') || override?.youngArtist) && (!filters.has('missing-dob') || !artist.dateOfBirth) && (!filters.has('missing-email') || !artist.email)
      return (!needle || artistMatches) && !artworkOnlyFilters.some((filter) => filters.has(filter)) && sourceFiltersMatch ? [{ artist, artworks }] : []
    }).sort((a, b) => {
      if (a.artworks.length === 0 && b.artworks.length > 0) return 1
      if (a.artworks.length > 0 && b.artworks.length === 0) return -1
      return (catalogue.overrides[a.artist.id]?.surname ?? a.artist.surname).localeCompare(catalogue.overrides[b.artist.id]?.surname ?? b.artist.surname)
    })
  }, [artists, catalogue.decisions, catalogue.overrides, filters, search])

  const allArtworks = artists.flatMap((artist) => artist.artworks)
  const counts = allArtworks.reduce((current, artwork) => {
    const decision = catalogue.decisions[artwork.id]?.decision ?? 'undecided'
    current[decision] += 1
    return current
  }, { included: 0, excluded: 0, undecided: 0 })

  const toggleFilter = (filter: string) => setFilters((current) => {
    const next = new Set(current)
    if (next.has(filter)) next.delete(filter); else next.add(filter)
    return next
  })

  const toggleArtist = (artistId: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(artistId)) next.delete(artistId); else next.add(artistId)
    return next
  })

  const bulkVerdict = (verdict: 'yes' | 'no', decision: CatalogueDecision) => {
    const targets = visibleArtists.flatMap(({ artworks }) => artworks).filter((artwork) => artwork.verdict === verdict)
    if (!targets.length) return
    if (!window.confirm(`${decision === 'included' ? 'Include' : 'Exclude'} ${targets.length} displayed ${verdict.toUpperCase()}-majority artwork${targets.length === 1 ? '' : 's'}?`)) return
    targets.forEach((artwork) => catalogue.setDecision(artwork.id, decision))
  }

  const reset = async () => {
    if (window.prompt('This removes every manual catalogue choice and name/Young Artist correction. Type RESET to continue.') !== 'RESET') return
    await catalogue.resetDecisions()
  }

  const exportWord = async () => {
    if (!counts.included) { window.alert('Include at least one artwork before exporting.'); return }
    setExporting(true)
    try {
      const { downloadCatalogueDocx } = await import('./lib/exportDocx')
      await downloadCatalogueDocx(artists, catalogue.decisions, catalogue.overrides)
    }
    finally { setExporting(false) }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="title-block">
          <p className="eyebrow">Royal Society of Miniature Painters, Sculptors & Gravers</p>
          <h1>Catalogue Selection</h1>
          <p className="build">Build {BUILD}</p>
        </div>
        <div className="header-actions">
          <button className="button secondary" onClick={() => void catalogue.refresh()} disabled={catalogue.syncing}>
            <RefreshCw size={17} className={catalogue.syncing ? 'spin' : ''} />{catalogue.syncing ? 'Synchronising…' : 'Refresh from Google Sheet'}
          </button>
          <button className="button primary" onClick={() => void exportWord()} disabled={exporting || !counts.included}>
            <Download size={17} />{exporting ? 'Creating Word file…' : 'Export Word'}
          </button>
        </div>
      </header>

      {!catalogue.online && <div className="offline-banner"><AlertTriangle size={17} />Offline — showing data {formatSync(catalogue.source?.syncedAt).toLocaleLowerCase()}</div>}
      {catalogue.error && <div className="error-banner"><AlertTriangle size={17} /><span>{catalogue.error} Cached data remains available.</span></div>}
      {catalogue.removedCount > 0 && <div className="change-banner"><CircleHelp size={17} />{catalogue.removedCount} previously seen artwork{catalogue.removedCount === 1 ? '' : 's'} no longer appear in the Sheet.</div>}

      <section className="summary" aria-label="Catalogue summary">
        <div><span>Artists</span><strong>{artists.length}</strong></div>
        <div><span>Artworks</span><strong>{allArtworks.length}</strong></div>
        <div className="included"><span>Included</span><strong>{counts.included}</strong></div>
        <div className="excluded"><span>Excluded</span><strong>{counts.excluded}</strong></div>
        <div className="undecided"><span>Undecided</span><strong>{counts.undecided}</strong></div>
        <p className={`sync-state ${catalogue.error ? 'sync-error' : ''}`}><span className="sync-dot" />{catalogue.syncing ? 'Synchronising with Google Sheet…' : formatSync(catalogue.source?.syncedAt)}</p>
      </section>

      <section className="workspace">
        <aside className="filters-panel">
          <label className="search"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search artist or artwork" />{search && <button onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label>
          <div className="filter-title"><SlidersHorizontal size={15} /><h2>Filter catalogue</h2></div>
          <div className="filter-list">
            {FILTERS.map(([key, label]) => <button className={`filter-chip ${filters.has(key) ? 'active' : ''}`} onClick={() => toggleFilter(key)} key={key}>{filters.has(key) && <Check size={14} />}{label}</button>)}
          </div>
          {(filters.size > 0 || search) && <button className="text-button" onClick={() => { setFilters(new Set()); setSearch('') }}>Clear search & filters</button>}
          <div className="bulk-panel">
            <h2>Bulk controls</h2>
            <button onClick={() => bulkVerdict('yes', 'included')}>Include displayed Yes</button>
            <button onClick={() => bulkVerdict('no', 'excluded')}>Exclude displayed No</button>
            <button onClick={() => setExpanded(new Set(visibleArtists.map(({ artist }) => artist.id)))}>Expand displayed</button>
            <button onClick={() => setExpanded(new Set())}>Collapse all</button>
          </div>
          <button className="reset-button" onClick={() => void reset()}><RotateCcw size={15} />Reset catalogue decisions</button>
        </aside>

        <section className="catalogue" aria-live="polite">
          <div className="section-heading">
            <div><p className="eyebrow">Working selection</p><h2>{visibleArtists.length} artist{visibleArtists.length === 1 ? '' : 's'} displayed</h2></div>
            <span className="status-pill">{catalogue.syncing ? 'Synchronising' : `${visibleArtists.reduce((sum, item) => sum + item.artworks.length, 0)} artworks`}</span>
          </div>

          {!catalogue.source && !catalogue.error && <div className="empty-state"><RefreshCw className="spin" /><h3>Loading RMS submissions</h3><p>Retrieving and normalising the latest Google Sheet data.</p></div>}
          {catalogue.source && visibleArtists.length === 0 && <div className="empty-state"><Search /><h3>No matching artworks</h3><p>Clear or adjust the current search and filters.</p></div>}

          <div className="artist-list">
            {visibleArtists.map(({ artist, artworks }) => {
              const override = catalogue.overrides[artist.id]
              const isExpanded = expanded.has(artist.id)
              const includedCount = artist.artworks.filter((artwork) => catalogue.decisions[artwork.id]?.decision === 'included').length
              const warningCount = artist.warnings.length + artist.artworks.reduce((sum, artwork) => sum + artwork.warnings.length, 0)
              return (
                <article className="artist-card" key={artist.id}>
                  <div className="artist-heading">
                    <button className="collapse-button" onClick={() => toggleArtist(artist.id)} aria-expanded={isExpanded}>{isExpanded ? <ChevronDown /> : <ChevronRight />}</button>
                    <div className="artist-identity">
                      <div className="name-editors">
                        <label><span>First Name</span><input value={override?.firstName ?? artist.firstName} onChange={(event) => catalogue.setArtistOverride(artist.id, { firstName: event.target.value })} /></label>
                        <label><span>Surname</span><input value={override?.surname ?? artist.surname} onChange={(event) => catalogue.setArtistOverride(artist.id, { surname: event.target.value })} /></label>
                      </div>
                      <p>Original: {artist.fullName || 'Not supplied'} · {artist.email || 'No email'} · DOB {artist.dateOfBirth || 'not supplied'}</p>
                    </div>
                    <div className="artist-meta">
                      <label className={`young-toggle ${override?.youngArtist ? 'active' : ''}`}><input type="checkbox" checked={override?.youngArtist ?? false} onChange={(event) => catalogue.setArtistOverride(artist.id, { youngArtist: event.target.checked })} />Young Artist</label>
                      <span>{artist.artworks.length} submitted · {includedCount} included</span>
                      {warningCount > 0 && <span className="warning-count"><AlertTriangle size={14} />{warningCount} warning{warningCount === 1 ? '' : 's'}</span>}
                    </div>
                  </div>

                  {isExpanded && <div className="artworks-grid">
                    {artworks.length === 0 && <div className="partial-row"><AlertTriangle /><div><h3>No artwork data in this row</h3><p>The artist/submission is retained for review rather than silently discarded. Source row {artist.sourceRow}.</p></div></div>}
                    {artworks.map((artwork) => {
                      const state = catalogue.decisions[artwork.id]
                      const decision = state?.decision ?? 'undecided'
                      const changed = catalogue.changes[artwork.id]
                      return (
                        <section className={`artwork-card decision-${decision}`} key={artwork.id}>
                          <ImagePreview artwork={artwork} onOpen={() => setLightbox(artwork)} />
                          <div className="artwork-details">
                            <div className="artwork-topline">
                              <span className={`vote verdict-${artwork.verdict}`}>{verdictLabel(artwork.verdict)} · Y {artwork.votes.yes} / N {artwork.votes.no} / M {artwork.votes.maybe}</span>
                              <span className={`decision-label ${decision}`}>{decision}</span>
                            </div>
                            <h3>{artwork.title || 'Untitled artwork'}</h3>
                            <p className="medium">{artwork.medium || 'Medium not supplied'} · Artwork {artwork.position}</p>
                            {changed?.length > 0 && <p className="updated-note"><RefreshCw size={14} />Updated since last sync: {changed.join(', ')}</p>}
                            {(artist.warnings.length > 0 || artwork.warnings.length > 0) && <div className="warnings">{[...artist.warnings, ...artwork.warnings].map((warning, index) => <span key={`${warning.code}-${index}`}><AlertTriangle size={13} />{warning.message}</span>)}</div>}

                            <div className="decision-row" role="group" aria-label={`Catalogue decision for ${artwork.title || 'artwork'}`}>
                              {(['included', 'excluded', 'undecided'] as CatalogueDecision[]).map((value) => <button className={decision === value ? 'selected' : ''} onClick={() => catalogue.setDecision(artwork.id, value)} key={value}>{value === 'included' ? 'Include' : value === 'excluded' ? 'Exclude' : 'Undecided'}</button>)}
                            </div>
                            {!state?.manual && <p className="recommendation">Initial recommendation from the vote result — change it at any time.</p>}

                            <details className="field-controls">
                              <summary>Word fields <span>green included · red omitted</span></summary>
                              <div>{EXPORT_FIELDS.map((field) => {
                                const included = state?.fields[field] ?? true
                                return <button className={included ? 'field-included' : 'field-omitted'} onClick={() => catalogue.setField(artwork.id, field, !included)} key={field}>{included ? <Check size={13} /> : <X size={13} />}{FIELD_LABELS[field]}</button>
                              })}</div>
                            </details>
                            {artwork.imageUrl && <a className="source-link" href={artwork.imageUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />Open original image</a>}
                          </div>
                        </section>
                      )
                    })}
                  </div>}
                </article>
              )
            })}
          </div>
        </section>
      </section>

      {lightbox && <div className="lightbox" role="dialog" aria-modal="true" aria-label={lightbox.title || 'Artwork preview'} onClick={() => setLightbox(undefined)}>
        <button className="lightbox-close" onClick={() => setLightbox(undefined)} aria-label="Close preview"><X /></button>
        <figure onClick={(event) => event.stopPropagation()}><img src={lightbox.imageUrl} alt={lightbox.title || 'Submitted artwork'} /><figcaption>{lightbox.title || 'Untitled artwork'}</figcaption></figure>
      </div>}
    </main>
  )
}
