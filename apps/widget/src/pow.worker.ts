import { solve, type WorkerMessage } from "./pow";

const post = (message: WorkerMessage) => postMessage(message);

onmessage = async (event: MessageEvent<{ nonce: string; difficulty: number }>) => {
  try {
    post({ kind: "done", solution: await solve(event.data, (tries) => post({ kind: "progress", tries })) });
  } catch {
    post({ kind: "failed" });
  }
};
