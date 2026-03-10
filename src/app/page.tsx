"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { runGarbageCollection } from "@/lib/indexedDB";
import styles from "./home.module.css";

export default function HomePage() {
  const [roomInput, setRoomInput] = useState("");
  const router = useRouter();

  useEffect(() => {
    // Run garbage collection for abandoned Dexie downloads on app load
    runGarbageCollection().catch(console.error);
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
      </div>

      <p className={styles.footer}>Built with Next.js, WebRTC, and Socket.io</p>
    </div>
  );
}
