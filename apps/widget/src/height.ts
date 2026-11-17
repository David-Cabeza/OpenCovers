// The widget's half of `embed.js` (ADR-0017 section 1, stage 10): when framed, post the page's height to the
// parent, and nothing else. The parent's origin is unknown here, so the target is "*". That is safe only because
// the message is built from a number alone. The browser already limits who can frame this page to the venue's
// `frame-ancestors`, and `embed.js` checks the origin and source of what it receives.

export const HEIGHT_MESSAGE = "opencovers:height";

export interface HeightMessage {
  type: typeof HEIGHT_MESSAGE;
  height: number;
}

export const heightMessage = (height: number): HeightMessage => ({ type: HEIGHT_MESSAGE, height: Math.ceil(height) });

/** Posts the height on load and on every change of size. ResizeObserver reports at most once per frame. */
export function reportHeight(win: Window, Observer: typeof ResizeObserver = ResizeObserver): void {
  if (win.parent === win) return;
  const page = win.document.documentElement;
  let last = -1;
  new Observer(() => {
    const message = heightMessage(page.getBoundingClientRect().height);
    if (message.height === last) return;
    last = message.height;
    win.parent.postMessage(message, "*");
  }).observe(page);
}
