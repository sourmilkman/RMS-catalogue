import Dexie, { type EntityTable } from 'dexie'
import type { ArtistOverride, ArtworkDecision, SourceSnapshot } from '../types'
import type { WordOverlay } from './wordMerge'

export interface StoredImage { artworkId: string; name: string; blob: Blob }

class CatalogueDatabase extends Dexie {
  source!: EntityTable<SourceSnapshot, 'id'>
  decisions!: EntityTable<ArtworkDecision, 'artworkId'>
  artistOverrides!: EntityTable<ArtistOverride, 'artistId'>
  overlays!: EntityTable<WordOverlay, 'id'>
  /** Local artwork images, kept apart from the catalogue data so routine saves stay small. */
  images!: EntityTable<StoredImage, 'artworkId'>

  constructor() {
    super('rmsCatalogueSelection')
    this.version(1).stores({ source: 'id', decisions: 'artworkId', artistOverrides: 'artistId' })
    this.version(2).stores({ source: 'id', decisions: 'artworkId', artistOverrides: 'artistId', overlays: 'id' })
    this.version(3).stores({ source: 'id', decisions: 'artworkId', artistOverrides: 'artistId', overlays: 'id', images: 'artworkId' })
  }
}

export const db = new CatalogueDatabase()
