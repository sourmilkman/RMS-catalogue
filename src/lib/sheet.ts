import type { SourceSnapshot } from '../types'
import { normaliseSheetCsv } from './normalise'

export const DEFAULT_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1UR7J2JYYI490ldJql0tlAP7PHwzOVNsUv7j_2SjqpJ8/export?format=csv&gid=813824911'

export async function getRmsReviewData(signal?: AbortSignal): Promise<SourceSnapshot> {
  const configuredUrl = import.meta.env.VITE_RMS_SHEET_CSV_URL as string | undefined
  const url = new URL(configuredUrl || DEFAULT_SHEET_CSV_URL)
  url.searchParams.set('_rms_refresh', Date.now().toString())
  const response = await fetch(url, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`Google Sheet refresh failed (${response.status}).`)
  return normaliseSheetCsv(await response.text())
}
