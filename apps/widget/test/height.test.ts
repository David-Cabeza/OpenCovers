import { describe, expect, it, vi } from "vitest";
import { HEIGHT_MESSAGE, heightMessage, reportHeight } from "../src/height";

function frame(opts: { framed: boolean }) {
  let height = 480;
  const observed: Element[] = [];
  const observers: (() => void)[] = [];
  const parent = { postMessage: vi.fn() };
  const documentElement = { getBoundingClientRect: () => ({ height }) } as unknown as HTMLElement;
  const win = { document: { documentElement } } as unknown as Window;
  const Observer = class {
    constructor(callback: () => void) {
      observers.push(callback);
    }
    observe(el: Element) {
      observed.push(el);
    }
  } as unknown as typeof ResizeObserver;
  Object.assign(win, { parent: opts.framed ? parent : win });
  return {
    win,
    Observer,
    parent,
    observed,
    resize(to: number) {
      height = to;
      for (const callback of observers) callback();
    },
  };
}

describe("heightMessage", () => {
  it("holds the type and a whole height, and no other key", () => {
    const message = heightMessage(512.2);
    expect(message).toEqual({ type: HEIGHT_MESSAGE, height: 513 });
    expect(Object.keys(message).sort()).toEqual(["height", "type"]);
    expect(JSON.parse(JSON.stringify(message))).toEqual(message);
  });
});

describe("reportHeight", () => {
  it("does nothing on a top-level page", () => {
    const top = frame({ framed: false });
    reportHeight(top.win, top.Observer);
    expect(top.observed).toEqual([]);
  });

  it("posts each new height of the document to the parent, with only the type and the height", () => {
    const f = frame({ framed: true });
    reportHeight(f.win, f.Observer);
    expect(f.observed).toEqual([f.win.document.documentElement]);

    f.resize(480);
    f.resize(480);
    f.resize(731.5);
    expect(f.parent.postMessage.mock.calls).toEqual([
      [{ type: HEIGHT_MESSAGE, height: 480 }, "*"],
      [{ type: HEIGHT_MESSAGE, height: 732 }, "*"],
    ]);
    for (const [message] of f.parent.postMessage.mock.calls) {
      expect(Object.keys(message).sort()).toEqual(["height", "type"]);
    }
  });
});
