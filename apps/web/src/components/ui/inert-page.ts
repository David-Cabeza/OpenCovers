// A modal menu marks the page behind it aria-hidden but leaves its controls focusable,
// which axe flags (aria-hidden-focus). Used as the ref of the open content, this makes the page
// inert while the content is mounted, so nothing hidden can take focus.
// Not for Select: it keeps its closed content mounted off screen, which would leave the page inert.
export function inertPage(): (() => void) | void {
  const page = document.getElementById("root")
  if (!page || page.hasAttribute("inert")) return
  page.setAttribute("inert", "")
  return () => {
    page.removeAttribute("inert")
  }
}
