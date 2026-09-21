import type { ExportRow } from './exportDocx'

export const GOOGLE_CLIENT_ID = '38381535365-kus1f8dgi5pn9c0v9j6r89nvmrtnun20.apps.googleusercontent.com'
export const CLIENT_ID_KEY = 'rms-google-client-id'
const SPREADSHEET_ID_KEY = 'rms-google-backup-spreadsheet-id'
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file'

declare global {
  interface Window { google?: { accounts: { oauth2: { initTokenClient: (config: { client_id: string; scope: string; callback: (response: { access_token?: string; error?: string }) => void }) => { requestAccessToken: (config?: { prompt?: string }) => void } } } } }
}

function clientId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || undefined
}

export function saveGoogleClientId(): void {
  localStorage.setItem(CLIENT_ID_KEY, GOOGLE_CLIENT_ID)
}

export function hasGoogleClientId(): boolean {
  return Boolean(clientId())
}

async function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts.oauth2) return
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]')
    if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); existing.addEventListener('error', () => reject(new Error('Unable to load Google sign-in.')), { once: true }); return }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Unable to load Google sign-in.'))
    document.head.append(script)
  })
}

async function accessToken(): Promise<string> {
  const id = clientId() || window.prompt('Paste the Google OAuth Web client ID for this app. It is saved only on this device.')?.trim()
  if (!id) throw new Error('Google Sheet backup needs a Google OAuth client ID.')
  if (!clientId()) localStorage.setItem(CLIENT_ID_KEY, id)
  await loadGoogleIdentity()
  return new Promise<string>((resolve, reject) => {
    const tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: SCOPES,
      callback: (response) => response.access_token ? resolve(response.access_token) : reject(new Error(response.error || 'Google sign-in was cancelled.')),
    })
    tokenClient.requestAccessToken({ prompt: 'consent' })
  })
}

function backupValues(rows: ExportRow[]): string[][] {
  return [
    ['First Name', 'Surname', 'Title', 'Price', 'Yes', 'No', 'Maybe', 'Email', 'DOB / Young Artist', 'Source Image URL', 'Google Drive Image URL', 'Offline Image File'],
    ...rows.map((row) => [row.firstName, row.surname, row.title, row.price, String(row.yes), String(row.no), String(row.maybe), row.email, row.dobYoungArtist, row.includeDownload ? row.imageUrl ?? '' : '', row.driveImageUrl ?? '', row.localImageName ?? '']),
  ]
}

async function request<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } })
  if (!response.ok) throw new Error(`Google Sheets request failed (${response.status}).`)
  return response.json() as Promise<T>
}

async function findBackupSpreadsheet(token: string): Promise<string | undefined> {
  const name = encodeURIComponent("name = 'RMS Catalogue Selection Backup' and trashed = false")
  const found = await request<{ files: { id: string }[] }>(`https://www.googleapis.com/drive/v3/files?q=${name}&orderBy=createdTime%20desc&pageSize=1&fields=files(id)`, token)
  return found.files[0]?.id
}

async function driveImageFolder(token: string): Promise<string> {
  const query = encodeURIComponent("name = 'RMS Catalogue Images' and mimeType = 'application/vnd.google-apps.folder' and trashed = false")
  const found = await request<{ files: { id: string }[] }>(`https://www.googleapis.com/drive/v3/files?q=${query}&pageSize=1&fields=files(id)`, token)
  if (found.files[0]) return found.files[0].id
  const created = await request<{ id: string }>('https://www.googleapis.com/drive/v3/files?fields=id', token, { method: 'POST', body: JSON.stringify({ name: 'RMS Catalogue Images', mimeType: 'application/vnd.google-apps.folder' }) })
  return created.id
}

async function uploadLocalImages(rows: ExportRow[], token: string): Promise<ExportRow[]> {
  const localRows = rows.filter((row) => row.localImage)
  if (!localRows.length) return rows
  const folderId = await driveImageFolder(token)
  const uploaded = new Map<string, string>()
  for (const row of localRows) {
    const name = row.localImageName || `${row.artworkId}.jpg`
    const created = await request<{ id: string }>('https://www.googleapis.com/drive/v3/files?fields=id', token, { method: 'POST', body: JSON.stringify({ name, parents: [folderId], appProperties: { rmsArtworkId: row.artworkId } }) })
    const upload = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': row.localImage!.type || 'application/octet-stream' }, body: row.localImage })
    if (!upload.ok) throw new Error(`Google Drive image upload failed (${upload.status}).`)
    const file = await request<{ webViewLink: string }>(`https://www.googleapis.com/drive/v3/files/${created.id}?fields=webViewLink`, token)
    uploaded.set(row.artworkId, file.webViewLink)
  }
  return rows.map((row) => ({ ...row, driveImageUrl: uploaded.get(row.artworkId) ?? row.driveImageUrl }))
}

export async function exportBackupSheet(rows: ExportRow[], uploadImages = false): Promise<{ spreadsheetUrl: string; rows: ExportRow[] }> {
  const token = await accessToken()
  const exportedRows = uploadImages ? await uploadLocalImages(rows, token) : rows
  let spreadsheetId = localStorage.getItem(SPREADSHEET_ID_KEY) || await findBackupSpreadsheet(token)
  if (!spreadsheetId) {
    const created = await request<{ spreadsheetId: string; spreadsheetUrl: string }>('https://sheets.googleapis.com/v4/spreadsheets', token, { method: 'POST', body: JSON.stringify({ properties: { title: 'RMS Catalogue Selection Backup' }, sheets: [{ properties: { title: 'Selection' } }] }) })
    spreadsheetId = created.spreadsheetId
  }
  localStorage.setItem(SPREADSHEET_ID_KEY, spreadsheetId)
  try {
    await request(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Selection:clear`, token, { method: 'POST', body: '{}' })
    await request(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Selection!A1`, token, { method: 'PUT', body: JSON.stringify({ range: 'Selection!A1', majorDimension: 'ROWS', values: backupValues(exportedRows) }) })
  } catch (error) {
    localStorage.removeItem(SPREADSHEET_ID_KEY)
    throw error
  }
  return { spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, rows: exportedRows }
}
