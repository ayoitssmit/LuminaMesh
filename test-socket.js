const { io } = require("socket.io-client");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "1234567890abcdef1234567890abcdef"; // I'll actually fetch it from .env

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const serverUrl = "http://localhost:3000";

// Fake room data
const roomId = "test-room-123";
const seederId = "seeder-111";
const leecherId = "leecher-222";

const seederToken = jwt.sign({ roomId, peerId: seederId, isSeeder: true }, process.env.JWT_SECRET || "fallback");
const leecherToken = jwt.sign({ roomId, peerId: leecherId, isSeeder: false }, process.env.JWT_SECRET || "fallback");

console.log("Connecting Seeder...");
const seederSocket = io(serverUrl, { auth: { token: seederToken } });

seederSocket.on("connect", () => {
  console.log("[Seeder] Connected");
  seederSocket.emit("join-room");
});

seederSocket.on("peer-joined", (pid) => {
  console.log("[Seeder] Peer joined:", pid);
  console.log("[Seeder] Emitting offer to", pid);
  seederSocket.emit("offer", { to: pid, offer: { type: "offer", sdp: "dummy-sdp" } });
});

seederSocket.on("answer", (data) => {
  console.log("[Seeder] Received answer from", data.from, ":", data.answer.type);
});

seederSocket.on("connect_error", (err) => console.log("[Seeder] Error:", err.message));

setTimeout(() => {
  console.log("\nConnecting Leecher...");
  const leecherSocket = io(serverUrl, { auth: { token: leecherToken } });

  leecherSocket.on("connect", () => {
    console.log("[Leecher] Connected");
    leecherSocket.emit("join-room");
  });

  leecherSocket.on("offer", (data) => {
    console.log("[Leecher] Received offer from", data.from, "to", data.to);
    console.log("[Leecher] Emitting answer to", data.from);
    leecherSocket.emit("answer", { to: data.from, answer: { type: "answer", sdp: "dummy-answer-sdp" } });
  });

  leecherSocket.on("connect_error", (err) => console.log("[Leecher] Error:", err.message));

  setTimeout(() => {
    console.log("\nTest Done.");
    process.exit(0);
  }, 2000);

}, 1000);
