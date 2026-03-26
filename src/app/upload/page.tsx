"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChunker } from "@/lib/useChunker";
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
  const inputRef = useRef<HTMLInputElement>(null);

  // Wait for redirect to happen natively
  const [redirecting, setRedirecting] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      setSelectedFile(file);
      setError(null);
      setRoomInfo(null);
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
          setRedirecting(true);
          router.push(`/room/${data.roomId}`);
        } else {
          setError(data.error || "Failed to create room");
          setUploading(false);
        }
      })
      .catch((err) => {
        setError(err.message);
        setUploading(false);
      });
  }

  const router = useRouter();

  // Removed local mesh peer logic — Sender seeds from the room page itself now.

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

  // Use Next.js Router for programmatic navigation

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
              : redirecting
              ? "Redirecting to room..."
              : progress === 100
              ? "Connecting..."
              : ""}
          </p>
        </div>
      )}

      {/* Hidden Room Card (moved to /room/[id]) */}

      {(error || chunkerError) && <div className={styles.error}>{error || chunkerError}</div>}
    </div>
  );
}
