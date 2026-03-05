import { io } from "socket.io-client";

const BASE_URL = "http://localhost:3000";

async function runTest() {
  console.log("=== 1. Testing POST /api/upload ===");
  
  const uploadRes = await fetch(BASE_URL + "/api/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "test-movie.mp4",
      size: 1048576,
      masterHash: "abcdef1234567890",
      chunkCount: 16,
      mimeType: "video/mp4"
    })
  });

  const uploadData = await uploadRes.json();
  
  if (!uploadData.success) {
    console.error("Upload failed!", uploadData);
    return;
  }

  const roomId = uploadData.roomId;
  const peerId = uploadData.peerId;
  const token = uploadData.token;
  
  console.log("✅ Upload Success! Room: " + roomId + " | Peer: " + peerId);
  console.log("✅ Received JWT Token for secure connection.\n");

  console.log("=== 2. Testing Socket.io Connection ===");
  
  const socket = io(BASE_URL, {
    auth: { token }
  });

  socket.on("connect", () => {
    console.log("✅ Socket Connected! (ID: " + socket.id + ")");
    console.log("Sending 'join-room' event...");
    socket.emit("join-room");
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Socket Error:", err.message);
  });

  socket.on("peer-joined", (newPeerId) => {
    console.log("[Room Event] Peer joined: " + newPeerId);
  });

  socket.on("offer", (data) => {
    console.log("[Room Event] Received offer from " + data.from);
    socket.disconnect();
  });

  setTimeout(() => {
    console.log("Simulating an incoming offer...");
    socket.emit("offer", { to: peerId, offer: { type: "offer", sdp: "dummy" } });
  }, 2000);

  socket.on("disconnect", () => {
    console.log("\n✅ Test finished and socket disconnected safely.");
    process.exit(0);
  });
}

runTest().catch(console.error);
