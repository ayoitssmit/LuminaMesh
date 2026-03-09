# LuminaMesh

LuminaMesh is a high-performance, decentralized peer-to-peer (P2P) file sharing application built on a hybrid network model. It combines the reliability of a centralized signaling server with the scalability of a client-side full-mesh swarm network, allowing users to share large files securely and efficiently directly through their browsers with zero-persistence server storage.

## Architecture Overview

LuminaMesh operates on a dual-layer architecture:

1. **The Signaling Server (Nexus):**
   A custom Node.js server wrapping Next.js and Socket.io. The server manages WebRTC signaling (offers, answers, and ICE candidates) to facilitate connection handshakes between peers globally. On joining, every new peer receives a list of all existing peers in the room, enabling full-mesh WebRTC connections where every node can communicate directly with every other node.

2. **The Client Mesh (Swarm):**
   Once connected via the signaling server, peers communicate directly over WebRTC data channels in a full-mesh topology. The mesh network utilizes a gossip protocol to announce and request available file chunks dynamically from the swarm.

### Full-Mesh Swarm Protocol

Unlike traditional star-topology file sharing, LuminaMesh implements a BitTorrent-inspired swarm to enable concurrent, high-throughput transfers:

- **Bitfield Gossip:** Every peer periodically announces which chunks it has to all connected peers.
- **Rarest-First Chunk Selection:** Peers prioritize downloading chunks that are held by the fewest peers, maximizing data availability across the swarm.
- **Least-Loaded Peer Selection:** Chunk requests are spread evenly across all available peers using a load-balancing algorithm, preventing any single peer from becoming a bottleneck.
- **Concurrent Multi-Source Downloads:** Chunk requests are dispatched across multiple peers simultaneously, scaling the transfer speed with the number of connected nodes.
- **Automatic Re-Seeding:** Receivers become seeders immediately. Every downloaded chunk is available for redistribution to other peers. After completing a download, peers continue gossiping and serving chunks to keep alive the swarm.

## Technology Stack

- **Frontend Framework:** Next.js 16 (App Router), React 19
- **Database (Metadata):** Neon PostgreSQL with Prisma ORM
- **In-Memory State:** Upstash Redis Serverless
- **Real-Time Signaling:** Socket.io
- **P2P Networking:** Native WebRTC (RTCPeerConnection and RTCDataChannel)
- **Security:** JSON Web Tokens (JWT), Web Crypto API (SHA-256)

## Security and Privacy

- **End-to-End Encryption (E2EE):** All file transfers occur over DTLS and SRTP secured WebRTC channels. The signaling server never processes or touches the actual file payload.
- **Zero-Persistence Data Storage:** Files exist entirely within the volatile memory of the active browser swarm. When all peers exit a room, the file ceases to exist.
- **Cryptographic Chunk Verification:** Senders automatically generate a SHA-256 manifest of the file. Receivers strictly verify the hash of each incoming chunk. Malicious or corrupted packets are immediately discarded.
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
   Create a `.env.local` file and configure your database and Redis credentials:
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

4. **Run the Development Server (for UI edits)**
   Start the Next.js dev server:
   ```bash
   npm run dev
   ```
   *Note: In development mode, Next.js hot-reloading may disrupt active WebRTC connections and clear browser state.*

5. **Run the Production Server (for testing P2P transfers)**
   To test stable transfers without Hot Module Replacement (HMR) interrupting the active socket and memory state, build and run the production server:
   ```bash
   npm run build
   $env:NODE_ENV="production"; npm start # On Windows PowerShell
   # OR
   NODE_ENV=production npm start # On Mac/Linux
   ```
   The application will be accessible at `http://localhost:3000`.

## Architecture & Resiliency

- **Dropped Connection Handling:** The WebRTC data channels exist independently of the signaling server. If the Next.js/Socket.io server restarts, active file transfers will continue uninterrupted between peers. 
- **Graceful Reconnection:** When the signaling server comes back online, clients automatically reconnect to the socket without tearing down their existing WebRTC mesh.
- **Zero-Persistence Safety Net:** Rooms and metadata are purely stored in Redis and PostgreSQL for signaling. When a room drops to 0 peers, the server applies a 1-minute grace period before permanently wiping the metadata to allow transient disconnects to recover smoothly.

## How It Works (Application Flow)

LuminaMesh converts standard browser clients into active swarm nodes in a few simple steps:

1. **Upload Phase:** 
   Navigate to `/upload` and drop a file to share. The client chunks the file into 64KB pieces and hashes each piece to create a master manifest.
2. **Room Creation:** 
   The manifest and file metadata are sent to the Next.js API. The server creates a unique room ID, stores the metadata in PostgreSQL, and generates a secure JWT token for room access.
3. **Swarm Initialization:** 
   The uploader automatically connects to the Socket.io signaling server using their JWT. They enter a "seeding" state, waiting for receiver peers to join.
4. **Peer Connection:** 
   Recipients open the generated room link (`/room/[id]`). The client fetches the file metadata to understand the file size and chunk count.
5. **Full-Mesh Transfer:**
   Once connected to the room via Socket.io, new peers establish direct WebRTC data channels with the original seeder and any other connected peers. Files download from all available peers simultaneously, scaling the available bandwidth automatically.
6. **Re-seeding:** 
   After a download completes, the recipient client retains the assembled blob and continues to serve chunks to newly joined peers to support the swarm's health.

## License

This project is proprietary and confidential.
