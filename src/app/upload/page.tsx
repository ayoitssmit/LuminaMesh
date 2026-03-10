"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useChunker } from "@/lib/useChunker";
import { PeerManager } from "@/lib/peerManager";
import { SocketClient } from "@/lib/socketClient";
import { ChunkScheduler } from "@/lib/chunkScheduler";
import styles from "./upload.module.css";

type RoomInfo = {
  roomId: string;
  peerId: string;
  token: string;
};

export default function UploadPage() {
  const { processFile, manifest, chunks, progress, isProcessing, error: chunkerError } = useChunker();
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [connectedPeers, setConnectedPeers] = useState<string[]>([]);
  const [seeding, setSeeding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mesh engine refs (persist across renders)
  const peerManagerRef = useRef<PeerManager | null>(null);
  const socketClientRef = useRef<SocketClient | null>(null);
  const schedulerRef = useRef<ChunkScheduler | null>(null);
  const meshStarted = useRef(false);

  const handleFile = useCallback(
    (file: File) => {
      setSelectedFile(file);
      setError(null);
      setRoomInfo(null);
      setSeeding(false);
      setConnectedPeers([]);
      processFile(file);
    },
    [processFile]
  );

  // When chunking completes, upload manifest to API
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
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setRoomInfo({ roomId: data.roomId, peerId: data.peerId, token: data.token });
        } else {
          setError(data.error || "Failed to create room");
        }
        setUploading(false);
      })
      .catch((err) => {
        setError(err.message);
        setUploading(false);
      });
  }

  // When we have roomInfo + chunks, connect to Socket and start seeding
  useEffect(() => {
    if (!roomInfo || !manifest || !chunks || chunks.length === 0 || meshStarted.current) return;
    meshStarted.current = true;

    const peerManager = new PeerManager({
      onPeerConnected: (peerId) => {
        setConnectedPeers((prev) => [...prev, peerId]);
        // Send our bitfield to the new peer
        if (schedulerRef.current) {
          peerManager.sendBitfield(peerId, Array.from({ length: manifest.totalChunks }, (_, i) => i));
        }
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
        onProgress: () => {},
        onComplete: () => {},
        onChunkVerified: () => {},
        onChunkFailed: () => {},
      },
      manifest.totalChunks,
      manifest.chunkHashes,
      manifest.masterHash,
      new Set()
    );

    // We are the seeder — we have ALL chunks
    scheduler.seedAll(chunks);
    scheduler.start();
    scheduler.startPushing(); // proactively push unique chunks to each peer

    const socketClient = new SocketClient(peerManager, {
      onConnected: () => {
        setSeeding(true);
        setError(null);
      },
      onDisconnected: () => {
        setSeeding(false);
        setError(null);
      },
      onError: (msg) => {
        setError("Socket error: " + msg);
      },
      onPeerJoined: () => {},
      onPeerLeft: () => {},
    }, roomInfo.peerId);

    socketClient.connect(window.location.origin, roomInfo.token);

    peerManagerRef.current = peerManager;
    socketClientRef.current = socketClient;
    schedulerRef.current = scheduler;

    return () => {
      meshStarted.current = false;
      scheduler.stop();
      socketClient.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomInfo, manifest, chunks]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = () => setDragActive(false);
  const onClickUpload = () => inputRef.current?.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
    return (bytes / 1073741824).toFixed(2) + " GB";
  };

  const roomUrl =
    roomInfo && typeof window !== "undefined"
      ? window.location.origin + "/room/" + roomInfo.roomId
      : "";

  const copyLink = () => {
    if (roomUrl) {
      navigator.clipboard.writeText(roomUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>LuminaMesh</h1>
      <p className={styles.subtitle}>Drop a file to share it peer-to-peer</p>

      {!selectedFile && (
        <div
          className={`${styles.dropZone} ${dragActive ? styles.dropZoneActive : ""}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={onClickUpload}
        >
          <div className={styles.dropIcon}>&#8593;</div>
          <p className={styles.dropText}>Drag and drop a file here</p>
          <p className={styles.dropHint}>or click to browse</p>
          <input ref={inputRef} type="file" onChange={onFileChange} style={{ display: "none" }} />
        </div>
      )}

      {selectedFile && (
        <div className={styles.progressSection}>
          <p className={styles.fileName}>{selectedFile.name}</p>
          <p className={styles.fileSize}>{formatSize(selectedFile.size)}</p>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: progress + "%" }} />
          </div>
          <p className={styles.progressText}>
            {isProcessing
              ? "Hashing chunks... " + progress + "%"
              : uploading
              ? "Creating room..."
              : seeding
              ? "Seeding to " + connectedPeers.length + " peer(s)"
              : progress === 100
              ? "Connecting..."
              : ""}
          </p>
        </div>
      )}

      {roomInfo && (
        <div className={styles.roomCard}>
          <p className={styles.roomLabel}>Share this link</p>
          <div className={styles.roomLink}>
            <div className={styles.roomUrl}>{roomUrl}</div>
            <button className={styles.copyBtn} onClick={copyLink}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{connectedPeers.length}</span>
              <span className={styles.statLabel}>Peers</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{manifest?.totalChunks || 0}</span>
              <span className={styles.statLabel}>Chunks</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{selectedFile ? formatSize(selectedFile.size) : "0"}</span>
              <span className={styles.statLabel}>File Size</span>
            </div>
          </div>

          <div className={styles.seedingBadge}>
            <span className={styles.seedingDot} />
            {seeding ? "Seeding" : "Connecting..."}
          </div>
        </div>
      )}

      {(error || chunkerError) && <div className={styles.error}>{error || chunkerError}</div>}
    </div>
  );
}
