# LuminaMesh

LuminaMesh is a high-performance, decentralized peer-to-peer (P2P) file sharing application built on a hybrid network model. It combines the reliability of a centralized signaling server with the scalability of a client-side mesh network, allowing users to share large files securely and efficiently directly through their browsers without zero-persistence server storage.

## Architecture Overview

LuminaMesh operates on a dual-layer architecture:

1. **The Nexus (Signaling Server):**
   A custom Node.js server wrapping Next.js and Socket.io. The Nexus manages WebRTC signaling (offers, answers, and ICE candidates) to facilitate connection handshakes between peers globally.

2. **The Swarm (Client Mesh):**
   Once connected via the Nexus, peers communicate directly over WebRTC data channels. The mesh network utilizes a proprietary Gossip Protocol to announce and request available file chunks (64KB slices) dynamically from the swarm.

## Technology Stack

- **Frontend & API Layout:** Next.js 15 (App Router), React 19
- **Database (Permanent Metadata):** Neon PostgreSQL with Prisma ORM
- **In-Memory State (Room Management):** Upstash Redis Serverless
- **Real-Time Signaling:** Socket.io
- **P2P Networking:** WebRTC (via Simple-Peer)
- **Security:** JSON Web Tokens (JWT), Web Crypto API (SHA-256)

## Security and Privacy Features

- **End-to-End Encryption (E2EE):** All file transfers occur over DTLS and SRTP secured WebRTC channels. The signaling server never processes or touches the actual file payload.
- **Zero-Persistence Data Storage:** Files exist entirely within the volatile memory of the active browser swarm. When all peers exit a room, the file ceases to exist.
- **Cryptographic chunk verification:** Senders automatically generate a SHA-256 manifest of the file. Receivers strictly verify the hash of each incoming 64KB chunk. Malicious or corrupted packets are immediately discarded, and poisoning nodes are blacklisted.
- **Robust Access Control:** Real-time WebSockets are secured via JWTs issued exclusively through verified API routes, preventing unauthorized mesh eavesdropping or flooding.

## Prerequisites

To run LuminaMesh locally, ensure the following are installed:
- Node.js (v20 or higher recommended)
- A Neon PostgreSQL Database URL
- An Upstash Redis REST URL and Token

## Local Development Setup

1. **Environment Configuration**
   Duplicate `.env.local` to `.env` (if not already done) and configure your database and Redis credentials:
   ```env
   DATABASE_URL="postgresql://user:password@neon-host/database"
   UPSTASH_REDIS_REST_URL="https://your-url.upstash.io"
   UPSTASH_REDIS_REST_TOKEN="your-token"
   JWT_SECRET="your-secure-random-string"
   NEXT_PUBLIC_APP_URL="http://localhost:3000"
   ```

2. **Database Migration**
   Generate the Prisma client and push the schema to your Neon database:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

3. **Start the Development Server**
   Start the hybrid Next.js + Socket.io custom server:
   ```bash
   npm run dev
   ```
   The application will be accessible at `http://localhost:3000`.

## License

This project is proprietary and confidential.
