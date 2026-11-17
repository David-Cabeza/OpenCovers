// better-auth lists drizzle-kit and vitest as optional peers. pnpm links any it finds in the
// workspace, which pulls both dev tools into the API image. The API uses neither through better-auth.
const droppedPeers = ["drizzle-kit", "vitest"];

function readPackage(pkg) {
  if (pkg.name === "better-auth") {
    for (const name of droppedPeers) {
      delete pkg.peerDependencies?.[name];
      delete pkg.peerDependenciesMeta?.[name];
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
