"use client";

import { useState, useEffect, useCallback, useRef, use } from "react";
import { PeerManager } from "@/lib/peerManager";
import { SocketClient } from "@/lib/socketClient";
import { ChunkScheduler } from "@/lib/chunkScheduler";
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
  const { id: roomId } = use(params);
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "connecting" | "downloading" | "complete">("loading");
  const [chunksReceived, setChunksReceived] = useState(0);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [assembledBlob, setAssembledBlob] = useState<Blob | null>(null);
  const [seeding, setSeeding] = useState(false);

  const peerManagerRef = useRef<PeerManager | null>(null);
  const socketClientRef = useRef<SocketClient | null>(null);
  const schedulerRef = useRef<ChunkScheduler | null>(null);
  const meshStarted = useRef(false);

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

    const scheduler = new ChunkScheduler(
      peerManager,
      {
        onProgress: (have) => {
          setChunksReceived(have);
        },
        onComplete: (allChunks) => {
          const blob = new Blob(allChunks, {
            type: roomData.file.mimeType || "application/octet-stream",
          });
          setAssembledBlob(blob);
          setStatus("complete");
          setSeeding(true); // Keep serving chunks to the swarm
        },
        onChunkVerified: () => {},
        onChunkFailed: () => {},
      },
      chunkCount,
      placeholderHashes
    );

    scheduler.start();

    const socketClient = new SocketClient(peerManager, {
      onConnected: () => {
        setStatus("connecting");
      },
      onDisconnected: () => {},
      onError: (msg) => {
        setError("Socket error: " + msg);
      },
      onPeerJoined: () => {},
      onPeerLeft: () => {},
    }, roomData.peerId);

    socketClient.connect(window.location.origin, roomData.token);

    peerManagerRef.current = peerManager;
    socketClientRef.current = socketClient;
    schedulerRef.current = scheduler;

    return () => {
      meshStarted.current = false;
      scheduler.stop();
      socketClient.disconnect();
    };
  }, [roomData]);

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

  const downloadFile = useCallback(() => {
    if (!assembledBlob || !roomData) return;
    const url = URL.createObjectURL(assembledBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = roomData.file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      <h1 className={styles.title}>LuminaMesh</h1>
      <p className={styles.subtitle}>Peer-to-peer file transfer</p>

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
            <button className={styles.downloadBtn} onClick={downloadFile}>
              Save File
            </button>
          </>
        )}
      </div>
    </div>
  );
}
