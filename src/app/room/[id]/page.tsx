"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { PeerManager } from "@/lib/peerManager";
import { SocketClient } from "@/lib/socketClient";
import { ChunkScheduler } from "@/lib/chunkScheduler";
import { getRecoveredBitfield, deleteSessionCache, getAllCachedChunks, addHistoryEntry } from "@/lib/indexedDB";
import MeshTransferVisualizer from "@/components/ui/MeshTransferVisualizer";
import styles from "./room.module.css";

type FileInfo = {
  name: string;
  size: string;
  masterHash: string;
  chunkCount: number;
  mimeType: string;
};

type RoomData = {
  roomId: string;
  file: FileInfo;
  peerId: string;
  token: string;
  iceServers: RTCIceServer[];
};

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function RoomPage({ params }: PageProps) {
  const router = useRouter();
  const { id: roomId } = use(params);
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "connecting" | "downloading" | "complete" | "waiting_for_permission">("loading");
  const [chunksReceived, setChunksReceived] = useState(0);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [assembledBlob, setAssembledBlob] = useState<Blob | null>(null);
  const [seeding, setSeeding] = useState(false);

  const peerManagerRef = useRef<PeerManager | null>(null);
  const socketClientRef = useRef<SocketClient | null>(null);
  const schedulerRef = useRef<ChunkScheduler | null>(null);
  const meshStarted = useRef(false);
  const [fileHandleGranted, setFileHandleGranted] = useState(false);
  const fileHandleRef = useRef<any>(null);
  const writableRef = useRef<any>(null);

  // Fetch room metadata
  useEffect(() => {
    let cancelled = false;

    fetch("/api/room/" + roomId)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;

        if (data.success) {
          setRoomData({
            roomId: data.room.roomId,
            file: data.room.file,
            peerId: data.peerId,
            token: data.token,
            iceServers: data.iceServers,
          });
          setStatus("connecting");
        } else {
          setError(data.error || "Room not found");
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [roomId]);

  // Connect to mesh once we have room data
  useEffect(() => {
    if (!roomData || meshStarted.current) return;

    const fileSize = parseInt(roomData.file.size, 10);
    const isLargeFile = fileSize > 500 * 1024 * 1024; // > 500 MB

    if (isLargeFile && !fileHandleGranted) {
      setStatus("waiting_for_permission");
      return;
    }

    meshStarted.current = true;

    const chunkCount = roomData.file.chunkCount;
    // We don't have individual chunk hashes from the API yet,
    // so we skip hash verification for now (trust the seeder)
    const placeholderHashes = new Array(chunkCount).fill("");

    const peerManager = new PeerManager({
      onPeerConnected: (peerId) => {
        setConnectedPeers((prev) => [...prev, peerId]);
        setStatus("downloading");
      },
      onPeerDisconnected: (peerId) => {
        setConnectedPeers((prev) => prev.filter((p) => p !== peerId));
        if (schedulerRef.current) {
          schedulerRef.current.removePeer(peerId);
        }
      },
      onSignal: (peerId, signalData) => {
        if (socketClientRef.current) {
          socketClientRef.current.sendSignal(peerId, signalData);
        }
      },
      onData: (peerId, message) => {
        if (schedulerRef.current) {
          schedulerRef.current.handleMessage(peerId, message);
        }
      },
    }, roomData.iceServers);

    peerManager.setPeerId(roomData.peerId);
    peerManagerRef.current = peerManager;

    const isSeeder = roomData.peerId.startsWith("seeder");

    const initMesh = async () => {
      // [MESH-ONLY ENFORCEMENT]: Bypass cache if receiver and not reloading
      let initialBitfield = new Set<number>();
      
      if (isSeeder) {
        // SENDER: Always load from IndexedDB — we cached the chunks during upload
        initialBitfield = await getRecoveredBitfield(roomData.file.masterHash, chunkCount);
        console.log(`[UI] Sender loaded ${initialBitfield.size}/${chunkCount} chunks from cache.`);
      } else {
        // RECEIVER: Check if this is a fresh join or a reload
        let isFreshJoin = false;
        if (typeof performance !== "undefined") {
          const navEntry = window.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          if (navEntry && navEntry.type !== "reload") {
            isFreshJoin = true;
            console.log("[UI] Fresh join detected. Bypassing local cache to force mesh transfer.");
          }
        }
        if (!isFreshJoin) {
          initialBitfield = await getRecoveredBitfield(roomData.file.masterHash, chunkCount);
        }
      }

      const scheduler = new ChunkScheduler(
        peerManager,
        {
          onProgress: (have) => {
            setChunksReceived(have);
          },
          onComplete: async (allChunks) => {
            try {
              if (writableRef.current) {
                // Large File: Stream is already writing directly to the disk, just close it
                await writableRef.current.close().catch(console.error);
                setAssembledBlob(null);
                
                // For Large Files, the final file is saved on disk. It is safe to purge now.
                await deleteSessionCache(roomData.file.masterHash);
              } else {
                // Small File: Retrieve all chunks from IndexedDB cache and assemble Blob
                // WE DO NOT PURGE YET. We wait for the user to explicitly click "Save File"
                const cachedChunks = await getAllCachedChunks(roomData.file.masterHash);
                
                // CRITICAL SPEED FIX: Load chunks into the scheduler's RAM so seeding is instantaneous!
                // Without this, the seeder hits IndexedDB for every single 60KB chunk request.
                if (schedulerRef.current) {
                  schedulerRef.current.seedAll(cachedChunks);
                }
                
                // Wrap ArrayBuffers in Uint8Array before passing to Blob constructor.
                // Direct ArrayBuffers cause string-coercion corruption in some WebKit/Blink versions.
                const uint8Chunks = cachedChunks.map(buffer => new Uint8Array(buffer));
                const blob = new Blob(uint8Chunks, {
                  type: roomData.file.mimeType || "application/octet-stream",
                });
                setAssembledBlob(blob);
              }
            } catch (err) {
              console.error("Failed to complete assembly:", err);
            }

            setStatus("complete"); 
            setSeeding(true); // Keep serving chunks to the swarm
            scheduler.startPushing(); // Actively push to remaining peers

            // Only record history if we actually DOWNLOADED the file (i.e. not the original sender)
            if (!isSeeder) {
              // Record this download in transfer history locally
              addHistoryEntry({
                direction: "received",
                fileName: roomData.file.name,
                fileSize: parseInt(roomData.file.size, 10),
                roomId: roomData.roomId,
                peers: peerManager.getConnectedPeers(),
                timestamp: Date.now(),
              }).catch(console.error);

              // Record this download in the server Postgres database so it appears on Dashboard
              fetch("/api/history", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  direction: "received",
                  fileName: roomData.file.name,
                  fileSize: roomData.file.size,
                  roomId: roomData.roomId,
                  peers: peerManager.getConnectedPeers(),
                }),
              }).catch(console.error);
            }
          },
          onChunkVerified: () => {},
          onChunkFailed: (index, peerId) => {
            console.warn(`[UI] Chunk ${index} failed hash verification from ${peerId}`);
          },
        },
        chunkCount,
        placeholderHashes,
        roomData.file.masterHash,
        initialBitfield,
        {
          chunkSize: 60 * 1024,
          fileHandle: fileHandleRef.current || undefined,
          writable: writableRef.current || undefined
        }
      );

      schedulerRef.current = scheduler;

      // SENDER FAST PATH: If we have 100% of chunks, load into RAM and start pushing IMMEDIATELY
      if (initialBitfield.size === chunkCount) {
        console.log("[UI] Sender has 100% of chunks. Loading into RAM and starting push loop...");
        const allChunks = await getAllCachedChunks(roomData.file.masterHash);
        scheduler.seedAll(allChunks);
        scheduler.startPushing();
        setStatus("complete");
        setSeeding(true);
        setChunksReceived(chunkCount);
      }

      scheduler.start();
      const socketClient = new SocketClient(peerManager, {
        onConnected: () => {
          setStatus((prev) => {
            if (prev === "complete") return "complete";
            if (peerManagerRef.current && peerManagerRef.current.getConnectedPeers().length > 0) {
              return "downloading";
            }
            return "connecting";
          });
          setError(null);
        },
        onDisconnected: () => {
          console.warn("[UI] Socket disconnected, attempting to reconnect...");
        },
        onError: (msg) => {
          setError(`Connection issue: ${msg}`);
        },
        onPeerJoined: () => {},
        onPeerLeft: () => {},
      }, roomData.peerId);

      socketClient.connect(roomData.token);
      socketClientRef.current = socketClient;
    };

    initMesh();

    return () => {
      meshStarted.current = false;
      if (schedulerRef.current) schedulerRef.current.stop();
      if (socketClientRef.current) socketClientRef.current.disconnect();
    };
  }, [roomData, fileHandleGranted]);

  const handleGrantPermission = async () => {
    if (!roomData) return;
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: roomData.file.name,
      });
      const writable = await handle.createWritable();
      fileHandleRef.current = handle;
      writableRef.current = writable;
      setFileHandleGranted(true);
      setStatus("connecting");
    } catch (err) {
      console.error("User denied permission", err);
    }
  };

  const formatSize = (bytes: number | string) => {
    const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  };

  const progress = roomData
    ? Math.round((chunksReceived / roomData.file.chunkCount) * 100)
    : 0;

  const downloadFile = useCallback(async () => {
    if (!assembledBlob || !roomData) return;
    const url = URL.createObjectURL(assembledBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = roomData.file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Now that the user has explicitly requested the file to be saved to their OS, we purge DB
    try {
      console.log("[UI] User clicked Save File. Purging IndexedDB...");
      await deleteSessionCache(roomData.file.masterHash);
      setAssembledBlob(null); // Clear RAM blob and trigger UI re-render confirming save
      console.log("[UI] DB Purge complete.");
    } catch (err) {
      console.error("[UI] Failed to purge IndexedDB after download", err);
    }
  }, [assembledBlob, roomData]);

  if (loading) {
    return (
      <div className={styles.container}>
        <p className={styles.loading}>Connecting to room...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <h1 className={styles.title}>LuminaMesh</h1>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (!roomData) return null;

  return (
    <div className={styles.container}>
      {status === "waiting_for_permission" ? (
        <div className={styles.fileCard}>
          <h1 className={styles.title}>LuminaMesh</h1>
          <p className={styles.fileName}>{roomData.file.name}</p>
          <div style={{ marginTop: "24px", padding: "16px", backgroundColor: "rgba(255,165,0,0.1)", border: "1px solid rgba(255,165,0,0.3)", borderRadius: "8px", textAlign: "center" }}>
            <p style={{ color: "#ffa500", marginBottom: "16px", fontSize: "0.95rem" }}>
              This file is very large (over 500 MB). We will stream it directly to your disk to prevent crashing your browser.
            </p>
            <button className={styles.downloadBtn} onClick={handleGrantPermission}>
              Choose Save Location to Begin
            </button>
          </div>
        </div>
      ) : (
        <MeshTransferVisualizer
          roomData={roomData}
          connectedPeers={connectedPeers}
          chunksReceived={chunksReceived}
          totalChunks={roomData.file.chunkCount}
          // If chunks === total we're a seeder now, but conceptually the "Sender" is the room owner
          isSender={roomData.peerId.startsWith("seeder")}
          transferSpeed={0} // To be implemented with chunk scheduler speed stats
          onSave={assembledBlob ? downloadFile : undefined}
          onClose={() => router.push("/dashboard")}
          isComplete={status === "complete"}
        />
      )}
    </div>
  );
}
