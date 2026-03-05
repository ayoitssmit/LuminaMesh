import { useCallback, useRef, useState } from "react";

interface ChunkManifest {
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  masterHash: string;
  chunkHashes: string[];
}

interface UseChunkerReturn {
  processFile: (file: File) => void;
  manifest: ChunkManifest | null;
  chunks: ArrayBuffer[];
  progress: number; // 0 to 100
  isProcessing: boolean;
  error: string | null;
}

export function useChunker(): UseChunkerReturn {
  const [manifest, setManifest] = useState<ChunkManifest | null>(null);
  const [chunks, setChunks] = useState<ArrayBuffer[]>([]);
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const processFile = useCallback((file: File) => {
    // Reset state
    setManifest(null);
    setChunks([]);
    setProgress(0);
    setError(null);
    setIsProcessing(true);

    // Terminate any existing worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    const worker = new Worker(
      new URL("../workers/chunker.worker.ts", import.meta.url)
    );
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const data = event.data;

      if (data.type === "progress") {
        const pct = Math.round((data.chunksProcessed / data.totalChunks) * 100);
        setProgress(pct);
      } else if (data.type === "complete") {
        setManifest(data.manifest);
        setChunks(data.chunks);
        setProgress(100);
        setIsProcessing(false);
        worker.terminate();
      } else if (data.type === "error") {
        setError(data.message);
        setIsProcessing(false);
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      setError(err.message);
      setIsProcessing(false);
      worker.terminate();
    };

    worker.postMessage({ file });
  }, []);

  return { processFile, manifest, chunks, progress, isProcessing, error };
}
