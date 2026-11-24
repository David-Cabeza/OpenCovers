import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { readJsonObject } from "../src/lib/json-body";

const app = new Hono();
app.post("/", async (c) => c.json({ body: await readJsonObject(c) }));

const post = async (body?: string) =>
  (await (await app.request("/", { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as {
    body: unknown;
  };

describe("readJsonObject", () => {
  it("returns a JSON object", async () => {
    expect((await post('{"a":1}')).body).toEqual({ a: 1 });
    expect((await post("{}")).body).toEqual({});
  });

  it.each([undefined, "", "{", "null", "[]", "[1]", "1", '"x"', "true"])("returns null for %j", async (raw) => {
    expect((await post(raw)).body).toBeNull();
  });
});
