// The pages React renders at build time. Each one is hydrated in the browser, so its `<!-- -->` markers must survive
// inject-legal. `render` names the export of src/entry-server.tsx that produces the page body.
export const prerendered = [
  { file: "index.html", render: "render" },
  { file: "hoja-de-ruta/index.html", render: "renderRoadmap" },
];
