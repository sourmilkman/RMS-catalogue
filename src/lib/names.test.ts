import { describe, expect, it } from 'vitest'
import { splitName } from './names'

describe('name splitting', () => {
  it('keeps middle names with the first name', () => expect(splitName('Mary Anne van Dyke')).toMatchObject({ firstName: 'Mary Anne van', surname: 'Dyke' }))
  it('flags single names and studio text for review', () => {
    expect(splitName('Madonna').suspicious).toBe(true)
    expect(splitName('North Street Studio').suspicious).toBe(true)
  })
})
