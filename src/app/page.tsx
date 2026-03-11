"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { runGarbageCollection, getHistory, clearHistory, type TransferHistoryRecord } from "@/lib/indexedDB";
import styles from "./home.module.css";

export default function HomePage() {
  const [roomInput, setRoomInput] = useState("");
  const [history, setHistory] = useState<TransferHistoryRecord[]>([]);
  const router = useRouter();

  useEffect(() => {
    // Run garbage collection for abandoned Dexie downloads on app load
    runGarbageCollection().catch(console.error);
    // Load transfer history
    getHistory().then(setHistory).catch(console.error);
  }, []);

  const handleJoin = () => {
    const id = roomInput.trim();
    if (id) {
      router.push("/room/" + id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleJoin();
  };

  const handleClearHistory = async () => {
    await clearHistory();
    setHistory([]);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const shortPeer = (p: string) => p.slice(0, 8) + "...";

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <p className={styles.brand}>LuminaMesh</p>
        <h1 className={styles.title}>Share files directly between browsers</h1>
        <p className={styles.subtitle}>
          No uploads to a server. No size limits. Files travel
          <span className={styles.highlight}> peer-to-peer </span>
          through an encrypted mesh network, and vanish when you close the tab.
        </p>

        <div className={styles.actions}>
          <Link href="/upload" className={styles.uploadBtn}>
            Upload a File
          </Link>

          <div className={styles.divider}>
            <span className={styles.dividerLine} />
            <span>or join a room</span>
            <span className={styles.dividerLine} />
          </div>

          <div className={styles.joinRow}>
            <input
              className={styles.joinInput}
              placeholder="Paste a Room ID"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className={styles.joinBtn} onClick={handleJoin}>
              Join
            </button>
          </div>
        </div>

        <div className={styles.features}>
          <div className={styles.feature}>
            <p className={styles.featureTitle}>Zero Persistence</p>
            <p className={styles.featureDesc}>
              Files exist only in browser memory. Nothing is stored on any server.
            </p>
          </div>
          <div className={styles.feature}>
            <p className={styles.featureTitle}>End-to-End Encrypted</p>
            <p className={styles.featureDesc}>
              All transfers use WebRTC with DTLS/SRTP encryption by default.
            </p>
          </div>
          <div className={styles.feature}>
            <p className={styles.featureTitle}>Mesh Network</p>
            <p className={styles.featureDesc}>
              Multiple peers share chunks simultaneously for faster downloads.
            </p>
          </div>
        </div>

        {/* Transfer History Panel */}
        <div className={styles.historyPanel}>
          <div className={styles.historyHeader}>
            <span className={styles.historyTitle}>Transfer History</span>
            {history.length > 0 && (
              <button className={styles.clearBtn} onClick={handleClearHistory}>
                Clear
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <p className={styles.historyEmpty}>No transfers yet.</p>
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
                    {entry.peers.length === 0 ? (
                      <span className={styles.historyPeerItem}>no peers recorded</span>
                    ) : (
                      entry.peers.map((p) => (
                        <span key={p} className={styles.historyPeerItem} title={p}>
                          {shortPeer(p)}
                        </span>
                      ))
                    )}
                  </div>
                  <span className={styles.historyTime}>{formatDate(entry.timestamp)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className={styles.footer}>Built with Next.js, WebRTC, and Socket.io</p>
    </div>
  );
}
