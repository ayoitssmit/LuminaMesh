"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { PeerManager } from "@/lib/peerManager";
import { SocketClient } from "@/lib/socketClient";
import { ChunkScheduler } from "@/lib/chunkScheduler";
import { getRecoveredBitfield, deleteSessionCache, getAllCachedChunks, addHistoryEntry } from "@/lib/indexedDB";
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
    fetch("/api/room/" + roomId)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setRoomData({
            roomId: data.room.roomId,
            file: data.room.file,
            peerId: data.peerId,
            token: data.token,
          });
          setStatus("connecting");
        } else {
          setError(data.error || "Room not found");
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
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
    });

    // We load the bitfield asynchronously before starting the mesh
    getRecoveredBitfield(roomData.file.masterHash, chunkCount).then((initialBitfield) => {
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
                const blob = new Blob(cachedChunks, {
                  type: roomData.file.mimeType || "application/octet-stream",
                });
                setAssembledBlob(blob);
              }
            } catch (err) {
              console.error("Failed to complete assembly:", err);
            }

            setStatus("complete");
            setSeeding(true); // Keep serving chunks to the swarm

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
          chunkSize: 64 * 1024,
          fileHandle: fileHandleRef.current || undefined,
          writable: writableRef.current || undefined
        }
      );

      // If we recovered a 100% complete bitfield, immediately trigger assembly and purge!
      // We don't need to start the scheduler's gossip loop for downloading, just seeding.
      if (initialBitfield.size === chunkCount) {
         console.log("[UI] Recovered 100% of chunks from DB! Assembling immediately...");
         scheduler.events.onComplete(scheduler.chunks as ArrayBuffer[]);
      }

      scheduler.start();
      schedulerRef.current = scheduler;
      
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

      socketClient.connect(window.location.origin, roomData.token);
      socketClientRef.current = socketClient;
    });

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
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>LuminaMesh</h1>
          <p className={styles.subtitle}>Peer-to-peer file transfer</p>
        </div>
        <button className={styles.backBtn} onClick={() => router.push("/dashboard")}>
          Back to Dashboard
        </button>
      </div>

      <div className={styles.fileCard}>
        <p className={styles.fileName}>{roomData.file.name}</p>
        <p className={styles.fileMeta}>
          {formatSize(roomData.file.size)} &middot; {roomData.file.chunkCount} chunks
        </p>

        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: progress + "%" }} />
        </div>
        <div className={styles.progressRow}>
          <span>{chunksReceived} / {roomData.file.chunkCount} chunks</span>
          <span>{progress}%</span>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{connectedPeers.length}</span>
            <span className={styles.statLabel}>Peers</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{formatSize(roomData.file.size)}</span>
            <span className={styles.statLabel}>File Size</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{roomData.file.mimeType || "unknown"}</span>
            <span className={styles.statLabel}>Type</span>
          </div>
        </div>

        {status === "waiting_for_permission" && (
          <div style={{ marginTop: "24px", padding: "16px", backgroundColor: "rgba(255,165,0,0.1)", border: "1px solid rgba(255,165,0,0.3)", borderRadius: "8px", textAlign: "center" }}>
            <p style={{ color: "#ffa500", marginBottom: "16px", fontSize: "0.95rem" }}>
              This file is very large (over 500 MB). We will stream it directly to your disk to prevent crashing your browser.
            </p>
            <button className={styles.downloadBtn} onClick={handleGrantPermission}>
              Choose Save Location to Begin
            </button>
          </div>
        )}

        {status === "connecting" && (
          <div className={`${styles.badge} ${styles.badgeConnecting}`}>
            <span className={`${styles.pulseDot} ${styles.dotYellow}`} />
            Waiting for peers...
          </div>
        )}

        {status === "downloading" && (
          <div className={`${styles.badge} ${styles.badgeDownloading}`}>
            <span className={`${styles.pulseDot} ${styles.dotBlue}`} />
            Downloading from {connectedPeers.length} peer(s)
          </div>
        )}

        {status === "complete" && (
          <>
            <div className={`${styles.badge} ${styles.badgeComplete}`}>
              <span className={`${styles.pulseDot} ${styles.dotGreen}`} />
              {seeding
                ? `Complete — Seeding to ${connectedPeers.length} peer(s)`
                : "Transfer complete"}
            </div>
            {assembledBlob ? (
              <button className={styles.downloadBtn} onClick={downloadFile}>
                Save File
              </button>
            ) : (
              <div style={{ marginTop: "16px", color: "#22c55e", textAlign: "center", fontWeight: "500" }}>
                File was saved directly to your disk!
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
