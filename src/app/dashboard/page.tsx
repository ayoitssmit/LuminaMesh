"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useChunker } from "@/lib/useChunker";
import { PeerManager } from "@/lib/peerManager";
import { SocketClient } from "@/lib/socketClient";
import { saveChunkToCache } from "@/lib/indexedDB";
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
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Receive state
  const [receiveInput, setReceiveInput] = useState("");

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const historyRoomRef = useRef<string | null>(null);

  // Load history on mount
  useEffect(() => {
    fetch("/api/history")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch history");
        return r.json();
      })
      .then((d) => setHistory(d.history || []))
      .catch((err) => {
        console.error("Dashboard history fetch error:", err);
        setHistory([]);
      });
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      setSelectedFile(file);
      setUploadError(null);
      historyRoomRef.current = null;
      processFile(file);
    },
    [processFile]
  );

  // Upload manifest to API when chunking completes
  const prevManifestRef = useRef<string | null>(null);
  if (manifest && !uploading && prevManifestRef.current !== manifest.masterHash) {
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
      .then(async (data) => {
        if (data.success) {
          try {
            // Save chunks to IndexedDB so the room page can load them into RAM
            await Promise.all(
              chunks.map((chunk, index) => saveChunkToCache(manifest.masterHash, index, chunk))
            );
            router.push(`/room/${data.roomId}`);
          } catch (err) {
            console.error("Failed to save chunks before redirect:", err);
            setUploadError("Failed to cache file for seeding.");
          }
        }
        else setUploadError(data.error || "Failed to create room");
        setUploading(false);
      })
      .catch((err) => { setUploadError(err.message); setUploading(false); });
  }

  // No more background mesh seeder on the dashboard. 
  // All mesh logic has been moved to room/[id]/page.tsx so the sender can see the visualizer.

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

  const copyLink = () => {
    // roomUrl removed, handled in Room page
  };

  const handleReceive = (e: React.FormEvent) => {
    e.preventDefault();
    if (!receiveInput.trim()) return;

    let roomId = receiveInput.trim();
    // Extract ID if a full URL was pasted
    try {
      if (roomId.startsWith("http")) {
        const url = new URL(roomId);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0] === "room" && parts[1]) {
           roomId = parts[1];
        }
      }
    } catch(err) {
      // Not a valid URL, treat as just the room ID
    }

    router.push(`/room/${roomId}`);
  };

  const avatarInitial = session?.user?.name?.[0]?.toUpperCase() || session?.user?.email?.[0]?.toUpperCase() || "?";

  const deleteHistory = async (id?: string) => {
    if (id && !confirm("Delete this entry?")) return;
    if (!id && !confirm("Clear all transfer history?")) return;

    try {
      const url = id ? `/api/history?id=${id}` : "/api/history";
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) {
        if (id) setHistory((prev) => prev.filter((h) => h.id !== id));
        else setHistory([]);
      }
    } catch (err) {
      console.error("Failed to delete history:", err);
    }
  };

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
                {isProcessing ? "Hashing chunks... " + progress + "%" : uploading ? "Creating room..." : progress === 100 ? "Moving to room..." : ""}
              </p>
            </div>
          )}

          {/* Room info removed from dashboard, moved to room/[id] page */}

          {(uploadError || chunkerError) && <div className={styles.error}>{uploadError || chunkerError}</div>}
        </section>

        {/* Receive Panel */}
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>Receive a File</h2>
          <form className={styles.receiveForm} onSubmit={handleReceive}>
            <input
              type="text"
              placeholder="Paste room link or ID here..."
              className={styles.receiveInput}
              value={receiveInput}
              onChange={(e) => setReceiveInput(e.target.value)}
            />
            <button type="submit" className={styles.receiveBtn} disabled={!receiveInput.trim()}>
              Join Room
            </button>
          </form>
          <p className={styles.receiveHint}>
            Ask the sender to share their room link. Files will stream directly to your device.
          </p>
        </section>

        {/* History Panel */}
        <section className={`${styles.panel} ${styles.historyPanel}`}>
          <div className={styles.historyHeader}>
            <h2 className={styles.panelTitle}>Transfer History</h2>
            {history.length > 0 && (
              <button className={styles.clearAllBtn} onClick={() => deleteHistory()}>
                Clear All
              </button>
            )}
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
                  <button className={styles.deleteBtn} onClick={() => deleteHistory(entry.id)} title="Delete entry">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
