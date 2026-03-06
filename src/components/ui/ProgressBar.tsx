"use client";

import styles from "./ProgressBar.module.css";

interface ProgressBarProps {
  value: number; // 0-100
  label?: string;
}

export default function ProgressBar({ value, label }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div className={styles.wrapper}>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: clamped + "%" }} />
      </div>
      {label !== undefined && (
        <div className={styles.row}>
          <span className={styles.label}>{label}</span>
          <span className={styles.pct}>{clamped}%</span>
        </div>
      )}
    </div>
  );
}
