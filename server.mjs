import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { Redis } from "@upstash/redis";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(handler);

  // Initialize Upstash Redis here (Next.js has loaded .env.local by this point)
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL || "",
    token: process.env.UPSTASH_REDIS_REST_TOKEN || "",
  });

  const ROOM_TTL_SECONDS = 60 * 60 * 24;

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

  io.on("connection", async (socket) => {
    const roomId = socket.data.roomId;
    const peerId = socket.data.peerId;

    console.log(`[Socket] Peer ${peerId} connected to Room ${roomId}`);

    socket.on("join-room", async () => {
      socket.join(roomId);
      
      // Add peer to Redis active Swarm
      const key = `room:peers:${roomId}`;
      await redis.sadd(key, peerId);
      await redis.expire(key, ROOM_TTL_SECONDS);

      // Notify others
      socket.to(roomId).emit("peer-joined", peerId);
    });

    socket.on("offer", (data) => {
      io.to(roomId).emit("offer", { from: peerId, to: data.to, offer: data.offer });
    });

    socket.on("answer", (data) => {
      io.to(roomId).emit("answer", { from: peerId, to: data.to, answer: data.answer });
    });

    socket.on("ice-candidate", (data) => {
      io.to(roomId).emit("ice-candidate", { from: peerId, to: data.to, candidate: data.candidate });
    });

    socket.on("disconnect", async () => {
      console.log(`[Socket] Peer ${peerId} disconnected from Room ${roomId}`);
      
      // Remove peer from Redis Swarm
      const key = `room:peers:${roomId}`;
      await redis.srem(key, peerId);
      
      socket.to(roomId).emit("peer-disconnected", peerId);
    });
  });

  httpServer
    .once("error", (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> Websocket Signaling Server + Redis attached.`);
    });
});
