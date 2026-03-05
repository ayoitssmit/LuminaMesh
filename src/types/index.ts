// LuminaMesh Type Definitions

export interface ChunkManifest {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  masterHash: string;
  chunkHashes: string[];
}

export interface PeerInfo {
  peerId: string;
  roomId: string;
  chunksAvailable: number[];
  isSeeder: boolean;
}

export interface RoomState {
  roomId: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  peers: PeerInfo[];
  createdAt: number;
  expiresAt: number;
}

export interface SignalData {
  type: "offer" | "answer" | "candidate";
  sdp?: string;
  candidate?: RTCIceCandidateInit;
}

export interface TransferProgress {
  peerId: string;
  chunksReceived: number;
  totalChunks: number;
  bytesReceived: number;
  totalBytes: number;
  speed: number; // bytes per second
}
