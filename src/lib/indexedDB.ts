import Dexie, { type EntityTable } from 'dexie';

export interface ChunkRecord {
  id: string; // Composite key: `${masterHash}_${index}`
  masterHash: string;
  index: number;
  data: ArrayBuffer;
}

export interface SessionRecord {
  masterHash: string;
  roomId: string;
  lastModified: number;
}

class LuminaMeshDatabase extends Dexie {
  chunks!: EntityTable<ChunkRecord, 'id'>;
  sessions!: EntityTable<SessionRecord, 'masterHash'>;

  constructor() {
    super('LuminaMeshDB');
    
    // Define indices for querying
    this.version(1).stores({
      chunks: 'id, masterHash, index',
      sessions: 'masterHash, roomId, lastModified'
    });
    
    // Bump version to rebuild indices in case of previous schema corruption
    this.version(2).stores({
      chunks: 'id, masterHash, index',
      sessions: 'masterHash, roomId, lastModified'
    });
  }
}

export const db = new LuminaMeshDatabase();

// In case of severe schema corruption during development, expose a manual nuke
export async function nukeDatabase() {
  console.warn("[IndexedDB] Nuking entire database schema due to corruption...");
  await db.delete();
  await db.open();
  console.log("[IndexedDB] Database rebuilt.");
}

/**
 * Save a verified chunk to IndexedDB
 */
export async function saveChunkToCache(masterHash: string, index: number, data: ArrayBuffer): Promise<void> {
  const id = `${masterHash}_${index}`;
  await db.chunks.put({
    id,
    masterHash,
    index,
    data
  });
}

/**
 * Create or update a session timestamp
 */
export async function updateSessionInfo(masterHash: string, roomId: string): Promise<void> {
  await db.sessions.put({
    masterHash,
    roomId,
    lastModified: Date.now()
  });
}

/**
 * Query IndexedDB to find out which chunks we already have for a specific file
 */
export async function getRecoveredBitfield(masterHash: string, totalChunks: number): Promise<Set<number>> {
  const haveSet = new Set<number>();
  
  // We just need the indices, not the massive ArrayBuffers
  const storedChunks = await db.chunks
    .where('masterHash')
    .equals(masterHash)
    .toArray();
    
  for (const chunk of storedChunks) {
    haveSet.add(chunk.index);
  }
  
  return haveSet;
}

/**
 * Retrieve a specific chunk's ArrayBuffer from IndexedDB
 */
export async function getCachedChunk(masterHash: string, index: number): Promise<ArrayBuffer | null> {
  const id = `${masterHash}_${index}`;
  const record = await db.chunks.get(id);
  return record ? record.data : null;
}

/**
 * Fetch all chunks sorted by index for final assembly
 */
export async function getAllCachedChunks(masterHash: string): Promise<ArrayBuffer[]> {
  const records = await db.chunks
    .where('masterHash')
    .equals(masterHash)
    .sortBy('index');
    
  return records.map(r => r.data);
}

/**
 * Purge a session and all its chunks from the database
 * Used when a download completes successfully or hits GC.
 */
export async function deleteSessionCache(masterHash: string): Promise<void> {
  try {
    console.log(`[IndexedDB] Executing explicit purge for hash: ${masterHash}`);
    await db.sessions.delete(masterHash);
    const deletedChunksCount = await db.chunks.where('masterHash').equals(masterHash).delete();
    console.log(`[IndexedDB] Successfully purged ${deletedChunksCount} chunks.`);
  } catch (err) {
    console.error(`[IndexedDB] CRITICAL ERROR during purge:`, err);
  }
}

/**
 * Automated Garbage Collection for incomplete downloads older than `maxAgeMs`
 */
export async function runGarbageCollection(maxAgeMs = 7 * 24 * 60 * 60 * 1000/* 7 days */): Promise<void> {
  try {
    const cutoffTime = Date.now() - maxAgeMs;
    
    const staleSessions = await db.sessions
      .where('lastModified')
      .below(cutoffTime)
      .toArray();
      
    for (const session of staleSessions) {
      console.log(`[IndexedDB GC] Purging abandoned download: ${session.masterHash}`);
      await deleteSessionCache(session.masterHash);
    }
  } catch (err) {
    console.error(`[IndexedDB GC] Failed to run garbage collection:`, err);
  }
}
