import Dexie, { type EntityTable } from 'dexie'
import type { ArtistOverride, ArtworkDecision, SourceSnapshot } from '../types'
import type { WordOverlay } from './wordMerge'

class CatalogueDatabase extends Dexie {
  source!: EntityTable<SourceSnapshot, 'id'>
  decisions!: EntityTable<ArtworkDecision, 'artworkId'>
  artistOverrides!: EntityTable<ArtistOverride, 'artistId'>
  overlays!: EntityTable<WordOverlay, 'id'>

  constructor() {
    super('rmsCatalogueSelection')
    this.version(1).stores({ source: 'id', decisions: 'artworkId', artistOverrides: 'artistId' })
    this.version(2).stores({ source: 'id', decisions: 'artworkId', artistOverrides: 'artistId', overlays: 'id' })
  }
}

export const db = new CatalogueDatabase()
