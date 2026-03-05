import { redis } from "./redis";

// Key formats for Redis:
// "room:peers:{roomId}" -> Set of active Peer IDs in the room

const ROOM_TTL_SECONDS = 60 * 60 * 24; // 24 hours (Rooms self-destruct if somehow left hanging)

/**
 * Adds a peer to the room's active swarm in Redis.
 */
export async function addPeerToRoom(roomId: string, peerId: string) {
  const key = `room:peers:${roomId}`;
  await redis.sadd(key, peerId);
  // Reset the TTL so the room lives as long as there is activity
  await redis.expire(key, ROOM_TTL_SECONDS);
}

/**
 * Removes a peer from the room's active swarm in Redis.
 * If the room becomes empty, we let it expire naturally or can explicitly delete it.
 */
export async function removePeerFromRoom(roomId: string, peerId: string) {
  const key = `room:peers:${roomId}`;
  await redis.srem(key, peerId);
}

/**
 * Gets all active peer IDs currently in the room's swarm.
 */
export async function getPeersInRoom(roomId: string): Promise<string[]> {
  const key = `room:peers:${roomId}`;
  return await redis.smembers(key);
}

/**
 * Checks if a room has any active peers.
 */
export async function isRoomActive(roomId: string): Promise<boolean> {
  const key = `room:peers:${roomId}`;
  const count = await redis.scard(key);
  return count > 0;
}
