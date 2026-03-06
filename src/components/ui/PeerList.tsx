"use client";

import styles from "./PeerList.module.css";

interface PeerListProps {
  peers: string[];
  myPeerId?: string;
}

export default function PeerList({ peers, myPeerId }: PeerListProps) {
  if (peers.length === 0) {
    return (
      <div className={styles.wrapper}>
        <p className={styles.empty}>No peers connected</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.heading}>
        Active Peers <span className={styles.count}>{peers.length}</span>
      </p>
      <ul className={styles.list}>
        {peers.map((pid) => (
          <li key={pid} className={styles.peer}>
            <span className={styles.dot} />
            <span className={styles.id}>{pid}</span>
            {pid === myPeerId && <span className={styles.youBadge}>you</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
