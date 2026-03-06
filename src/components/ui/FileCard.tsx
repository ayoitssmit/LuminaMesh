"use client";

import styles from "./FileCard.module.css";

interface FileCardProps {
  name: string;
  size: string | number;
  mimeType?: string;
  chunkCount?: number;
  roomId?: string;
}

export default function FileCard({ name, size, mimeType, chunkCount, roomId }: FileCardProps) {
  const formatSize = (bytes: number | string) => {
    const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  };

  const ext = name.includes(".") ? name.split(".").pop()?.toUpperCase() : "FILE";

  return (
    <div className={styles.card}>
      <div className={styles.icon}>{ext}</div>
      <div className={styles.info}>
        <p className={styles.name}>{name}</p>
        <p className={styles.meta}>
          {formatSize(size)}
          {mimeType && <span> &middot; {mimeType}</span>}
          {chunkCount !== undefined && <span> &middot; {chunkCount} chunks</span>}
        </p>
        {roomId && <p className={styles.roomId}>Room: {roomId}</p>}
      </div>
    </div>
  );
}
