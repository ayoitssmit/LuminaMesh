# LuminaMesh

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-333333?logo=webrtc)
![Socket.io](https://img.shields.io/badge/Socket.io-Signaling-010101?logo=socket.io)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/Neon-PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Upstash-Redis-DC382D?logo=redis&logoColor=white)

LuminaMesh is a high-performance, decentralized peer-to-peer (P2P) file sharing application built on a hybrid network model. It combines the reliability of a centralized signaling server with the infinite scalability of a client-side full-mesh swarm network. It allows users to share multi-gigabyte files securely and efficiently directly through their browsers with zero-persistence server storage.

## Key Features and Capabilities

- **Infinite File Size Support:** Securely stream files of any size (tested 10GB+) directly from browser to browser without relying on cloud storage or hitting upload limits.
- **Full-Mesh Swarm Routing:** Downloads scale exponentially. The more peers that join a room, the faster the file distributes among the swarm using simultaneous multi-source fetching.
- **Resumable Downloads:** Accidentally close the tab midway? LuminaMesh instantly recovers your exact progress using local IndexedDB caching and resumes downloading the remaining chunks from the swarm. 
- **Direct-to-Disk Streaming:** Zero Out-of-Memory (OOM) browser crashes. Massive files bypass the browser's RAM entirely, writing chunks directly onto the user's hard drive via the Native FileSystem Access API.
- **End-to-End Encrypted (E2EE):** All transfers occur over strict DTLS/SRTP WebRTC Data Channels. The server never payload-decrypts or hosts your files.
- **WebRTC Smart Throttling:** Network backpressure is natively managed. The SCTP buffer is dynamically monitored to prevent packet drops and main-thread freezing on slow networks.
- **Zero-Persistence Safety:** Files exist entirely within the volatile memory of the active browser swarm. When a room hits zero peers, all transient signaling metadata permanently vanishes.

---

## Architecture Overview

LuminaMesh operates on a highly resilient dual-layer architecture:

### 1. The Signaling Server (Nexus)
A robust Node.js server wrapping Next.js and Socket.io. The server purely manages WebRTC signaling (SDP offers, answers, and ICE candidates) to facilitate connection handshakes globally. Upon joining, every peer receives a list of all existing peers in the room, enabling full-mesh WebRTC connections where every node directly interfaces with every other node.

### 2. The Client Mesh (Swarm)
Once connected via the signaling server, peers communicate directly over WebRTC data channels in a full-mesh topology. The mesh network utilizes a highly-optimized gossip protocol to announce available file chunks dynamically across the swarm.

#### Full-Mesh Swarm Protocol
Unlike traditional star-topology file sharing, LuminaMesh implements a BitTorrent-inspired swarm to enable concurrent, high-throughput transfers:
- **Bitfield Gossip:** Every peer periodically announces exactly which chunks they possess to the swarm.
- **Rarest-First Chunk Selection:** Peers prioritize downloading chunks held by the *fewest* peers, maximizing unique data availability across the network.
- **Weighted Peer Selection:** Requests are spread evenly across all available peers using a dynamic load-balancing algorithm, heavily favoring peers with the lowest latency and highest throughput.
- **Simultaneous Assembly:** Chunk requests are dispatched across multiple peers in parallel, multiplying transfer speeds by the number of connected nodes.
- **Automatic Re-Seeding:** Receivers become seeders instantly. Every downloaded chunk is immediately available for redistribution.

---

## Memory Management & Resiliency

Working with enormous files in a browser environment requires extreme memory precision. LuminaMesh implements industry-leading safety protocols:

- **WebRTC SCTP Smart Throttling:** To prevent browser crashes and frozen UI threads when transferring multi-gigabyte files, LuminaMesh implements native SCTP backpressure. An asynchronous execution queue actively monitors the `RTCDataChannel.bufferedAmount`. If the buffer exceeds 16MB, the disk-read loop intelligently awaits an `onbufferedamountlow` event (triggered at 64KB) before resuming. This precise "Pull" model guarantees zero packet drops even on intensely congested networks.
- **Direct-to-Disk Streaming:** Large files (>500MB) bypass the browser's RAM array entirely and stream directly to the user's hard drive using the FileSystem Access API.
- **Secure IndexedDB Caching:** Incoming chunks are permanently cached efficiently in the browser's local IndexedDB NoSQL storage table via Dexie.js.
- **Stitch-and-Purge Lifecycle (GC):** Temporary cache storage is automatically purged the exact moment a user completes their download and explicitly clicks "Save File". A passive 7-day Sweeper also runs on application boot to seamlessly clean up any abandoned/incomplete downloads from the disk.

---

## Technology Stack

- **Frontend Framework:** Next.js 16 (App Router), React 19
- **Database (Metadata):** Neon PostgreSQL with Prisma ORM
- **In-Memory State:** Upstash Redis Serverless
- **Real-Time Signaling:** Socket.io
- **P2P Networking:** Native WebRTC (RTCPeerConnection and RTCDataChannel)
- **Client Storage:** IndexedDB (via Dexie.js)
- **Local Write Protocol:** Native FileSystem Access API
- **Security & Hashes:** JSON Web Tokens (JWT), Web Crypto API (SHA-256)

---

## Local Development Setup

To run LuminaMesh locally, ensure you have Node.js (v20+), a Neon PostgreSQL Database URL, and an Upstash Redis REST URL.

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
   Generate the Prisma client and push the schema to your database:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Run the Production Server (For P2P Testing)**
   To test stable transfers without Hot Module Replacement (HMR) interrupting the active socket and IndexedDB structures, build and run the production server:
   ```bash
   npm run build
   $env:NODE_ENV="production"; npm start # On Windows PowerShell
   # OR
   NODE_ENV=production npm start # On Mac/Linux
   ```
   The application will be accessible at `http://localhost:3000`.

---

## Application Flow (How It Works)

LuminaMesh converts standard browser clients into active swarm nodes in a few simple steps:

1. **Upload Phase:** Navigate to `/upload` and drop a file. The client slices the file into precise 64KB pieces and hashes each piece to create a SHA-256 master manifest.
2. **Room Creation:** The manifest and metadata are dispatched to the Next.js API. The server provisions a unique room ID, lodges the metadata in PostgreSQL, and yields a secure JWT token for room access.
3. **Swarm Initialization:** The uploader automatically websockets to the Socket.io signaling server using their JWT, entering a "seeding" state.
4. **Peer Connection:** Recipients open the generated room link. The client retrieves the metadata to map the file topology.
5. **Full-Mesh Transfer:** New peers securely establish direct WebRTC data channels with all connected peers. Files seamlessly materialize pulling chunks from the entire room simultaneously.
6. **Re-seeding:** Over the course of the download, and indefinitely after completion, the recipient client retains the assembled topology and actively redistributes chunks to support the swarm's health.

---

## License

This project is proprietary and confidential.
