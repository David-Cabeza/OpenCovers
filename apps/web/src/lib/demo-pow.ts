// The proof of work of ADR-0017 section 3 that a demo magic link needs (ADR-0022, decision 8a): the decimal counter
// whose SHA-256 of the UTF-8 string `<nonce>:<counter>` starts with `difficulty` zero bits. A trimmed copy of
// apps/widget/src/pow.ts: the widget is a separate package with its own build, so the two do not share code.

export interface PowChallenge {
  nonce: string;
  difficulty: number;
}

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

/** Tries counters in batches of parallel digests and returns the lowest that solves. Needs a secure context. */
export async function solve(challenge: PowChallenge): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("crypto.subtle needs a secure context");
  for (let start = 0; ; start += BATCH) {
    const digests = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        crypto.subtle.digest("SHA-256", encoder.encode(`${challenge.nonce}:${start + i}`)),
      ),
    );
    const hit = digests.findIndex((d) => leadingZeroBits(new Uint8Array(d)) >= challenge.difficulty);
    if (hit >= 0) return String(start + hit);
  }
}

export type WorkerMessage = { kind: "done"; solution: string } | { kind: "failed" };

/** Solves in a Web Worker, off the main thread, or in place when the browser cannot start one. */
export function solveInBackground(challenge: PowChallenge): Promise<string> {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./demo-pow.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return solve(challenge);
  }
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      worker.terminate();
      if (event.data.kind === "done") resolve(event.data.solution);
      else reject(new Error("proof of work failed"));
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(solve(challenge));
    };
    worker.postMessage({ nonce: challenge.nonce, difficulty: challenge.difficulty });
  });
}
