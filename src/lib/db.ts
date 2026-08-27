import Dexie, { type EntityTable } from 'dexie'
import type { ArtistOverride, ArtworkDecision, SourceSnapshot } from '../types'

class CatalogueDatabase extends Dexie {
  source!: EntityTable<SourceSnapshot, 'id'>
  decisions!: EntityTable<ArtworkDecision, 'artworkId'>
  artistOverrides!: EntityTable<ArtistOverride, 'artistId'>

  constructor() {
    super('rmsCatalogueSelection')
    this.version(1).stores({ source: 'id', decisions: 'artworkId', artistOverrides: 'artistId' })
  }
}

export const db = new CatalogueDatabase()
