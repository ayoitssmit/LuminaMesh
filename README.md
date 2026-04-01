# LuminaMesh

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![WebRTC](https://img.shields.io/badge/WebRTC-P2P-333333?logo=webrtc)
![Pusher](https://img.shields.io/badge/Pusher-Signaling-300D4F?logo=pusher)
![Twilio](https://img.shields.io/badge/Twilio-TURN-F22F46?logo=twilio)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/Neon-PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Upstash-Redis-DC382D?logo=redis&logoColor=white)

LuminaMesh is a high-performance, decentralized peer-to-peer (P2P) file sharing application built on a hybrid network model. It combines the reliability of a centralized signaling mechanism with the infinite scalability of a client-side full-mesh swarm network. The system facilitates secure, efficient sharing of multi-gigabyte files directly through browser clients without persistence on server storage.

## Key Features and Capabilities

- **Infinite File Size Support:** Stream files of unrestricted size directly between browsers bypassing cloud storage dependencies and upload limits.
- **Full-Mesh Swarm Routing:** Downloads scale exponentially. Network performance improves proportionately with the number of peers within a session through simultaneous multi-source fetching.
- **Resumable Downloads:** Session interruptions are mitigated via local IndexedDB caching, seamlessly resuming incomplete transfers from the swarm.
- **Direct-to-Disk Streaming:** Engineered to prevent Out-of-Memory (OOM) failures, large file constraints are mitigated by writing directly to local disk structures leveraging the Native FileSystem Access API.
- **End-to-End Encryption (E2EE):** Transfers strictly operate over DTLS/SRTP WebRTC Data Channels. Centralized servers do not compute or host payload content.
- **WebRTC Smart Throttling:** Network backpressure is systematically managed. The SCTP buffer is dynamically monitored to prevent packet drops and main-thread interruptions across restricted bandwidth.
- **Zero-Persistence Data Policy:** Payloads remain exclusively within the volatile memory structures of the active browser swarm. Terminating all peer connections permanently eradicates transient signaling metadata.
- **Enterprise-Grade NAT Traversal:** WebRTC connectivity circumvents aggressive firewall packet inspection and restricted corporate/educational networks using a scalable Twilio TURN relay infrastructure.

## Architecture Overview

LuminaMesh implements a robust dual-layer architecture:

### 1. The Signaling Mechanism (Pusher)
The system employs Pusher Channels connected to a Next.js serverless infrastructure to manage initial state. This layer handles declarative WebRTC signaling (SDP offers, answers, and ICE candidates) to facilitate global connection handshakes. Upon authorization, peers receive state topology of the existing session, initializing full-mesh WebRTC interfaces where clients connect with all active nodes.

### 2. The Client Mesh (Swarm)
Following signaling connection, clients communicate directly over WebRTC data channels establishing a full-mesh topology. The network utilizes an optimized gossip protocol to dynamically announce file chunk availability across the designated swarm.

#### Full-Mesh Swarm Protocol
LuminaMesh implements a sophisticated swarm algorithm enabling concurrent, high-throughput transfers:
- **Bitfield Gossip:** Nodes systematically announce their verified chunk possessions to the active swarm.
- **Rarest-First Chunk Selection:** The system prioritizes acquisition of chunks distributed to the fewest nodes, optimizing unique data availability across the architecture.
- **Weighted Peer Selection:** Requests dynamically load-balance across available edges, structurally favoring paths with optimal latency and throughput characteristics.
- **Simultaneous Assembly:** Chunk requests dispatch concurrently across multiple remote peers, effectively multiplying transfer velocities.
- **Automatic Re-Seeding:** Receiver nodes instantaneously convert to seeders, redistributing acquired chunks without delay.

## Memory Management & Resiliency

Processing multi-gigabyte parameters within a browser sandbox necessitates strict memory protocols. LuminaMesh ensures stability through:

- **WebRTC SCTP Smart Throttling:** Utilizing native SCTP backpressure, an asynchronous queue monitors the `RTCDataChannel.bufferedAmount`. Buffer expansion beyond 16MB initiates a systematic disk-read pause, resuming upon the `onbufferedamountlow` event trigger (64KB threshold). This "Pull" sequence guarantees zero packet loss over congested network paths.
- **Direct-to-Disk Streaming:** Payloads exceeding 500MB bypass device RAM entirely, securely streaming direct to the persistent disk using the FileSystem Access API.
- **Secure IndexedDB Caching:** Incoming fragment variables permanently hash to local IndexedDB NoSQL tables via Dexie.js for structural integrity.
- **Stitch-and-Purge Lifecycle (GC):** Transient cache allocations automatically purge following explicit user verification ("Save File"). An automated 7-day maintenance lifecycle clears any aborted filesystem routines upon boot sequences.

## Technology Stack

- **Frontend Framework:** Next.js 16 (App Router), React 19
- **Database (Metadata):** Neon PostgreSQL deployed with Prisma ORM
- **In-Memory State:** Upstash Redis (Serverless)
- **Real-Time Signaling:** Pusher Serverless WebSockets
- **P2P Networking:** Native WebRTC (RTCPeerConnection, RTCDataChannel) with Twilio TURN Infrastructure
- **Client Storage:** IndexedDB managed through Dexie.js
- **Local Write Protocol:** Native FileSystem Access API
- **Security & Cryptography:** JSON Web Tokens (JWT), Web Crypto API (SHA-256)

## Local Development Setup

Validation of the environment requires Node.js (v20+). Third-party resource provisioning is required for PostgreSQL, Redis, Pusher, and Twilio.

1. **Clone the Repository**
   ```bash
   git clone https://github.com/ayoitssmit/LuminaMesh.git
   cd LuminaMesh
   npm install
   ```

2. **Environment Configuration**
   Provision `.env` following `.env.example` structure.
   ```bash
   cp .env.example .env
   ```
   *Required Infrastructure:*
   - **PostgreSQL**: Provision a relational database via Neon.tech and inject the connection string.
   - **Redis**: Deploy a Serverless Redis cluster via Upstash and inject REST credentials.
   - **Authentication**: Configure Google Cloud Console and GitHub Developer Settings for standard OAuth IDs and Secrets. Define strong cryptographic strings for `JWT_SECRET`, `AUTH_SECRET`, and `NEXTAUTH_SECRET`.
   - **Pusher**: Register a unified Pusher Channels application and inject credentials to manage signaling operations.
   - **Twilio**: Configure a Twilio account and provide `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` to generate secure TURN server credentials to bypass NAT/Firewall blocks.

3. **Database Migration**
   Execute Prisma client compilation and align relational schemas:
   ```bash
   npx prisma generate
   npx prisma db push
   ```

4. **Run the Development Server**
   Initialize the development environment:
   ```bash
   npm run dev
   ```
   For precise P2P throughput testing (avoiding HMR websocket interruption), utilization of the production build is recommended:
   ```bash
   npm run build
   $env:NODE_ENV="production"; npm start # On Windows PowerShell
   # OR
   NODE_ENV=production npm start # On Mac/Linux
   ```
   Deployments validate over standard port `http://localhost:3000`.

## Application Lifecycle

LuminaMesh transitions conventional browser processes into robust swarm nodes:

1. **Upload Phase:** Interaction at `/upload` processes the payload. The processor evaluates physical slices (64KB) computing cumulative SHA-256 manifests.
2. **Room Allocation:** Master manifests route to the Next.js API. The protocol provisions a standardized session ID, hashes PostgreSQL metadata, and securely returns a standardized JWT token.
3. **Swarm Initialization:** Seed clients transparently connect to the Pusher signaling cluster authenticating with their private JWT.
4. **Peer Connection:** Connecting clients process the session URL, querying remote metadata to dynamically establish file topologies.
5. **Full-Mesh Transfer:** Nodes safely construct WebRTC pathways against registered session participants. Chunks synchronize simultaneously from diverse sources.
6. **Re-seeding Protocol:** Throughout and subsequent to transfer completion, local architectures inherently reconstruct topology paths, stabilizing swarm vitality by fulfilling subsequent data requirements.

## License

This project is proprietary and confidential.
