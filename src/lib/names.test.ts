import { describe, expect, it } from 'vitest'
import { splitName } from './names'

describe('name splitting', () => {
  it('capitalises each name part and keeps middle names with the first name', () => expect(splitName('mary anne van dyke')).toMatchObject({ firstName: 'Mary Anne Van', surname: 'Dyke' }))
  it('flags single names and studio text for review', () => {
    expect(splitName('Madonna').suspicious).toBe(true)
    expect(splitName('North Street Studio').suspicious).toBe(true)
  })
})
