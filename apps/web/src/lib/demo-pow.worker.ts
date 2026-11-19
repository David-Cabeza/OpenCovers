import { solve, type WorkerMessage } from "./demo-pow";

const post = (message: WorkerMessage) => postMessage(message);

onmessage = async (event: MessageEvent<{ nonce: string; difficulty: number }>) => {
  try {
    post({ kind: "done", solution: await solve(event.data) });
  } catch {
    post({ kind: "failed" });
  }
};
