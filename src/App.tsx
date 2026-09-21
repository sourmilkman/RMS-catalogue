import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, CircleHelp, ClipboardCopy, Download, ExternalLink,
  Camera, FileSpreadsheet, FileUp, FolderOpen, ImageOff, KeyRound, Link2, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Trash2, X,
} from 'lucide-react'
import './App.css'
import { useCatalogue } from './hooks/useCatalogue'
import { EXPORT_FIELDS } from './lib/reconcile'
import { capitaliseName } from './lib/names'
import { exportBackupSheet, GOOGLE_CLIENT_ID, hasGoogleClientId, saveGoogleClientId, validateRNumbers } from './lib/googleSheets'
import { fetchGoogleSheet, importDifference, parseSpreadsheetFile } from './lib/imports'
import { blankEntry, findDuplicateArtist, preserveArtworkImages, runOfflineOcr, runOnlineOcr, type OcrEntryDraft, type OcrProvider } from './lib/formOcr'
import type { ArtistSubmission, ArtworkSubmission, CatalogueDecision, ExportField, MembershipType, Verdict } from './types'

const BUILD = `${__APP_VERSION__} · ${__BUILD_REF__}`
const FIELD_LABELS: Record<ExportField, string> = {
  firstName: 'First Name', surname: 'Surname', title: 'Title', email: 'Email', dob: 'DOB / Young Artist', download: 'Download Image',
}
const FILTERS = [
  ['rms-member', 'RMS Members'], ['associate-member', 'Associate Members'], ['non-member', 'Non-members'],
  ['included', 'Included'], ['excluded', 'Excluded'], ['undecided', 'Undecided'],
  ['yes', 'Yes verdict'], ['maybe', 'Maybe verdict'], ['no', 'No verdict'], ['tie', 'Tie'],
  ['young', 'Young Artist'], ['missing-image', 'Missing image'], ['missing-r', 'Missing R number'],
  ['missing-email', 'Missing email'], ['missing-votes', 'Missing votes'],
] as const
const MEMBERSHIP_LABELS: Record<MembershipType, string> = { 'rms-member': 'RMS Member', 'associate-member': 'Associate Member', 'non-member': 'Non-member' }

function formatSync(value?: string): string {
  if (!value) return 'Not yet synced'
  return `Last synced ${new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`
}

function verdictLabel(verdict: Verdict): string {
  return verdict === 'tie' ? 'TIE · NEEDS DECISION' : verdict.toUpperCase()
}

function useArtworkImage(artwork?: ArtworkSubmission): string | undefined {
  const source = useMemo(() => artwork?.localImage ? URL.createObjectURL(artwork.localImage) : artwork?.imageUrl, [artwork])
  useEffect(() => () => { if (artwork?.localImage && source) URL.revokeObjectURL(source) }, [artwork?.localImage, source])
  return source
}

function ImagePreview({ artwork, onOpen }: { artwork: ArtworkSubmission; onOpen: () => void }) {
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)
  const source = useArtworkImage(artwork)
  if (!source || broken) {
    return <div className="image-state"><ImageOff /><span>{broken ? 'Image could not be loaded' : 'No image supplied'}</span></div>
  }
  return (
    <button className={`artwork-image ${loaded ? 'loaded' : ''}`} onClick={onOpen} aria-label={`Enlarge ${artwork.title || 'artwork'}`}>
      {!loaded && <span className="image-skeleton" />}
      <img key={source} src={source} alt={artwork.title || 'Submitted artwork'} loading="lazy" onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />
      <span className="enlarge">Enlarge</span>
    </button>
  )
}

function LightboxImage({ artwork }: { artwork: ArtworkSubmission }) {
  const source = useArtworkImage(artwork)
  return <img src={source} alt={artwork.title || 'Submitted artwork'} />
}

function matchesArtworkFilters(
  artist: ArtistSubmission,
  artwork: ArtworkSubmission,
  decision: CatalogueDecision | undefined,
  youngArtist: boolean,
  rNumber: string,
  filters: Set<string>,
): boolean {
  const membershipFilters = ['rms-member', 'associate-member', 'non-member'].filter((filter) => filters.has(filter))
  if (membershipFilters.length && !membershipFilters.includes(artist.membershipType ?? 'non-member')) return false
  const decisionFilters = ['included', 'excluded', 'undecided'].filter((filter) => filters.has(filter))
  if (decisionFilters.length && !decisionFilters.includes(decision ?? 'undecided')) return false
  const verdictFilters = ['yes', 'maybe', 'no', 'tie'].filter((filter) => filters.has(filter))
  if (verdictFilters.length && !verdictFilters.includes(artwork.verdict)) return false
  if (filters.has('young') && !youngArtist) return false
  if (filters.has('missing-image') && (artwork.imageUrl || artwork.localImage)) return false
  if (filters.has('missing-r') && (decision !== 'included' || /\d/.test(rNumber))) return false
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
  const [backupUrl, setBackupUrl] = useState<string>()
  const [googleSetupMessage, setGoogleSetupMessage] = useState(() => hasGoogleClientId() ? 'Client ID saved on this device.' : '')
  const [uploadDriveImages, setUploadDriveImages] = useState(() => localStorage.getItem('rms-upload-drive-images') === 'true')
  const [importNotice, setImportNotice] = useState<string>()
  const initialExpansion = useRef(false)
  const spreadsheetInput = useRef<HTMLInputElement>(null)
  const imagesInput = useRef<HTMLInputElement>(null)
  const entryFormInput = useRef<HTMLInputElement>(null)
  const [ocrOpen, setOcrOpen] = useState(false)
  const [ocrProvider, setOcrProvider] = useState<OcrProvider>('offline')
  const [entryType, setEntryType] = useState<MembershipType>('rms-member')
  const [ocrDraft, setOcrDraft] = useState<OcrEntryDraft>()
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrFileName, setOcrFileName] = useState('')
  const artists = useMemo(() => catalogue.source?.artists ?? [], [catalogue.source])

  useEffect(() => {
    if (!initialExpansion.current && artists.length) {
      setExpanded(new Set(artists.map((artist) => artist.id)))
      initialExpansion.current = true
    }
  }, [artists])

  useEffect(() => { imagesInput.current?.setAttribute('webkitdirectory', '') }, [])

  const visibleArtists = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    return artists.flatMap((artist) => {
      const override = catalogue.overrides[artist.id]
      const artistMatches = [artist.fullName, artist.email, override?.firstName, override?.surname].some((value) => value?.toLocaleLowerCase().includes(needle))
      const isYoungArtist = artist.youngArtistAge !== undefined || (override?.youngArtist ?? false)
      const artworks = artist.artworks.filter((artwork) => {
        const state = catalogue.decisions[artwork.id]
        const rDigits = state?.rNumber?.replace(/\D/g, '') ?? ''
        const searchMatches = !needle || artistMatches || artwork.title.toLocaleLowerCase().includes(needle) || artwork.medium?.toLocaleLowerCase().includes(needle) || rDigits.includes(needle.replace(/^r/, ''))
        return searchMatches && matchesArtworkFilters(artist, artwork, state?.decision, isYoungArtist, rDigits, filters)
      })
      if (artworks.length) return [{ artist, artworks }]
      if (artist.artworks.length) return []
      const artworkOnlyFilters = ['included', 'excluded', 'undecided', 'yes', 'maybe', 'no', 'tie', 'missing-image', 'missing-r', 'missing-votes']
      const memberFilters = ['rms-member', 'associate-member', 'non-member'].filter((filter) => filters.has(filter))
      const sourceFiltersMatch = (!filters.has('young') || isYoungArtist) && (!filters.has('missing-email') || !artist.email) && (!memberFilters.length || memberFilters.includes(artist.membershipType ?? 'non-member'))
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
  const rNumbersRemaining = allArtworks.filter((artwork) => catalogue.decisions[artwork.id]?.decision === 'included' && !/\d/.test(catalogue.decisions[artwork.id]?.rNumber ?? '')).length

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

  const exportSelection = async () => {
    if (!counts.included) { window.alert('Include at least one artwork before exporting.'); return }
    setExporting(true)
    try {
      const { downloadCatalogueDocx, getExportRows } = await import('./lib/exportDocx')
      const rows = getExportRows(artists, catalogue.decisions, catalogue.overrides)
      const rNumberError = validateRNumbers(rows)
      if (rNumberError) { window.alert(rNumberError); return }
      const [, sheetResult] = await Promise.all([
        downloadCatalogueDocx(artists, catalogue.decisions, catalogue.overrides),
        exportBackupSheet(rows, uploadDriveImages),
      ])
      const { downloadOfflineBackup } = await import('./lib/exportOfflineZip')
      await downloadOfflineBackup(sheetResult.rows)
      setBackupUrl(sheetResult.spreadsheetUrl)
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : 'Export failed.')
    }
    finally { setExporting(false) }
  }

  const copyGoogleClientId = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_CLIENT_ID)
      setGoogleSetupMessage('Client ID copied.')
    } catch {
      setGoogleSetupMessage('Copy failed. Use “Paste / save Client ID” instead.')
    }
  }

  const useGoogleClientId = () => {
    saveGoogleClientId()
    setGoogleSetupMessage('Client ID saved on this device. You are ready to export.')
  }

  const confirmAndImport = async (next: NonNullable<typeof catalogue.source>) => {
    const warning = importDifference(catalogue.source, next)
    if (warning && !window.confirm(`${warning}\n\nMerge this import?`)) return
    await catalogue.importSource(next)
    setImportNotice(`Imported ${next.artists.length} artists and ${next.artists.reduce((sum, artist) => sum + artist.artworks.length, 0)} artworks. Existing decisions and R numbers were preserved where matched.`)
  }

  const importSpreadsheet = async (file?: File) => {
    if (!file) return
    try { await confirmAndImport(await parseSpreadsheetFile(file)) }
    catch (caught) { window.alert(caught instanceof Error ? caught.message : 'Spreadsheet import failed.') }
    finally { if (spreadsheetInput.current) spreadsheetInput.current.value = '' }
  }

  const importSheetLink = async () => {
    const link = window.prompt('Paste a public or link-accessible Google Sheets URL:')
    if (!link) return
    try { await confirmAndImport(await fetchGoogleSheet(link)) }
    catch (caught) { window.alert(caught instanceof Error ? caught.message : 'Google Sheets import failed.') }
  }

  const importImageFolder = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      const result = await catalogue.importImages([...files])
      const unmatched = result.unmatched.length ? ` ${result.unmatched.length} unmatched: ${result.unmatched.slice(0, 5).join(', ')}${result.unmatched.length > 5 ? '…' : ''}` : ''
      setImportNotice(`Matched and stored ${result.matched} local image${result.matched === 1 ? '' : 's'} for offline use.${unmatched}`)
    } catch (caught) { window.alert(caught instanceof Error ? caught.message : 'Image import failed.') }
    finally { if (imagesInput.current) imagesInput.current.value = '' }
  }

  const scanEntryForm = async (file?: File) => {
    if (!file) return
    setOcrBusy(true); setOcrProgress(0); setOcrFileName(file.name)
    try {
      if (ocrProvider === 'offline') setOcrDraft(await runOfflineOcr(file, entryType, setOcrProgress))
      else {
        const saved = localStorage.getItem('rms-gemini-api-key') ?? ''
        const apiKey = window.prompt('Enter your Google Gemini API key. It is stored only on this device and the form will be sent to Google for OCR.', saved)?.trim()
        if (!apiKey) return
        localStorage.setItem('rms-gemini-api-key', apiKey)
        setOcrDraft(await runOnlineOcr(file, entryType, apiKey))
      }
    } catch (caught) { window.alert(caught instanceof Error ? caught.message : 'The entry form could not be read.') }
    finally { setOcrBusy(false); if (entryFormInput.current) entryFormInput.current.value = '' }
  }

  const saveOcrDraft = async () => {
    if (!ocrDraft?.fullName.trim()) { window.alert('Enter the artist name before creating cards.'); return }
    const works = ocrDraft.artworks.filter((artwork) => artwork.title.trim() || artwork.rNumber.trim())
    if (!works.length) { window.alert('Add at least one artwork title or R number.'); return }
    const duplicate = findDuplicateArtist(artists, ocrDraft)
    if (duplicate && !window.confirm(`${duplicate.fullName || 'This artist'} has already been entered.\n\nSelect OK to overwrite the existing artist card and artworks, or Cancel to keep the existing entry.`)) return
    const artistId = duplicate?.id ?? `local-${crypto.randomUUID()}`
    const nameParts = capitaliseName(ocrDraft.fullName).split(/\s+/)
    const artist = preserveArtworkImages(duplicate, {
      id: artistId, sourceRow: Date.now(), fullName: capitaliseName(ocrDraft.fullName),
      firstName: nameParts.slice(0, -1).join(' ') || nameParts[0], surname: nameParts.length > 1 ? nameParts.at(-1)! : '',
      email: ocrDraft.email, address: ocrDraft.address, phone: ocrDraft.phone, membershipType: ocrDraft.membershipType, locallyAdded: true, warnings: [],
      artworks: works.map((work, index) => ({
        id: `${artistId}-${index + 1}`, artistId, position: index + 1, title: work.title, medium: work.medium,
        dimensions: work.dimensions, price: work.price, votes: { yes: 0, maybe: 0, no: 0, valid: false, raw: '' },
        verdict: 'tie', warnings: [],
      })),
    } satisfies ArtistSubmission)
    await catalogue.addLocalArtist(artist, Object.fromEntries(artist.artworks.map((artwork, index) => [artwork.id, { decision: works[index].decision, rNumber: works[index].rNumber }])), duplicate?.id)
    setExpanded((current) => new Set(current).add(artistId))
    setImportNotice(`${duplicate ? 'Overwrote the existing entry for' : 'Added'} ${artist.fullName} with ${artist.artworks.length} artwork card${artist.artworks.length === 1 ? '' : 's'} from ${ocrFileName || 'the entry form'}.`)
    setOcrDraft(undefined); setOcrOpen(false)
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
          <button className="button secondary" onClick={() => void catalogue.refresh(true)} disabled={catalogue.syncing}>
            <RefreshCw size={17} className={catalogue.syncing ? 'spin' : ''} />{catalogue.syncing ? 'Synchronising…' : 'Refresh from Google Sheet'}
          </button>
          <button className="button primary" onClick={() => void exportSelection()} disabled={exporting || !counts.included}>
            <Download size={17} />{exporting ? 'Exporting…' : 'Export Word + Sheet + ZIP'}
          </button>
        </div>
      </header>

      {!catalogue.online && <div className="offline-banner"><AlertTriangle size={17} />Offline — showing data {formatSync(catalogue.source?.syncedAt).toLocaleLowerCase()}</div>}
      {catalogue.error && <div className="error-banner"><AlertTriangle size={17} /><span>{catalogue.error} Cached data remains available.</span></div>}
      {catalogue.removedCount > 0 && <div className="change-banner"><CircleHelp size={17} />{catalogue.removedCount} previously seen artwork{catalogue.removedCount === 1 ? '' : 's'} no longer appear in the Sheet.</div>}
      {backupUrl && <div className="change-banner"><FileSpreadsheet size={17} />Google Sheet backup updated. <a href={backupUrl} target="_blank" rel="noreferrer">Open spreadsheet</a></div>}
      {importNotice && <div className="change-banner import-banner"><Check size={17} /><span>{importNotice}</span><button onClick={() => setImportNotice(undefined)} aria-label="Dismiss import message"><X size={15} /></button></div>}

      <section className="summary" aria-label="Catalogue summary">
        <div><span>Artists</span><strong>{artists.length}</strong></div>
        <div><span>Artworks</span><strong>{allArtworks.length}</strong></div>
        <div className="included"><span>Included</span><strong>{counts.included}</strong></div>
        <div className="excluded"><span>Excluded</span><strong>{counts.excluded}</strong></div>
        <div className="undecided"><span>Undecided</span><strong>{counts.undecided}</strong></div>
        <div className={rNumbersRemaining ? 'r-remaining' : 'included'}><span>R numbers remaining</span><strong>{rNumbersRemaining}</strong></div>
        <p className={`sync-state ${catalogue.error ? 'sync-error' : ''}`}><span className="sync-dot" />{catalogue.syncing ? 'Synchronising with Google Sheet…' : formatSync(catalogue.source?.syncedAt)}</p>
      </section>

      <section className="workspace">
        <aside className="filters-panel">
          <div className="import-panel">
            <div className="filter-title"><FileUp size={15} /><h2>Import offline data</h2></div>
            <p>Merge another catalogue while preserving decisions and R numbers.</p>
            <button onClick={() => spreadsheetInput.current?.click()}><FileUp size={14} />Import spreadsheet file</button>
            <input ref={spreadsheetInput} className="visually-hidden" type="file" accept=".csv,.tsv,.txt,.html,.htm,.xls,.xlsx,.xlsm,.xlsb,.ods,.fods" onChange={(event) => void importSpreadsheet(event.target.files?.[0])} />
            <button onClick={() => void importSheetLink()}><Link2 size={14} />Import Google Sheets link</button>
            <button onClick={() => imagesInput.current?.click()}><FolderOpen size={14} />Import the images</button>
            <input ref={imagesInput} className="visually-hidden" type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple onChange={(event) => void importImageFolder(event.target.files)} />
            <small>Images are matched by spreadsheet filename, then artwork title, and stored on this device for offline use.</small>
            <button className="scan-form-button" onClick={() => { setOcrDraft(blankEntry(entryType)); setOcrOpen(true) }}><Camera size={14} />Scan / add entry form</button>
          </div>
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
          <div className="google-setup">
            <div className="google-setup-title"><KeyRound size={15} /><h2>Google Sheet setup</h2></div>
            <p>For the RMS secretary:</p>
            <ol>
              <li>On each device, select <strong>Paste / save Client ID</strong> once.</li>
              <li>Select <strong>Export Word + Sheet + ZIP</strong>.</li>
              <li>Sign in as <strong>cmhucker@gmail.com</strong> and allow access.</li>
            </ol>
            <div className="google-setup-actions">
              <button onClick={useGoogleClientId}><KeyRound size={14} />Paste / save Client ID</button>
              <button onClick={() => void copyGoogleClientId()}><ClipboardCopy size={14} />Copy Client ID</button>
            </div>
            <label className="drive-upload-toggle"><input type="checkbox" checked={uploadDriveImages} onChange={(event) => { setUploadDriveImages(event.target.checked); localStorage.setItem('rms-upload-drive-images', String(event.target.checked)) }} />Upload locally added images to Google Drive</label>
            <small>When enabled, the Google Sheet and offline Excel backup include a Drive link. The ZIP always includes local images and working relative links.</small>
            {googleSetupMessage && <p className="google-setup-status" role="status"><Check size={13} />{googleSetupMessage}</p>}
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
              const isYoungArtist = artist.youngArtistAge !== undefined || (override?.youngArtist ?? false)
              const isExpanded = expanded.has(artist.id)
              const includedCount = artist.artworks.filter((artwork) => catalogue.decisions[artwork.id]?.decision === 'included').length
              const warningCount = artist.warnings.length + artist.artworks.reduce((sum, artwork) => sum + artwork.warnings.length, 0)
              return (
                <article className="artist-card" key={artist.id}>
                  <div className="artist-heading">
                    <button className="collapse-button" onClick={() => toggleArtist(artist.id)} aria-expanded={isExpanded}>{isExpanded ? <ChevronDown /> : <ChevronRight />}</button>
                    <div className="artist-identity">
                      <div className="name-editors">
                        <label><span>First Name</span><input value={override?.firstName ?? artist.firstName} onChange={(event) => catalogue.setArtistOverride(artist.id, { firstName: event.target.value })} onBlur={(event) => catalogue.setArtistOverride(artist.id, { firstName: capitaliseName(event.target.value) })} /></label>
                        <label><span>Surname</span><input value={override?.surname ?? artist.surname} onChange={(event) => catalogue.setArtistOverride(artist.id, { surname: event.target.value })} onBlur={(event) => catalogue.setArtistOverride(artist.id, { surname: capitaliseName(event.target.value) })} /></label>
                      </div>
                      <p>{[MEMBERSHIP_LABELS[artist.membershipType ?? 'non-member'], `Original: ${artist.fullName || 'Not supplied'}`, artist.email || 'No email', artist.phone, artist.address, artist.youngArtistAge !== undefined ? `Young Artist age ${artist.youngArtistAge}` : artist.dateOfBirth ? `DOB ${artist.dateOfBirth}` : '' ].filter(Boolean).join(' · ')}</p>
                    </div>
                    <div className="artist-meta">
                      <label className={`young-toggle ${isYoungArtist ? 'active' : ''}`} title={artist.youngArtistAge !== undefined ? 'Age supplied by Google Sheet' : undefined}><input type="checkbox" checked={isYoungArtist} disabled={artist.youngArtistAge !== undefined} onChange={(event) => catalogue.setArtistOverride(artist.id, { youngArtist: event.target.checked })} />Young Artist{artist.youngArtistAge !== undefined ? ` · age ${artist.youngArtistAge}` : ''}</label>
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
                          <ImagePreview key={artwork.localImageName ?? artwork.imageUrl} artwork={artwork} onOpen={() => setLightbox(artwork)} />
                          <div className="artwork-details">
                            <div className="artwork-topline">
                              <span className={`vote verdict-${artwork.verdict}`}>{verdictLabel(artwork.verdict)} · Y {artwork.votes.yes} / N {artwork.votes.no} / M {artwork.votes.maybe}</span>
                              <span className={`decision-label ${decision}`}>{decision}</span>
                            </div>
                            <h3>{artwork.title || 'Untitled artwork'}</h3>
                            <p className="medium">{[artwork.medium || 'Medium not supplied', artwork.dimensions, artwork.price ? `£${artwork.price}` : '', `Artwork ${artwork.position}`].filter(Boolean).join(' · ')}</p>
                            <label className="r-number"><span>R number</span><span className="r-input"><b>R</b><input inputMode="numeric" pattern="[0-9]*" value={state?.rNumber?.replace(/\D/g, '') ?? ''} placeholder="225" disabled={decision !== 'included'} onChange={(event) => catalogue.setRNumber(artwork.id, event.target.value)} /></span></label>
                            {changed?.length > 0 && <p className="updated-note"><RefreshCw size={14} />Updated since last sync: {changed.join(', ')}</p>}
                            {(artist.warnings.length > 0 || artwork.warnings.length > 0) && <div className="warnings">{[...artist.warnings, ...artwork.warnings].map((warning, index) => <span key={`${warning.code}-${index}`}><AlertTriangle size={13} />{warning.message}</span>)}</div>}
                            <label className="manual-image"><FolderOpen size={13} />{artwork.localImageName ? `Local: ${artwork.localImageName}` : 'Choose image manually'}<input type="file" accept="image/*,.heic,.heif,.tif,.tiff" onChange={(event) => { const file = event.target.files?.[0]; if (file) void catalogue.setLocalImage(artwork.id, file); event.target.value = '' }} /></label>

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
        <figure onClick={(event) => event.stopPropagation()}><LightboxImage artwork={lightbox} /><figcaption>{lightbox.title || 'Untitled artwork'}</figcaption></figure>
      </div>}

      {ocrOpen && <div className="ocr-backdrop" role="dialog" aria-modal="true" aria-label="Add entry form"><section className="ocr-dialog">
        <div className="ocr-heading"><div><p className="eyebrow">Selection day</p><h2>Scan or add an entry form</h2></div><button onClick={() => { setOcrOpen(false); setOcrDraft(undefined) }} aria-label="Close"><X /></button></div>
        <div className="ocr-options">
          <label><span>Artist type</span><select value={entryType} onChange={(event) => { const type = event.target.value as MembershipType; setEntryType(type); setOcrDraft((draft) => draft ? { ...draft, membershipType: type } : blankEntry(type)) }}><option value="rms-member">RMS Member</option><option value="associate-member">Associate Member</option><option value="non-member">Non-member</option></select></label>
          <fieldset><legend>OCR provider</legend><label><input type="radio" checked={ocrProvider === 'offline'} onChange={() => setOcrProvider('offline')} />Offline · private</label><label><input type="radio" checked={ocrProvider === 'online'} onChange={() => setOcrProvider('online')} />Online · better handwriting</label></fieldset>
          <button className="button secondary" onClick={() => entryFormInput.current?.click()} disabled={ocrBusy}><Camera size={16} />{ocrBusy ? `Reading${ocrProgress ? ` ${Math.round(ocrProgress * 100)}%` : '…'}` : 'Photograph or choose form'}</button>
          <input ref={entryFormInput} className="visually-hidden" type="file" accept="image/*,application/pdf" capture="environment" onChange={(event) => void scanEntryForm(event.target.files?.[0])} />
          <small>{ocrProvider === 'offline' ? 'Works without internet. Handwriting accuracy may be limited.' : 'Sends this form’s personal details to Google Gemini. A personal API key is required.'}</small>
        </div>
        {ocrDraft && <div className="ocr-review">
          <h3>Review before creating cards</h3><p>OCR can make mistakes. Correct every field, especially prices, R numbers and A/X decisions.</p>
          <div className="contact-grid">
            <label><span>Artist name</span><input value={ocrDraft.fullName} onChange={(e) => setOcrDraft({ ...ocrDraft, fullName: e.target.value })} /></label>
            <label><span>Email</span><input value={ocrDraft.email} onChange={(e) => setOcrDraft({ ...ocrDraft, email: e.target.value })} /></label>
            <label><span>Phone</span><input value={ocrDraft.phone} onChange={(e) => setOcrDraft({ ...ocrDraft, phone: e.target.value })} /></label>
            <label className="wide"><span>Address</span><input value={ocrDraft.address} onChange={(e) => setOcrDraft({ ...ocrDraft, address: e.target.value })} /></label>
          </div>
          <div className="ocr-artworks">{ocrDraft.artworks.map((work, index) => <div className={`ocr-artwork decision-${work.decision}`} key={index}>
            <strong>Artwork {index + 1}</strong><label><span>Title</span><input value={work.title} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, title: e.target.value } : item) })} /></label>
            <label><span>Medium</span><input value={work.medium} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, medium: e.target.value } : item) })} /></label>
            <label><span>Size (mm)</span><input value={work.dimensions} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, dimensions: e.target.value } : item) })} /></label>
            <label><span>Price £</span><input value={work.price} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, price: e.target.value } : item) })} /></label>
            <label><span>R number</span><span className="r-input"><b>R</b><input inputMode="numeric" value={work.rNumber} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, rNumber: e.target.value.replace(/\D/g, '') } : item) })} /></span></label>
            <label><span>A / X</span><select value={work.decision} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, decision: e.target.value as CatalogueDecision } : item) })}><option value="undecided">Not marked</option><option value="included">A · Accepted</option><option value="excluded">X · Rejected</option></select></label>
            <button className="remove-work" onClick={() => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.filter((_, i) => i !== index) })}><Trash2 size={14} />Remove</button>
          </div>)}</div>
          <button className="add-work" onClick={() => setOcrDraft({ ...ocrDraft, artworks: [...ocrDraft.artworks, blankEntry(entryType).artworks[0]] })}><Plus size={15} />Add artwork</button>
          <div className="ocr-actions"><button className="button secondary" onClick={() => { setOcrOpen(false); setOcrDraft(undefined) }}>Cancel</button><button className="button primary" onClick={() => void saveOcrDraft()}>Create artist cards</button></div>
        </div>}
      </section></div>}
    </main>
  )
}
