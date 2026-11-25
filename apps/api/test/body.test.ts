import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { integer, optional, parseBody, text } from "../src/lib/body";

const fields = { a: optional(integer(0, 9)), b: optional(text(3)) };

const app = new Hono();
app.post("/", async (c) => c.json({ body: await parseBody(c.req, fields) }));

const post = async (body?: string) =>
  (await (await app.request("/", { method: "POST", headers: { "content-type": "application/json" }, body })).json()) as {
    body: unknown;
  };

describe("parseBody", () => {
  it("returns the checked fields of a JSON object", async () => {
    expect((await post('{"a":1,"b":"xy"}')).body).toEqual({ a: 1, b: "xy" });
    expect((await post("{}")).body).toEqual({ a: undefined, b: undefined });
  });

  it.each([undefined, "", "{", "null", "[]", "[1]", "1", '"x"', "true"])("returns null for the body %j", async (raw) => {
    expect((await post(raw)).body).toBeNull();
  });

  it("returns null for a field that fails its check, a null field and a field not listed", async () => {
    for (const raw of ['{"a":10}', '{"a":1.5}', '{"a":null}', '{"b":"long"}', '{"c":1}', '{"a":1,"c":1}']) {
      expect((await post(raw)).body, raw).toBeNull();
    }
  });
});
