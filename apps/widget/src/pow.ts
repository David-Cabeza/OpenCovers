import type { FormChallenge } from "./api";

// The proof of work of ADR-0017 section 3, as apps/api/src/lib/public-challenge.ts verifies it: the decimal
// counter whose SHA-256 of the UTF-8 string `<nonce>:<counter>` starts with `difficulty` zero bits.

export function leadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

const BATCH = 256;
const encoder = new TextEncoder();

/**
 * Tries counters in batches of parallel digests and returns the lowest that solves. Rejects outside a secure
 * context (plain http on a host other than localhost), where browsers do not offer `crypto.subtle`.
 */
export async function solve(
  challenge: Pick<FormChallenge, "nonce" | "difficulty">,
  onProgress?: (tries: number) => void,
): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("crypto.subtle needs a secure context");
  for (let start = 0; ; start += BATCH) {
    const digests = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        crypto.subtle.digest("SHA-256", encoder.encode(`${challenge.nonce}:${start + i}`)),
      ),
    );
    const hit = digests.findIndex((d) => leadingZeroBits(new Uint8Array(d)) >= challenge.difficulty);
    if (hit >= 0) return String(start + hit);
    onProgress?.(start + BATCH);
  }
}

export type WorkerMessage =
  | { kind: "progress"; tries: number }
  | { kind: "done"; solution: string }
  | { kind: "failed" };

/** Solves in a Web Worker, off the main thread, or in place when the browser cannot start one. */
export function solveInBackground(
  challenge: Pick<FormChallenge, "nonce" | "difficulty">,
  onProgress?: (tries: number) => void,
): Promise<string> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return solve(challenge, onProgress);
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.kind === "progress") return onProgress?.(message.tries);
      worker.terminate();
      if (message.kind === "done") resolve(message.solution);
      else reject(new Error("proof of work failed"));
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(solve(challenge, onProgress));
    };
    worker.postMessage({ nonce: challenge.nonce, difficulty: challenge.difficulty });
  });
}
