import type { ExportRow } from './exportDocx'

const CLIENT_ID_KEY = 'rms-google-client-id'
const SPREADSHEET_ID_KEY = 'rms-google-backup-spreadsheet-id'
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file'

declare global {
  interface Window { google?: { accounts: { oauth2: { initTokenClient: (config: { client_id: string; scope: string; callback: (response: { access_token?: string; error?: string }) => void }) => { requestAccessToken: (config?: { prompt?: string }) => void } } } } }
}

function clientId(): string | undefined {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || undefined
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
    ['R Number', 'First Name', 'Surname', 'Title', 'Yes', 'No', 'Maybe', 'Email', 'DOB / Young Artist', 'Image URL'],
    ...rows.map((row) => [row.rNumber, row.firstName, row.surname, row.title, String(row.yes), String(row.no), String(row.maybe), row.email, row.dobYoungArtist, row.includeDownload ? row.imageUrl ?? '' : '']),
  ]
}

async function request<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers } })
  if (!response.ok) throw new Error(`Google Sheets request failed (${response.status}).`)
  return response.json() as Promise<T>
}

export async function exportBackupSheet(rows: ExportRow[]): Promise<string> {
  const token = await accessToken()
  let spreadsheetId = localStorage.getItem(SPREADSHEET_ID_KEY)
  if (!spreadsheetId) {
    const created = await request<{ spreadsheetId: string; spreadsheetUrl: string }>('https://sheets.googleapis.com/v4/spreadsheets', token, { method: 'POST', body: JSON.stringify({ properties: { title: 'RMS Catalogue Selection Backup' }, sheets: [{ properties: { title: 'Selection' } }] }) })
    spreadsheetId = created.spreadsheetId
    localStorage.setItem(SPREADSHEET_ID_KEY, spreadsheetId)
  }
  try {
    await request(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Selection:clear`, token, { method: 'POST', body: '{}' })
    await request(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Selection!A1`, token, { method: 'PUT', body: JSON.stringify({ range: 'Selection!A1', majorDimension: 'ROWS', values: backupValues(rows) }) })
  } catch (error) {
    localStorage.removeItem(SPREADSHEET_ID_KEY)
    throw error
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

export function validateRNumbers(rows: ExportRow[]): string | undefined {
  const missing = rows.filter((row) => !/^R\d+$/i.test(row.rNumber)).length
  if (missing) return `${missing} included artwork${missing === 1 ? ' needs' : 's need'} a unique R number in the format R225.`
  const duplicate = rows.map((row) => row.rNumber.toLocaleUpperCase()).find((value, index, values) => values.indexOf(value) !== index)
  return duplicate ? `${duplicate} is used more than once. R numbers must be unique.` : undefined
}
