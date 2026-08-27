export interface SplitName {
  firstName: string
  surname: string
  suspicious: boolean
}

export function capitaliseName(value: string): string {
  return value.trim().replace(/(^|[\s'-])(\p{L})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`)
}

export function splitName(fullName: string): SplitName {
  const cleaned = capitaliseName(fullName.replace(/\s+/g, ' '))
  const parts = cleaned.split(' ').filter(Boolean)
  if (parts.length < 2) return { firstName: cleaned, surname: '', suspicious: true }
  const suspicious = /\d|\b(studio|gallery|ltd|limited|society|company|co\.)\b|&/i.test(cleaned)
  return {
    firstName: parts.slice(0, -1).join(' '),
    surname: parts.at(-1) ?? '',
    suspicious,
  }
}
