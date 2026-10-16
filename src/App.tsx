import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, Eye, EyeOff, ChevronDown, ChevronRight, CircleHelp, ClipboardCopy, Download, ExternalLink,
  Camera, Ruler, FileSpreadsheet, FileText, FileUp, FolderOpen, ImageOff, KeyRound, Link2, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, Trash2, X,
} from 'lucide-react'
import './App.css'
import { useCatalogue } from './hooks/useCatalogue'
import { EXPORT_FIELDS } from './lib/reconcile'
import { artworkSize, sizeFromFilenameDetailed } from './lib/dimensions'
import { capitaliseName } from './lib/names'
import { exportBackupSheet, GOOGLE_CLIENT_ID, hasGoogleClientId, saveGoogleClientId } from './lib/googleSheets'
import { fetchGoogleSheet, importDifference, parseSpreadsheetFile } from './lib/imports'
import { CATALOGUE_GROUPS, catalogueGroupOf, isSculpture, isYoungArtist as isYoungArtistRule, sectionOf, type CatalogueGroupKey, type CatalogueSectionKey } from './lib/catalogueRules'
import { blankEntry, findDuplicateArtist, preserveArtworkImages, runOfflineOcr, runOnlineOcr, type OcrEntryDraft, type OcrProvider } from './lib/formOcr'
import type { MergeReport } from './lib/wordMerge'
import type { ArtistSubmission, ArtworkSubmission, CatalogueDecision, ExportField, MembershipType, Verdict } from './types'

const BUILD = `${__APP_VERSION__} · ${__BUILD_REF__}`
const FIELD_LABELS: Record<ExportField, string> = {
  firstName: 'First Name', surname: 'Surname', title: 'Title', email: 'Email', dob: 'DOB / Young Artist', download: 'Download Image',
}
const FILTERS = [
  ['rms-member', 'RMS Members'], ['associate-member', 'Associate Members'], ['non-member', 'Non-members'],
  ['included', 'Included'], ['excluded', 'Excluded'], ['undecided', 'Undecided'],
  ['yes', 'Yes verdict'], ['maybe', 'Maybe verdict'], ['no', 'No verdict'], ['tie', 'Tie'],
  ['young', 'Young Artist'], ['missing-image', 'Missing image'], ['missing-size', 'No size yet'],
  ['missing-email', 'Missing email'], ['missing-votes', 'Missing votes'],
] as const
const SECTION_VIEW: [CatalogueSectionKey, string][] = [['sculptures', 'Sculptures'], ['paintings', 'Miniature paintings'], ['young', 'Young Artists']]
const VIEW_KEY = 'rms-view-settings'
type ViewSettings = { hideExcluded: boolean; hiddenSections: CatalogueSectionKey[]; order: 'catalogue' | 'surname' }
function loadView(): ViewSettings {
  try { return { hideExcluded: false, hiddenSections: [], order: 'catalogue', ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') } }
  catch { return { hideExcluded: false, hiddenSections: [], order: 'catalogue' } }
}
function saveView(view: ViewSettings) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)) } catch { /* view settings are a convenience only */ }
}
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

function ReviewGroup({ title, items, note }: { title: string; items: string[]; note?: string }) {
  if (!items.length) return null
  return <details className="review-group"><summary>{title} <b>{items.length}</b></summary>{note && <p>{note}</p>}<ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul></details>
}

function WordReviewPanel({ review, onDismiss }: { review: { report: MergeReport; flags: string[]; fixes: string[] }; onDismiss: () => void }) {
  const { report, flags, fixes } = review
  return (
    <section className="word-review" aria-label="Word import review">
      <header><AlertTriangle size={17} /><h2>Word import — please review</h2><button onClick={onDismiss}>Dismiss</button></header>
      <p>{report.matchedArtists} artists matched existing cards · {report.newArtists.length} new · {report.matchedWorks} works matched · {report.addedWorks} works added</p>
      <ReviewGroup title="Name matches to confirm" items={report.nameMatches} note="Word name → submission name. If one is wrong, correct the name in the Word file and import again." />
      <ReviewGroup title="Titles matched approximately" items={report.closeTitles} note="The Word title is used in the catalogue; the submission image is kept." />
      <ReviewGroup title="Items to check" items={flags} />
      <ReviewGroup title="Duplicate submissions" items={report.duplicates} note="The same title was submitted twice. The second card is excluded; open it if you want to use its image instead." />
      <ReviewGroup title="Automatic text fixes" items={fixes} note="Spacing and brand-name capitals corrected while importing. Your Word files are not changed." />
      <ReviewGroup title="New artist cards (no image yet)" items={report.newArtists} />
      <ReviewGroup title="Not in the Word lists — left out of the app" items={report.notInLists.map((item) => `${item.name} — ${item.artworkIds.length} work${item.artworkIds.length === 1 ? '' : 's'}`)} note={`Only works in the Word lists are in the exhibition. ${report.omittedWorks} submitted works in total are left out (including other works by listed artists and duplicates). The Google Sheet itself is not changed.`} />
    </section>
  )
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
  if (filters.has('missing-size') && artworkSize(artwork)) return false
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
  const [exportingCatalogue, setExportingCatalogue] = useState(false)
  const [exportingWebsite, setExportingWebsite] = useState(false)
  const [backupUrl, setBackupUrl] = useState<string>()
  const [googleSetupMessage, setGoogleSetupMessage] = useState(() => hasGoogleClientId() ? 'Client ID saved on this device.' : '')
  const [view, setViewState] = useState<ViewSettings>(loadView)
  const setView = (next: ViewSettings) => { setViewState(next); saveView(next) }
  const [uploadDriveImages, setUploadDriveImages] = useState(() => localStorage.getItem('rms-upload-drive-images') === 'true')
  const [importNotice, setImportNotice] = useState<string>()
  const [imageReview, setImageReview] = useState<{ assignments: unknown[]; approximate: string[]; spares: string[]; unmatchedFiles: string[]; ambiguousFiles: string[]; worksWithoutImage: string[]; noUnit: string[] }>()
  const [wordReview, setWordReview] = useState<{ report: MergeReport; flags: string[]; fixes: string[] }>()
  const initialExpansion = useRef(false)
  const spreadsheetInput = useRef<HTMLInputElement>(null)
  const wordInput = useRef<HTMLInputElement>(null)
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
    const matched = artists.flatMap((artist) => {
      const override = catalogue.overrides[artist.id]
      const artistMatches = [artist.fullName, artist.email, override?.firstName, override?.surname].some((value) => value?.toLocaleLowerCase().includes(needle))
      const isYoungArtist = isYoungArtistRule(artist, override)
      const artworks = artist.artworks.filter((artwork) => {
        const state = catalogue.decisions[artwork.id]
        const searchMatches = !needle || artistMatches || artwork.title.toLocaleLowerCase().includes(needle) || artwork.medium?.toLocaleLowerCase().includes(needle)
        if (view.hideExcluded && state?.decision === 'excluded') return false
        if (view.hiddenSections.length && view.hiddenSections.includes(sectionOf(artist, artwork, override, state))) return false
        return searchMatches && matchesArtworkFilters(artist, artwork, state?.decision, isYoungArtist, filters)
      })
      if (artworks.length) return [{ artist, artworks }]
      if (artist.artworks.length || view.hideExcluded || view.hiddenSections.length) return []
      const artworkOnlyFilters = ['included', 'excluded', 'undecided', 'yes', 'maybe', 'no', 'tie', 'missing-image', 'missing-size', 'missing-votes']
      const memberFilters = ['rms-member', 'associate-member', 'non-member'].filter((filter) => filters.has(filter))
      const sourceFiltersMatch = (!filters.has('young') || isYoungArtist) && (!filters.has('missing-email') || !artist.email) && (!memberFilters.length || memberFilters.includes(artist.membershipType ?? 'non-member'))
      return (!needle || artistMatches) && !artworkOnlyFilters.some((filter) => filters.has(filter)) && sourceFiltersMatch ? [{ artist, artworks }] : []
    })
    const name = (artist: ArtistSubmission) => `${catalogue.overrides[artist.id]?.surname ?? artist.surname} ${catalogue.overrides[artist.id]?.firstName ?? artist.firstName}`
    const byName = (a: { artist: ArtistSubmission }, b: { artist: ArtistSubmission }) => name(a.artist).localeCompare(name(b.artist), 'en-GB', { sensitivity: 'base' })
    if (view.order === 'surname') {
      return matched.map((item) => ({ ...item, group: undefined as CatalogueGroupKey | undefined })).sort((a, b) => {
        if (a.artworks.length === 0 && b.artworks.length > 0) return 1
        if (a.artworks.length > 0 && b.artworks.length === 0) return -1
        return byName(a, b)
      })
    }
    // Catalogue order: one card per artist per group, groups in catalogue order, each A–Z by surname.
    const rank = (group?: CatalogueGroupKey) => group ? CATALOGUE_GROUPS.findIndex((item) => item.key === group) : CATALOGUE_GROUPS.length
    return matched.flatMap(({ artist, artworks }) => {
      if (!artworks.length) return [{ artist, artworks, group: undefined as CatalogueGroupKey | undefined }]
      const groups = new Map<CatalogueGroupKey, ArtworkSubmission[]>()
      for (const artwork of artworks) {
        const group = catalogueGroupOf(artist, artwork, catalogue.overrides[artist.id], catalogue.decisions[artwork.id])
        groups.set(group, [...(groups.get(group) ?? []), artwork])
      }
      return [...groups].map(([group, items]) => ({ artist, artworks: items, group: group as CatalogueGroupKey | undefined }))
    }).sort((a, b) => rank(a.group) - rank(b.group) || byName(a, b))
  }, [artists, catalogue.decisions, catalogue.overrides, filters, search, view])

  const allArtworks = artists.flatMap((artist) => artist.artworks)
  const sectionCounts = useMemo(() => {
    const counts: Record<CatalogueSectionKey, number> = { sculptures: 0, paintings: 0, young: 0 }
    for (const artist of artists) for (const artwork of artist.artworks) {
      const state = catalogue.decisions[artwork.id]
      if (state?.decision === 'included') counts[sectionOf(artist, artwork, catalogue.overrides[artist.id], state)] += 1
    }
    return counts
  }, [artists, catalogue.decisions, catalogue.overrides])
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

  const exportSelection = async () => {
    if (!counts.included) { window.alert('Include at least one artwork before exporting.'); return }
    setExporting(true)
    try {
      const { downloadCatalogueDocx, getExportRows } = await import('./lib/exportDocx')
      const rows = getExportRows(artists, catalogue.decisions, catalogue.overrides)
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

  const exportCatalogueLayout = async () => {
    if (!counts.included) { window.alert('Include at least one artwork before exporting.'); return }
    setExportingCatalogue(true)
    try {
      const { downloadPrintedCatalogueDocx } = await import('./lib/exportCatalogueDocx')
      await downloadPrintedCatalogueDocx(artists, catalogue.decisions, catalogue.overrides, 1)
    } catch (caught) { window.alert(caught instanceof Error ? caught.message : 'Catalogue Word export failed.') }
    finally { setExportingCatalogue(false) }
  }

  const exportWebsite = async () => {
    if (!counts.included) { window.alert('Include at least one artwork before exporting.'); return }
    setExportingWebsite(true)
    try {
      const { downloadWebsiteWorkbook, websiteRows, websiteValues, WEBSITE_HEADER } = await import('./lib/exportWebsite')
      const rows = websiteRows(artists, catalogue.decisions, catalogue.overrides)
      const missing = rows.filter((row) => !row.imageUrl && !row.localImage).length
      await downloadWebsiteWorkbook(rows)
      if (hasGoogleClientId()) {
        try {
          const { exportWebsiteGoogleSheet } = await import('./lib/googleSheets')
          setBackupUrl(await exportWebsiteGoogleSheet(WEBSITE_HEADER, rows, websiteValues, uploadDriveImages))
        } catch (caught) { window.alert(`The Excel file was saved, but the Google Sheet could not be updated: ${caught instanceof Error ? caught.message : 'unknown error'}`) }
      }
      setImportNotice(`Website sheet: ${rows.length} artworks numbered as in the catalogue.${missing ? ` ${missing} have no image yet.` : ''}${hasGoogleClientId() ? '' : ' Saved as Excel — set up Google (left panel) to also update the Google Sheet.'}`)
    } catch (caught) { window.alert(caught instanceof Error ? caught.message : 'Website sheet export failed.') }
    finally { setExportingWebsite(false) }
  }

  const useGoogleClientId = () => {
    saveGoogleClientId()
    setGoogleSetupMessage('Client ID saved on this device. You are ready to export.')
  }

  const confirmAndImport = async (next: NonNullable<typeof catalogue.source>) => {
    const warning = importDifference(catalogue.source, next)
    if (warning && !window.confirm(`${warning}\n\nMerge this import?`)) return
    await catalogue.importSource(next)
    setImportNotice(`Imported ${next.artists.length} artists and ${next.artists.reduce((sum, artist) => sum + artist.artworks.length, 0)} artworks. Existing decisions were preserved where matched.`)
  }

  const importSpreadsheet = async (file?: File) => {
    if (!file) return
    try { await confirmAndImport(await parseSpreadsheetFile(file)) }
    catch (caught) { window.alert(caught instanceof Error ? caught.message : 'Spreadsheet import failed.') }
    finally { if (spreadsheetInput.current) spreadsheetInput.current.value = '' }
  }

  const importWordDocuments = async (fileList: FileList | null) => {
    const files = [...(fileList ?? [])]
    if (!files.length) return
    try {
      const [{ parseWordDocuments }, { applyWordOverlay }] = await Promise.all([import('./lib/wordImport'), import('./lib/wordMerge')])
      const parsed = await parseWordDocuments(await Promise.all(files.map(async (file) => ({ name: file.name, data: await file.arrayBuffer() }))))
      const preview = applyWordOverlay(catalogue.source ?? { id: 'latest', syncedAt: new Date().toISOString(), artists: [] }, parsed).report
      const works = parsed.artists.reduce((sum, artist) => sum + artist.works.length, 0)
      const message = [
        `${files.length} Word file${files.length === 1 ? '' : 's'}: ${files.map((file) => file.name).join(', ')}`,
        '',
        `Found ${parsed.artists.length} artists and ${works} artworks.`,
        `• ${preview.matchedArtists} artists match existing cards (${preview.matchedWorks} works matched, ${preview.addedWorks} added)`,
        `• ${preview.newArtists.length} new artist cards`,
        `• ${preview.nameMatches.length + preview.closeTitles.length} near-matches, ${parsed.fixes.length} text fixes and ${parsed.flags.length} items to check — listed after import`,
        `• ${preview.omittedWorks} submitted works are not in these lists and will be left out of the app (${preview.notInLists.length} artists entirely)`,
        '',
        'Only the listed works will remain, marked Include with the Word title, medium and price. Images and votes are kept. Import all the lists together — anything missing from them will not appear. Continue?',
      ].join('\n')
      if (!window.confirm(message)) return
      const report = await catalogue.importWordLists(parsed)
      setWordReview({ report, flags: parsed.flags, fixes: parsed.fixes })
      setImportNotice(`Merged ${parsed.artists.length} artists and ${works} artworks from ${files.length} Word file${files.length === 1 ? '' : 's'}. Review the list below.`)
    } catch (caught) { window.alert(caught instanceof Error ? caught.message : 'Word import failed.') }
    finally { if (wordInput.current) wordInput.current.value = '' }
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
      const result = await catalogue.importImages([...files], catalogue.overrides)
      const titles = new Map(artists.flatMap((artist) => artist.artworks.map((artwork) => [artwork.id, `${artist.firstName} ${artist.surname}: "${artwork.title}"`] as const)))
      const noUnit = result.assignments.flatMap((assignment) => { const size = sizeFromFilenameDetailed(assignment.file.name); return size && !size.unitStated ? [`${titles.get(assignment.artworkId) ?? assignment.file.name} — ${size.value} (${assignment.file.name})`] : [] })
      setImageReview({ ...result, noUnit })
      setImportNotice(`Matched ${result.assignments.length} of ${files.length} image files to artworks and stored them on this device. Review the list below.`)
    } catch (caught) { window.alert(caught instanceof Error ? caught.message : 'Image import failed.') }
    finally { if (imagesInput.current) imagesInput.current.value = '' }
  }

  const scanEntryForm = async (file?: File) => {
    if (!file) return
    setOcrBusy(true); setOcrProgress(0); setOcrFileName(file.name)
    try {
      if (ocrProvider === 'offline') setOcrDraft(await runOfflineOcr(file, entryType, setOcrProgress))
      else setOcrDraft(await runOnlineOcr(file, entryType))
    } catch (caught) { window.alert(caught instanceof Error ? caught.message : 'The entry form could not be read.') }
    finally { setOcrBusy(false); if (entryFormInput.current) entryFormInput.current.value = '' }
  }

  const saveOcrDraft = async () => {
    if (!ocrDraft?.fullName.trim()) { window.alert('Enter the artist name before creating cards.'); return }
    const works = ocrDraft.artworks.filter((artwork) => artwork.title.trim())
    if (!works.length) { window.alert('Add at least one artwork title.'); return }
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
    await catalogue.addLocalArtist(artist, Object.fromEntries(artist.artworks.map((artwork, index) => [artwork.id, { decision: works[index].decision }])), duplicate?.id)
    if (ocrDraft.societyInitials) catalogue.setArtistOverride(artist.id, { societyInitials: ocrDraft.societyInitials })
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
          <button className="button secondary" onClick={() => void exportCatalogueLayout()} disabled={exportingCatalogue || !counts.included}>
            <Download size={17} />{exportingCatalogue ? 'Creating catalogue…' : 'Export Catalogue Word'}
          </button>
          <button className="button secondary" onClick={() => void exportWebsite()} disabled={exportingWebsite || !counts.included}>
            <FileSpreadsheet size={17} />{exportingWebsite ? 'Creating sheet…' : 'Export Website Sheet'}
          </button>
        </div>
      </header>

      {!catalogue.online && <div className="offline-banner"><AlertTriangle size={17} />Offline — showing data {formatSync(catalogue.source?.syncedAt).toLocaleLowerCase()}</div>}
      {catalogue.error && <div className="error-banner"><AlertTriangle size={17} /><span>{catalogue.error} Cached data remains available.</span></div>}
      {catalogue.removedCount > 0 && <div className="change-banner"><CircleHelp size={17} />{catalogue.removedCount} previously seen artwork{catalogue.removedCount === 1 ? '' : 's'} no longer appear in the Sheet.</div>}
      {backupUrl && <div className="change-banner"><FileSpreadsheet size={17} />Google Sheet backup updated. <a href={backupUrl} target="_blank" rel="noreferrer">Open spreadsheet</a></div>}
      {imageReview && <section className="word-review" aria-label="Image import review">
        <header><AlertTriangle size={17} /><h2>Image import — please review</h2><button onClick={() => setImageReview(undefined)}>Dismiss</button></header>
        <p>{imageReview.assignments.length} images matched · {imageReview.worksWithoutImage.length} works still without an image · {imageReview.unmatchedFiles.length + imageReview.ambiguousFiles.length} files not used</p>
        <ReviewGroup title="Approximate matches to check" items={imageReview.approximate} note="Spelling differences between the filename and the catalogue title. Open the card to confirm the picture; use “Choose image manually” to change it." />
        <ReviewGroup title="Works still without an image" items={imageReview.worksWithoutImage} />
        <ReviewGroup title="Files not matched" items={[...imageReview.ambiguousFiles, ...imageReview.unmatchedFiles]} note="Attach these by hand with “Choose image manually” on the right card." />
        <ReviewGroup title="Sizes without a unit" items={imageReview.noUnit} note="The filename gives numbers but no mm/cm. Shown as “unit not stated” — confirm with the artist or rename the file (e.g. …-102x98mm.jpg) and import again." />
        <ReviewGroup title="Extra photos kept aside" items={imageReview.spares} note="Scale shots, framed shots and second photos of works that already have an image." />
      </section>}
      {wordReview && <WordReviewPanel review={wordReview} onDismiss={() => setWordReview(undefined)} />}
      {importNotice && <div className="change-banner import-banner"><Check size={17} /><span>{importNotice}</span><button onClick={() => setImportNotice(undefined)} aria-label="Dismiss import message"><X size={15} /></button></div>}

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
          <div className="import-panel">
            <div className="filter-title"><FileUp size={15} /><h2>Import offline data</h2></div>
            <p>Merge another catalogue while preserving existing decisions.</p>
            <button className="word-import" onClick={() => wordInput.current?.click()}><FileText size={14} />Import Word lists (select all files)</button>
            <input ref={wordInput} className="visually-hidden" type="file" multiple accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => void importWordDocuments(event.target.files)} />
            {catalogue.wordLists && <small>Word lists merged: {catalogue.wordLists.files.length} file{catalogue.wordLists.files.length === 1 ? '' : 's'}, {new Date(catalogue.wordLists.importedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}. Import again (all files together) after any correction.</small>}
            <button onClick={() => spreadsheetInput.current?.click()}><FileUp size={14} />Import spreadsheet file</button>
            <input ref={spreadsheetInput} className="visually-hidden" type="file" accept=".csv,.tsv,.txt,.html,.htm,.xls,.xlsx,.xlsm,.xlsb,.ods,.fods" onChange={(event) => void importSpreadsheet(event.target.files?.[0])} />
            <button onClick={() => void importSheetLink()}><Link2 size={14} />Import Google Sheets link</button>
            <button onClick={() => imagesInput.current?.click()}><FolderOpen size={14} />Import image folder</button>
            <input ref={imagesInput} className="visually-hidden" type="file" accept="image/*,.heic,.heif,.tif,.tiff" multiple onChange={(event) => void importImageFolder(event.target.files)} />
            <small>Choose the whole images folder (subfolders included). Images are matched by artist, then title, and stored on this device; sizes are read from the filenames.</small>
            <button className="scan-form-button" onClick={() => { setOcrDraft(blankEntry(entryType)); setOcrOpen(true) }}><Camera size={14} />Scan / add entry form</button>
          </div>
          <div className="view-panel">
            <div className="filter-title"><Eye size={15} /><h2>Show</h2></div>
            <div className="order-toggle" role="group" aria-label="Card order">
              <button className={view.order === 'catalogue' ? 'selected' : ''} aria-pressed={view.order === 'catalogue'} onClick={() => setView({ ...view, order: 'catalogue' })}>Catalogue order</button>
              <button className={view.order === 'surname' ? 'selected' : ''} aria-pressed={view.order === 'surname'} onClick={() => setView({ ...view, order: 'surname' })}>A–Z only</button>
            </div>
            <label className="view-switch"><input type="checkbox" role="switch" checked={view.hideExcluded} onChange={(event) => setView({ ...view, hideExcluded: event.target.checked })} /><span>Hide excluded works</span></label>
            <div className="view-sections" role="group" aria-label="Show or hide catalogue sections">
              {SECTION_VIEW.map(([key, label]) => {
                const shown = !view.hiddenSections.includes(key)
                return <button key={key} className={shown ? 'shown' : ''} aria-pressed={shown} onClick={() => setView({ ...view, hiddenSections: shown ? [...view.hiddenSections, key] : view.hiddenSections.filter((item) => item !== key) })}>{shown ? <Eye size={14} /> : <EyeOff size={14} />}{label}<b>{sectionCounts[key]}</b></button>
              })}
            </div>
            <small>Counts are included works. Settings are remembered on this device.</small>
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
            {visibleArtists.map(({ artist, artworks, group }, index) => {
              const groupStart = view.order === 'catalogue' && (index === 0 || visibleArtists[index - 1].group !== group)
              const groupWorks = groupStart ? visibleArtists.filter((item) => item.group === group).reduce((sum, item) => sum + item.artworks.length, 0) : 0
              const override = catalogue.overrides[artist.id]
              const isYoungArtist = isYoungArtistRule(artist, override)
              const isExpanded = expanded.has(artist.id)
              const includedCount = artist.artworks.filter((artwork) => catalogue.decisions[artwork.id]?.decision === 'included').length
              const warningCount = artist.warnings.length + artist.artworks.reduce((sum, artwork) => sum + artwork.warnings.length, 0)
              return (
                <Fragment key={`${artist.id}-${group ?? 'all'}`}>
                {groupStart && <h3 className="group-heading">{CATALOGUE_GROUPS.find((item) => item.key === group)?.label ?? 'No artworks'}<span>{groupWorks} work{groupWorks === 1 ? '' : 's'}</span></h3>}
                <article className="artist-card">
                  <div className="artist-heading">
                    <button className="collapse-button" onClick={() => toggleArtist(artist.id)} aria-expanded={isExpanded}>{isExpanded ? <ChevronDown /> : <ChevronRight />}</button>
                    <div className="artist-identity">
                      <div className="name-editors">
                        <label><span>First Name</span><input value={override?.firstName ?? artist.firstName} onChange={(event) => catalogue.setArtistOverride(artist.id, { firstName: event.target.value })} onBlur={(event) => catalogue.setArtistOverride(artist.id, { firstName: capitaliseName(event.target.value) })} /></label>
                        <label><span>Surname</span><input value={override?.surname ?? artist.surname} onChange={(event) => catalogue.setArtistOverride(artist.id, { surname: event.target.value })} onBlur={(event) => catalogue.setArtistOverride(artist.id, { surname: capitaliseName(event.target.value) })} /></label>
                      </div>
                      <p>{[MEMBERSHIP_LABELS[artist.membershipType ?? 'non-member'], `Original: ${artist.fullName || 'Not supplied'}`, artist.email || 'No email', artist.phone, artist.address, artist.youngArtistAge !== undefined ? `Young Artist age ${artist.youngArtistAge}` : artist.dateOfBirth ? `DOB ${artist.dateOfBirth}` : '' ].filter(Boolean).join(' · ')}</p>
                      <div className="catalogue-meta-fields">
                        <label><span>Society initials</span><input value={override?.societyInitials ?? ''} placeholder="RMS ARMS HS" onChange={(event) => catalogue.setArtistOverride(artist.id, { societyInitials: event.target.value.toUpperCase() })} /></label>
                        <label><span>Award text</span><input value={override?.awardText ?? ''} placeholder="GOLD MEMORIAL BOWL 2026" onChange={(event) => catalogue.setArtistOverride(artist.id, { awardText: event.target.value.toUpperCase() })} /></label>
                      </div>
                    </div>
                    <div className="artist-meta">
                      <label className={`young-toggle ${isYoungArtist ? 'active' : ''}`} title={artist.youngArtist !== undefined ? 'Set by the Word lists — tick or untick to override' : artist.youngArtistAge !== undefined ? 'Age supplied by the submission' : undefined}><input type="checkbox" checked={isYoungArtist} onChange={(event) => catalogue.setArtistOverride(artist.id, { youngArtist: event.target.checked })} />Young Artist{artist.youngArtistAge !== undefined ? ` · age ${artist.youngArtistAge}` : ''}</label>
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
                              {artwork.votes.valid || artwork.votes.raw ? <span className={`vote verdict-${artwork.verdict}`}>{verdictLabel(artwork.verdict)} · Y {artwork.votes.yes} / N {artwork.votes.no} / M {artwork.votes.maybe}</span> : <span className="vote verdict-none">No vote data</span>}
                              <span className={`decision-label ${decision}`}>{decision}</span>
                            </div>
                            <h3>{artwork.title || 'Untitled artwork'}</h3>
                            <p className="medium">{[artwork.medium || 'Medium not supplied', `Artwork ${artwork.position}`].filter(Boolean).join(' · ')}</p>
                            {(() => { const size = artworkSize(artwork); return <p className={`size ${size ? '' : 'size-missing'}`}><Ruler size={13} />{size ? <><b>{size.value}</b>{size.source === 'image filename' && <span>from image filename{size.unitStated ? '' : ' — unit not stated'}</span>}</> : 'Size not given'}</p> })()}
                            <div className="section-toggle" role="group" aria-label={`Catalogue section for ${artwork.title || 'artwork'}`}>
                              <button className={!isSculpture(artwork, state) ? 'selected' : ''} aria-pressed={!isSculpture(artwork, state)} onClick={() => catalogue.setSculpture(artwork.id, false)}>Miniature painting</button>
                              <button className={isSculpture(artwork, state) ? 'selected' : ''} aria-pressed={isSculpture(artwork, state)} onClick={() => catalogue.setSculpture(artwork.id, true)}>Sculpture</button>
                            </div>
                            {isYoungArtist && <p className="section-note">Young Artist — catalogued under Young Artists.</p>}
                            <label className="price-input"><span>Catalogue price</span><span><b>£</b><input inputMode="decimal" value={artwork.price ?? ''} placeholder="0.00" onChange={(event) => void catalogue.setArtworkPrice(artwork.id, event.target.value)} /></span></label>
                            {changed?.length > 0 && <p className="updated-note"><RefreshCw size={14} />Updated since last sync: {changed.join(', ')}</p>}
                            {(artist.warnings.length > 0 || artwork.warnings.length > 0) && <div className="warnings">{[...artist.warnings, ...artwork.warnings].map((warning, index) => <span key={`${warning.code}-${index}`}><AlertTriangle size={13} />{warning.message}</span>)}</div>}
                            <label className="manual-image"><FolderOpen size={13} />{artwork.localImageName ? `Local: ${artwork.localImageName}` : 'Choose image manually'}<input type="file" accept="image/*,.heic,.heif,.tif,.tiff" onChange={(event) => { const file = event.target.files?.[0]; if (file) void catalogue.setLocalImage(artwork.id, file); event.target.value = '' }} /></label>

                            <div className="decision-row" role="group" aria-label={`Catalogue decision for ${artwork.title || 'artwork'}`}>
                              {(['included', 'excluded', 'undecided'] as CatalogueDecision[]).map((value) => <button className={decision === value ? 'selected' : ''} onClick={() => catalogue.setDecision(artwork.id, value)} key={value}>{value === 'included' ? 'Include' : value === 'excluded' ? 'Exclude' : 'Undecided'}</button>)}
                            </div>
                            {!state?.manual && <p className="recommendation">{artwork.votes.valid || artwork.votes.raw ? 'Initial recommendation from the vote result — change it at any time.' : 'Included from the imported exhibition list — change it at any time.'}</p>}

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
                </Fragment>
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
          <small>{ocrProvider === 'offline' ? 'Works without internet. Handwriting accuracy may be limited.' : 'Uses the RMS Gemini service. This sends the form’s personal details to Google and requires internet.'}</small>
        </div>
        {ocrDraft && <div className="ocr-review">
          <h3>Review before creating cards</h3><p>OCR can make mistakes. Correct every field, especially prices and A/X decisions.</p>
          <div className="contact-grid">
            <label><span>Artist name</span><input value={ocrDraft.fullName} onChange={(e) => setOcrDraft({ ...ocrDraft, fullName: e.target.value })} /></label>
            <label><span>Email</span><input value={ocrDraft.email} onChange={(e) => setOcrDraft({ ...ocrDraft, email: e.target.value })} /></label>
            <label><span>Phone</span><input value={ocrDraft.phone} onChange={(e) => setOcrDraft({ ...ocrDraft, phone: e.target.value })} /></label>
            <label><span>Society initials</span><input value={ocrDraft.societyInitials} onChange={(e) => setOcrDraft({ ...ocrDraft, societyInitials: e.target.value.toUpperCase() })} /></label>
            <label className="wide"><span>Address</span><input value={ocrDraft.address} onChange={(e) => setOcrDraft({ ...ocrDraft, address: e.target.value })} /></label>
          </div>
          <div className="ocr-artworks">{ocrDraft.artworks.map((work, index) => <div className={`ocr-artwork decision-${work.decision}`} key={index}>
            <strong>Artwork {index + 1}</strong><label><span>Title</span><input value={work.title} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, title: e.target.value } : item) })} /></label>
            <label><span>Medium</span><input value={work.medium} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, medium: e.target.value } : item) })} /></label>
            <label><span>Size (mm)</span><input value={work.dimensions} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, dimensions: e.target.value } : item) })} /></label>
            <label><span>Price £</span><input value={work.price} onChange={(e) => setOcrDraft({ ...ocrDraft, artworks: ocrDraft.artworks.map((item, i) => i === index ? { ...item, price: e.target.value } : item) })} /></label>
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
