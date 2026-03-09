import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { Redis } from "@upstash/redis";
import { PrismaClient } from "@prisma/client";

const dev = process.env.NODE_ENV !== "production";
const prisma = new PrismaClient();
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(handler);

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || "",
    token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  });

  const ROOM_TTL_SECONDS = 60 * 60 * 24;

  // Map peerId -> socketId for targeted message routing
  const peerSockets = new Map();

  // Track which rooms have been registered in Redis (avoid duplicate calls)
  const registeredPeers = new Set();

  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "*",
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, nextAuth) => {
    const token = socket.handshake.auth.token;
    if (!token) return nextAuth(new Error("No token provided"));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.data.roomId = decoded.roomId;
      socket.data.peerId = decoded.peerId;
      nextAuth();
    } catch (err) {
      nextAuth(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const roomId = socket.data.roomId;
    const peerId = socket.data.peerId;
    const peerKey = `${roomId}:${peerId}`;

    peerSockets.set(peerId, socket.id);

    socket.on("join-room", async () => {
      socket.join(roomId);

      // Full-Mesh: Send the NEW peer a list of everyone already in the room
      // so it can initiate outbound WebRTC handshakes to all of them.
      const roomSockets = await io.in(roomId).fetchSockets();
      const existingPeerIds = roomSockets
        .filter((s) => s.data.peerId !== peerId)
        .map((s) => s.data.peerId);

      if (existingPeerIds.length > 0) {
        socket.emit("existing-peers", existingPeerIds);
        console.log(`[mesh] Sent ${existingPeerIds.length} existing peers to ${peerId}`);
      }

      // Only register in Redis once per peer per room
      if (!registeredPeers.has(peerKey)) {
        registeredPeers.add(peerKey);
        const key = `room:peers:${roomId}`;
        await redis.sadd(key, peerId);
        await redis.expire(key, ROOM_TTL_SECONDS);
        console.log(`[+] ${peerId} joined ${roomId}`);
      }

      // Tell existing peers about the new joiner (they will also initiate)
      socket.to(roomId).emit("peer-joined", peerId);
    });

    socket.on("offer", (data) => {
      const targetSocketId = peerSockets.get(data.to);
      if (targetSocketId) {
        io.to(targetSocketId).emit("offer", { from: peerId, to: data.to, offer: data.offer });
      }
    });

    socket.on("answer", (data) => {
      const targetSocketId = peerSockets.get(data.to);
      if (targetSocketId) {
        io.to(targetSocketId).emit("answer", { from: peerId, to: data.to, answer: data.answer });
      }
    });

    socket.on("ice-candidate", (data) => {
      const targetSocketId = peerSockets.get(data.to);
      if (targetSocketId) {
        io.to(targetSocketId).emit("ice-candidate", { from: peerId, to: data.to, candidate: data.candidate });
      }
    });

    socket.on("disconnect", async () => {
      // Only tear down if THIS socket is still the active one for the peer.
      // If a newer socket already replaced this one (React Strict Mode reconnect),
      // do NOT broadcast peer-disconnected — the peer is still alive!
      if (peerSockets.get(peerId) === socket.id) {
        peerSockets.delete(peerId);

        if (registeredPeers.has(peerKey)) {
          registeredPeers.delete(peerKey);
          const key = `room:peers:${roomId}`;
          await redis.srem(key, peerId);
          console.log(`[-] ${peerId} left ${roomId}`);

          // Room Expiration Logic: Check if room is completely empty
          const remainingPeers = await redis.scard(key);
          if (remainingPeers === 0) {
            console.log(`[!] Room ${roomId} is empty. Scheduling zero-persistence cleanup in 1 minute...`);
            
            setTimeout(async () => {
              // Double check if peers re-joined during the timeout
              const peersNow = await redis.scard(key);
              if (peersNow !== 0) {
                console.log(`[!] Room ${roomId} cleanup aborted: peers re-joined.`);
                return;
              }

              // 1. Delete tracking key from Redis
              await redis.del(key);
              
              // 2. Delete metadata from PostgreSQL to prevent future joins
              try {
                await prisma.fileMetadata.delete({
                  where: { roomId }
                });
                console.log(`[OK] Room ${roomId} metadata completely wiped from DB.`);
              } catch (dbErr) {
                console.warn(`[WARN] Could not delete room ${roomId} from DB:`, dbErr.message);
              }
            }, 60000); // 1 minute grace period for reconnects/reloads
          }
        }

        // Only notify the room if this was a REAL disconnect
        socket.to(roomId).emit("peer-disconnected", peerId);
      }
    });
  });

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> Signaling Server + Redis attached.`);
    });
});
