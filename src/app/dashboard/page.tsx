"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useChunker } from "@/lib/useChunker";
import { PeerManager } from "@/lib/peerManager";
import { SocketClient } from "@/lib/socketClient";
import { ChunkScheduler } from "@/lib/chunkScheduler";
import styles from "./dashboard.module.css";

type RoomInfo = { roomId: string; peerId: string; token: string };
type HistoryEntry = {
  id: string;
  direction: string;
  fileName: string;
  fileSize: string;
  roomId: string;
  peers: string[];
  createdAt: string;
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();

  // Upload state
  const { processFile, manifest, chunks, progress, isProcessing, error: chunkerError } = useChunker();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [seeding, setSeeding] = useState(false);

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const peerManagerRef = useRef<PeerManager | null>(null);
  const socketClientRef = useRef<SocketClient | null>(null);
  const schedulerRef = useRef<ChunkScheduler | null>(null);
  const meshStarted = useRef(false);
  const historyRoomRef = useRef<string | null>(null);

  // Load history on mount
  useEffect(() => {
    fetch("/api/history")
      .then((r) => r.json())
      .then((d) => setHistory(d.history || []))
      .catch(console.error);
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      setSelectedFile(file);
      setUploadError(null);
      setRoomInfo(null);
      setSeeding(false);
      setConnectedPeers([]);
      meshStarted.current = false;
      historyRoomRef.current = null;
      processFile(file);
    },
    [processFile]
  );

  // Upload manifest to API when chunking completes
  const prevManifestRef = useRef<string | null>(null);
  if (manifest && !roomInfo && !uploading && prevManifestRef.current !== manifest.masterHash) {
    prevManifestRef.current = manifest.masterHash;
    setUploading(true);
    fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: manifest.fileName,
        size: manifest.fileSize,
        masterHash: manifest.masterHash,
        chunkCount: manifest.totalChunks,
        mimeType: manifest.mimeType,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setRoomInfo({ roomId: data.roomId, peerId: data.peerId, token: data.token });
        else setUploadError(data.error || "Failed to create room");
        setUploading(false);
      })
      .catch((err) => { setUploadError(err.message); setUploading(false); });
  }

  // Start seeding mesh when roomInfo + chunks ready
  useEffect(() => {
    if (!roomInfo || !manifest || !chunks || chunks.length === 0 || meshStarted.current) return;
    meshStarted.current = true;

    const peerManager = new PeerManager({
      onPeerConnected: (peerId) => setConnectedPeers((p) => [...p, peerId]),
      onPeerDisconnected: (peerId) => {
        setConnectedPeers((p) => p.filter((id) => id !== peerId));
        schedulerRef.current?.removePeer(peerId);
      },
      onSignal: (peerId, signalData) => socketClientRef.current?.sendSignal(peerId, signalData),
      onData: (peerId, message) => schedulerRef.current?.handleMessage(peerId, message),
    });

    const scheduler = new ChunkScheduler(
      peerManager,
      { onProgress: () => {}, onComplete: () => {}, onChunkVerified: () => {}, onChunkFailed: () => {} },
      manifest.totalChunks, manifest.chunkHashes, manifest.masterHash, new Set()
    );

    scheduler.seedAll(chunks);
    scheduler.start();
    scheduler.startPushing();

    const socketClient = new SocketClient(peerManager, {
      onConnected: async () => {
        setSeeding(true);
        setUploadError(null);
        // Record sent history
        if (historyRoomRef.current !== roomInfo.roomId) {
          historyRoomRef.current = roomInfo.roomId;
          const res = await fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              direction: "sent",
              fileName: manifest.fileName,
              fileSize: manifest.fileSize,
              roomId: roomInfo.roomId,
              peers: peerManager.getConnectedPeers(),
            }),
          });
          if (res.ok) {
            const { id } = await res.json();
            setHistory((prev) => [{ id, direction: "sent", fileName: manifest.fileName, fileSize: String(manifest.fileSize), roomId: roomInfo.roomId, peers: [], createdAt: new Date().toISOString() }, ...prev]);
          }
        }
      },
      onDisconnected: () => { setSeeding(false); },
      onError: (msg) => setUploadError("Socket error: " + msg),
      onPeerJoined: () => {},
      onPeerLeft: () => {},
    }, roomInfo.peerId);

    socketClient.connect(window.location.origin, roomInfo.token);
    peerManagerRef.current = peerManager;
    socketClientRef.current = socketClient;
    schedulerRef.current = scheduler;

    return () => { meshStarted.current = false; scheduler.stop(); socketClient.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomInfo, manifest, chunks]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const formatSize = (bytes: number | string) => {
    const n = typeof bytes === "string" ? parseInt(bytes) : bytes;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  };

  const roomUrl = roomInfo && typeof window !== "undefined"
    ? window.location.origin + "/room/" + roomInfo.roomId : "";

  const copyLink = () => {
    if (roomUrl) { navigator.clipboard.writeText(roomUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const avatarInitial = session?.user?.name?.[0]?.toUpperCase() || session?.user?.email?.[0]?.toUpperCase() || "?";

  return (
    <div className={styles.layout}>
      {/* Navbar */}
      <nav className={styles.nav}>
        <span className={styles.navBrand}>LuminaMesh</span>
        <div className={styles.navRight}>
          <button className={styles.navProfile} onClick={() => router.push("/profile")}>
            <span className={styles.avatar}>{avatarInitial}</span>
            <span className={styles.navName}>{session?.user?.name || session?.user?.email}</span>
          </button>
          <button className={styles.navLogout} onClick={() => signOut({ callbackUrl: "/" })}>
            Sign out
          </button>
        </div>
      </nav>

      <div className={styles.main}>
        {/* Upload Panel */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Share a File</h2>

          {!selectedFile && (
            <div
              className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ""}`}
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onClick={() => inputRef.current?.click()}
            >
              <div className={styles.dropIcon}>↑</div>
              <p className={styles.dropText}>Drag and drop a file here</p>
              <p className={styles.dropHint}>or click to browse</p>
              <input ref={inputRef} type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} style={{ display: "none" }} />
            </div>
          )}

          {selectedFile && (
            <div className={styles.progressSection}>
              <p className={styles.fileName}>{selectedFile.name}</p>
              <p className={styles.fileSize}>{formatSize(selectedFile.size)}</p>
              <div className={styles.progressBar}><div className={styles.progressFill} style={{ width: progress + "%" }} /></div>
              <p className={styles.progressText}>
                {isProcessing ? "Hashing chunks... " + progress + "%" : uploading ? "Creating room..." : seeding ? "Seeding to " + connectedPeers.length + " peer(s)" : progress === 100 ? "Connecting..." : ""}
              </p>
            </div>
          )}

          {roomInfo && (
            <div className={styles.roomCard}>
              <p className={styles.roomLabel}>Share this link</p>
              <div className={styles.roomLink}>
                <div className={styles.roomUrl}>{roomUrl}</div>
                <button className={styles.copyBtn} onClick={copyLink}>{copied ? "Copied" : "Copy"}</button>
              </div>
              <div className={`${styles.seedingBadge} ${seeding ? styles.seedingActive : ""}`}>
                <span className={styles.seedingDot} />
                {seeding ? `Seeding to ${connectedPeers.length} peer(s)` : "Connecting..."}
              </div>
              <button className={styles.shareAnother} onClick={() => { setSelectedFile(null); setRoomInfo(null); setSeeding(false); prevManifestRef.current = null; }}>
                Share another file
              </button>
            </div>
          )}

          {(uploadError || chunkerError) && <div className={styles.error}>{uploadError || chunkerError}</div>}
        </section>

        {/* History Panel */}
        <section className={styles.panel}>
          <div className={styles.historyHeader}>
            <h2 className={styles.panelTitle}>Transfer History</h2>
          </div>
          {history.length === 0 ? (
            <p className={styles.historyEmpty}>No transfers yet. Share your first file above.</p>
          ) : (
            <ul className={styles.historyList}>
              {history.map((entry) => (
                <li key={entry.id} className={styles.historyRow}>
                  <span className={entry.direction === "sent" ? styles.badgeSent : styles.badgeReceived}>
                    {entry.direction === "sent" ? "Sent" : "Received"}
                  </span>
                  <div className={styles.historyInfo}>
                    <span className={styles.historyFileName}>{entry.fileName}</span>
                    <span className={styles.historyMeta}>{formatSize(entry.fileSize)}</span>
                  </div>
                  <div className={styles.historyPeers}>
                    {entry.peers.length === 0
                      ? <span className={styles.peerPill}>no peers</span>
                      : entry.peers.map((p) => <span key={p} className={styles.peerPill} title={p}>{p.slice(0, 8)}...</span>)
                    }
                  </div>
                  <span className={styles.historyTime}>
                    {new Date(entry.createdAt).toLocaleDateString()} {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
