# LuminaMesh

LuminaMesh is a high-performance, decentralized peer-to-peer (P2P) file sharing application built on a hybrid network model. It combines the reliability of a centralized signaling server with the scalability of a client-side **full-mesh swarm network**, allowing users to share large files securely and efficiently directly through their browsers with zero-persistence server storage.

## Architecture Overview

LuminaMesh operates on a dual-layer architecture:

1. **The Nexus (Signaling Server):**
   A custom Node.js server wrapping Next.js and Socket.io. The Nexus manages WebRTC signaling (offers, answers, and ICE candidates) to facilitate connection handshakes between peers globally. On join, every new peer receives a list of all existing peers in the room, enabling **full-mesh WebRTC connections** where every node can communicate directly with every other node.

2. **The Swarm (Client Mesh):**
   Once connected via the Nexus, peers communicate directly over WebRTC data channels in a full-mesh topology. The mesh network utilizes a **Gossip Protocol** to announce and request available file chunks (64KB slices) dynamically from the swarm.

### Full-Mesh Swarm Protocol

Unlike traditional star-topology file sharing (where all receivers download from a single sender), LuminaMesh implements a **BitTorrent-inspired swarm**:

- **Bitfield Gossip (500ms interval):** Every peer periodically announces which chunks it has to all connected peers.
- **Rarest-First Chunk Selection:** Peers prioritize downloading chunks that are held by the fewest peers, maximizing data availability across the swarm.
- **Least-Loaded Peer Selection:** Chunk requests are spread evenly across all available peers using a load-balancing algorithm, preventing any single peer from becoming a bottleneck.
- **Concurrent Multi-Source Downloads:** Up to 20 concurrent chunk requests are dispatched across multiple peers simultaneously, scaling with the number of connected nodes.
- **Automatic Re-Seeding:** Receivers become seeders immediately — every downloaded chunk is available for redistribution to other peers. After completing a download, peers continue gossiping and serving chunks to keep the swarm alive.

```
Peer A (Seeder)  ←→  Peer B (Receiver/Seeder)
     ↕                    ↕
Peer C (Receiver)  ←→  Peer D (Receiver)

Every peer connects to every other peer.
Chunks flow through the fastest available path.
```

## Technology Stack

- **Frontend & API Layout:** Next.js 16 (App Router), React 19
- **Database (Permanent Metadata):** Neon PostgreSQL with Prisma ORM
- **In-Memory State (Room Management):** Upstash Redis Serverless
- **Real-Time Signaling:** Socket.io
- **P2P Networking:** Native WebRTC (RTCPeerConnection + RTCDataChannel)
- **Security:** JSON Web Tokens (JWT), Web Crypto API (SHA-256)

## Security and Privacy Features

- **End-to-End Encryption (E2EE):** All file transfers occur over DTLS and SRTP secured WebRTC channels. The signaling server never processes or touches the actual file payload.
- **Zero-Persistence Data Storage:** Files exist entirely within the volatile memory of the active browser swarm. When all peers exit a room, the file ceases to exist.
- **Cryptographic Chunk Verification:** Senders automatically generate a SHA-256 manifest of the file. Receivers strictly verify the hash of each incoming 64KB chunk. Malicious or corrupted packets are immediately discarded.
- **Robust Access Control:** Real-time WebSockets are secured via JWTs issued exclusively through verified API routes, preventing unauthorized mesh eavesdropping or flooding.

## Prerequisites

To run LuminaMesh locally, ensure the following are installed:
- Node.js (v20 or higher recommended)
- A Neon PostgreSQL Database URL
- An Upstash Redis REST URL and Token

## Local Development Setup

1. **Clone the Repository**
   ```bash
   git clone https://github.com/ayoitssmit/LuminaMesh.git
   cd LuminaMesh
   npm install
   ```

2. **Environment Configuration**
   Create a `.env` file and configure your database and Redis credentials:
   ```env
   DATABASE_URL="postgresql://user:password@neon-host/database"
   UPSTASH_REDIS_REST_URL="https://your-url.upstash.io"
   UPSTASH_REDIS_REST_TOKEN="your-token"
   JWT_SECRET="your-secure-random-string"
   NEXT_PUBLIC_APP_URL="http://localhost:3000"
   ```

3. **Database Migration**
   Generate the Prisma client and push the schema to your Neon database:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Start the Development Server**
   Start the hybrid Next.js + Socket.io custom server:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:3000`.

## Usage

1. Navigate to `/upload` and drop a file to share
2. Copy the generated room link and share it with recipients
3. Recipients open the link and automatically join the swarm
4. Files download from **all available peers simultaneously** — not just the original sender
5. After download completes, recipients continue seeding to help other peers

## License

This project is proprietary and confidential.
