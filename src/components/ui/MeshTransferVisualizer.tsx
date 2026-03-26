"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./MeshTransferVisualizer.module.css";

/* ── Types ── */
interface MeshProps {
  roomData: {
    roomId: string;
    file: { name: string; size: string; chunkCount: number };
    peerId: string;
  };
  connectedPeers: string[];
  chunksReceived: number;
  totalChunks: number;
  isSender: boolean;
  transferSpeed: number; // bytes/sec
  onSave?: () => void;
  onClose?: () => void;
  isComplete?: boolean;
}

interface NodeData {
  id: string;
  x: number;
  y: number;
  isSender: boolean;
  order: number;
  label: string;
}

/* ── Helpers ── */
const truncateId = (id: string) =>
  id.length > 8 ? id.slice(0, 4) + "…" + id.slice(-4) : id;

const formatSpeed = (bps: number): string => {
  if (bps <= 0) return "—";
  const mbps = bps / (1024 * 1024);
  if (mbps >= 1) return mbps.toFixed(1) + " MB/s";
  const kbps = bps / 1024;
  return kbps.toFixed(0) + " KB/s";
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
};

/* ── Layout ── */
const ORBIT_R = 140;
const SENDER_R = 24;
const PEER_R = 14;

function computeLayout(
  localId: string,
  peers: string[],
  isSender: boolean,
  cx: number,
  cy: number
): NodeData[] {
  const nodes: NodeData[] = [];

  // Local user is always in the center
  nodes.push({
    id: localId,
    x: cx,
    y: cy,
    isSender,
    order: 1,
    label: isSender ? "You (Sender)" : "You",
  });

  // Remote peers orbit the center
  const total = peers.length;
  peers.forEach((pid, i) => {
    const angle = (2 * Math.PI * i) / Math.max(total, 1) - Math.PI / 2;
    nodes.push({
      id: pid,
      x: cx + ORBIT_R * Math.cos(angle),
      y: cy + ORBIT_R * Math.sin(angle),
      isSender: !isSender, // if we are sender, peers are receivers and vice versa
      order: i + 2,
      label: truncateId(pid),
    });
  });

  return nodes;
}

/* ── Connection Edge ── */
const ConnectionEdge = memo(function ConnectionEdge({
  x1,
  y1,
  x2,
  y2,
  active,
  speed,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  active: boolean;
  speed: number;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const dashLen = 40;
  const gapLen = 1000; // Large gap ensures only one streak per line
  // Faster speed = faster animation
  const dur = speed > 0 ? Math.max(0.4, 3 - Math.min(speed / (5 * 1024 * 1024), 2.6)) : 2.5;

  return (
    <g>
      {/* Base connection line */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={1}
      />

      {/* Light streak overlay */}
      {active && (
        <motion.line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="url(#streakGrad)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray={`${dashLen} ${gapLen}`}
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -(len + dashLen) }}
          transition={{
            duration: dur,
            repeat: Infinity,
            ease: "linear",
          }}
          style={{ filter: "drop-shadow(0 0 4px rgba(0,229,255,0.6))" }}
        />
      )}
    </g>
  );
});

/* ── Peer Node ── */
const PeerNode = memo(function PeerNode({
  node,
  onHover,
  onLeave,
}: {
  node: NodeData;
  onHover: (n: NodeData, e: React.MouseEvent) => void;
  onLeave: () => void;
}) {
  const radius = node.isSender ? SENDER_R : PEER_R;
  const glowColor = node.isSender ? "#00e5ff" : "#4d8bff";
  const fillColor = node.isSender
    ? "rgba(0,229,255,0.12)"
    : "rgba(77,139,255,0.08)";

  return (
    <motion.g
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0 }}
      transition={{ type: "spring", stiffness: 200, damping: 20 }}
      onMouseEnter={(e) => onHover(node, e as unknown as React.MouseEvent)}
      onMouseLeave={onLeave}
      style={{ cursor: "pointer" }}
    >
      {/* Outer glow pulse */}
      <motion.circle
        cx={node.x}
        cy={node.y}
        r={radius + 8}
        fill="none"
        stroke={glowColor}
        strokeWidth={1}
        initial={{ opacity: 0.5, r: radius + 4 }}
        animate={{
          opacity: [0.4, 0.1, 0.4],
          r: [radius + 4, radius + 12, radius + 4],
        }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Node body */}
      <circle
        cx={node.x}
        cy={node.y}
        r={radius}
        fill={fillColor}
        stroke={glowColor}
        strokeWidth={1.5}
        style={{ filter: `drop-shadow(0 0 8px ${glowColor}40)` }}
      />

      {/* Inner icon dot */}
      <circle
        cx={node.x}
        cy={node.y}
        r={radius * 0.3}
        fill={glowColor}
        opacity={0.8}
      />

      {/* Label */}
      <text
        x={node.x}
        y={node.y + radius + 16}
        className={`${styles.peerLabel} ${node.isSender ? styles.senderLabel : ""}`}
      >
        {node.label}
      </text>
    </motion.g>
  );
});

/* ── Progress Ring (around center node) ── */
const ProgressRing = memo(function ProgressRing({
  progress,
  cx,
  cy,
}: {
  progress: number;
  cx: number;
  cy: number;
}) {
  const r = SENDER_R + 20;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - progress);

  return (
    <motion.circle
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      stroke="url(#progressGrad)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeDasharray={circumference}
      initial={{ strokeDashoffset: circumference }}
      animate={{ strokeDashoffset: offset }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      transform={`rotate(-90 ${cx} ${cy})`}
      opacity={0.7}
      style={{ filter: "drop-shadow(0 0 12px rgba(0,229,255,0.4))" }}
    />
  );
});

/* ── Main Component ── */
export default function MeshTransferVisualizer({
  roomData,
  connectedPeers,
  chunksReceived,
  totalChunks,
  isSender,
  transferSpeed,
  onSave,
  onClose,
  isComplete,
}: MeshProps) {
  const [hovered, setHovered] = useState<NodeData | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [windowSize, setWindowSize] = useState({ w: 1000, h: 800 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    const handleResize = () => setWindowSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const CX = windowSize.w / 2;
  const CY = windowSize.h / 2;

  const nodes = useMemo(
    () => computeLayout(roomData.peerId, connectedPeers, isSender, CX, CY),
    [roomData.peerId, connectedPeers, isSender, CX, CY]
  );

  const progress =
    totalChunks > 0 ? Math.min(chunksReceived / totalChunks, 1) : 0;
  const isActive = connectedPeers.length > 0 && progress < 1;

  const handleHover = useCallback(
    (node: NodeData, e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setTooltipPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      setHovered(node);
    },
    []
  );

  const handleLeave = useCallback(() => setHovered(null), []);

  // Update tooltip position on mouse move when hovering
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!hovered || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setTooltipPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    },
    [hovered]
  );

  // Generate peer-to-peer connections (full mesh)
  const connections = useMemo(() => {
    const conns: { from: NodeData; to: NodeData; key: string }[] = [];
    if (nodes.length < 2) return conns;

    const center = nodes[0];
    const remotes = nodes.slice(1);

    // Center to each remote
    remotes.forEach((remote) => {
      conns.push({
        from: center,
        to: remote,
        key: `${center.id}-${remote.id}`,
      });
    });

    // Remote-to-remote (if 3+ nodes)
    for (let i = 0; i < remotes.length; i++) {
      for (let j = i + 1; j < remotes.length; j++) {
        conns.push({
          from: remotes[i],
          to: remotes[j],
          key: `${remotes[i].id}-${remotes[j].id}`,
        });
      }
    }

    return conns;
  }, [nodes]);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onMouseMove={handleMouseMove}
    >
      {/* Grid background */}
      <div className={styles.gridBg} />

      {/* SVG Canvas */}
      <svg
        className={styles.svgCanvas}
        width={windowSize.w}
        height={windowSize.h}
      >
        {/* Gradient defs */}
        <defs>
          <linearGradient id="streakGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(0,229,255,0)" />
            <stop offset="40%" stopColor="rgba(0,229,255,0.9)" />
            <stop offset="60%" stopColor="rgba(255,255,255,1)" />
            <stop offset="100%" stopColor="rgba(0,229,255,0)" />
          </linearGradient>

          <linearGradient
            id="progressGrad"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="#00e5ff" />
            <stop offset="100%" stopColor="#4d8bff" />
          </linearGradient>

          {/* Glow filter for nodes */}
          <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Connection lines */}
        {connections.map((conn) => (
          <ConnectionEdge
            key={conn.key}
            x1={conn.from.x}
            y1={conn.from.y}
            x2={conn.to.x}
            y2={conn.to.y}
            active={isActive || progress >= 1}
            speed={transferSpeed}
          />
        ))}

        {/* Progress ring around center */}
        <ProgressRing progress={progress} cx={CX} cy={CY} />

        {/* Nodes */}
        <AnimatePresence>
          {nodes.map((node) => (
            <PeerNode
              key={node.id}
              node={node}
              onHover={handleHover}
              onLeave={handleLeave}
            />
          ))}
        </AnimatePresence>
      </svg>

      {/* Tooltip */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            className={styles.tooltip}
            style={{ left: tooltipPos.x, top: tooltipPos.y }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipKey}>Type</span>
              <span
                className={`${styles.tooltipVal} ${
                  hovered.isSender
                    ? styles.tooltipSender
                    : styles.tooltipReceiver
                }`}
              >
                {hovered.isSender ? "Sender" : "Receiver"}
              </span>
            </div>
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipKey}>Peer</span>
              <span className={styles.tooltipVal}>
                {truncateId(hovered.id)}
              </span>
            </div>
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipKey}>Order</span>
              <span className={styles.tooltipVal}>#{hovered.order}</span>
            </div>
            <div className={styles.tooltipRow}>
              <span className={styles.tooltipKey}>Speed</span>
              <span className={styles.tooltipVal}>
                {formatSpeed(transferSpeed)}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Left Overlay (File Details & Actions) */}
      <div className={styles.topOverlay} style={{ pointerEvents: "auto" }}>
        <h2 className={styles.overlayTitle}>{roomData.file.name}</h2>
        <div className={styles.overlayMeta} style={{ marginBottom: "12px" }}>
          {formatSize(parseInt(roomData.file.size))} &middot; {roomData.file.chunkCount} chunks
        </div>
        
        <div style={{ display: "flex", gap: "8px" }}>
          {isComplete && onSave && !isSender && (
            <button className={styles.saveSubtle} onClick={onSave}>Save File</button>
          )}
          {onClose && (
            <button className={styles.saveSubtle} onClick={onClose}>Close</button>
          )}
        </div>
      </div>

      {/* Center Save/Close Button (Removed) */}

      {/* Bottom status bar */}
      <div className={styles.statusBar}>
        <div className={styles.statusLeft}>
          <span
            className={`${styles.statusDot} ${
              isActive ? styles.statusDotActive : styles.statusDotIdle
            }`}
          />
          {progress >= 1
            ? "Transfer complete — Seeding"
            : isActive
            ? "Transferring…"
            : connectedPeers.length === 0
            ? "Awaiting peers…"
            : "Idle"}
        </div>
        <div className={styles.statusRight}>
          <div className={styles.statusMetric}>
            <span className={styles.statusMetricVal}>
              {connectedPeers.length}
            </span>{" "}
            peers
          </div>
          <div className={styles.statusMetric}>
            <span className={styles.statusMetricVal}>
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className={styles.statusMetric}>
            <span className={styles.statusMetricVal}>
              {formatSpeed(transferSpeed)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
