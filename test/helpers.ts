import { env } from "cloudflare:test";
import type { Env } from "../src/env";

const testEnv = env as unknown as Env;

export async function seedTestKey(): Promise<void> {
  const id = testEnv.AUTH.idFromName("global");
  await testEnv.AUTH.get(id).addKey("test-key", "test-principal", ["*"], "admin");
}
