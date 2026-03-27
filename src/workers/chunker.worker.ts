// Chunker Web Worker
// Runs off the main thread to avoid blocking UI during file processing.
// Input: File object via postMessage
// Output: ChunkManifest + chunk ArrayBuffers

const CHUNK_SIZE = 60 * 1024; // 60KB per chunk to leave room for metadata

interface ChunkerInput {
  file: File;
}

interface ChunkerProgress {
  type: "progress";
  chunksProcessed: number;
  totalChunks: number;
}

interface ChunkerResult {
  type: "complete";
  manifest: {
    fileName: string;
    fileSize: number;
    mimeType: string;
    chunkSize: number;
    totalChunks: number;
    masterHash: string;
    chunkHashes: string[];
  };
  chunks: ArrayBuffer[];
}

interface ChunkerError {
  type: "error";
  message: string;
}

async function hashBuffer(buffer: BufferSource): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

self.onmessage = async (event: MessageEvent<ChunkerInput>) => {
  try {
    const { file } = event.data;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const chunks: ArrayBuffer[] = [];
    const chunkHashes: string[] = [];

    // Slice and hash each chunk
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const slice = file.slice(start, end);
      const buffer = await slice.arrayBuffer();

      const hash = await hashBuffer(buffer);
      chunks.push(buffer);
      chunkHashes.push(hash);

      // Report progress every 10 chunks or on last chunk
      if (i % 10 === 0 || i === totalChunks - 1) {
        const progress: ChunkerProgress = {
          type: "progress",
          chunksProcessed: i + 1,
          totalChunks,
        };
        self.postMessage(progress);
      }
    }

    // Generate master hash from concatenated chunk hashes
    const masterInput = new TextEncoder().encode(chunkHashes.join(""));
    const masterHash = await hashBuffer(masterInput);

    const result: ChunkerResult = {
      type: "complete",
      manifest: {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || "application/octet-stream",
        chunkSize: CHUNK_SIZE,
        totalChunks,
        masterHash,
        chunkHashes,
      },
      chunks,
    };

    self.postMessage(result);
  } catch (err) {
    const error: ChunkerError = {
      type: "error",
      message: err instanceof Error ? err.message : "Unknown chunking error",
    };
    self.postMessage(error);
  }
};
