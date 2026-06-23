// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so Metro picks up workspace packages.
config.watchFolders = [monorepoRoot];

// 2. Resolve modules from the app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// 3. Only look in the paths above (don't walk up the tree ambiguously).
config.resolver.disableHierarchicalLookup = true;

// 4. Keep better-auth's SERVER crypto graph out of the React Native bundle.
//    `@better-auth/expo/client` imports `better-auth/cookies`, which transitively
//    pulls better-auth's server cookie/JWT graph (crypto/jwt -> `jose`). jose's
//    webapi build needs Web Crypto (`crypto.subtle`), which Hermes lacks, so the
//    module fails to *evaluate* at import on-device — "TypeError: undefined is not
//    a function" — cascading to every route. (Resolution/bundling succeed; only
//    Hermes runtime trips, which is why `expo export`/`tsc` don't catch it.)
//    The expo client only uses the PURE cookie parsers (parseSetCookieHeader /
//    stripSecureCookiePrefix / SECURE_COOKIE_PREFIX), which live in better-auth's
//    dependency-free `cookies/cookie-utils.mjs`. Redirect the bare
//    `better-auth/cookies` specifier there so the jose/server graph is never
//    bundled into RN.
//    NOTE: coupled to better-auth's internal dist layout (pinned: better-auth
//    1.6.19). If a version bump moves the file, the bundle fails loudly with
//    "module not found" — never a silent runtime regression.
const betterAuthCookiesShim = path.resolve(
  monorepoRoot,
  "node_modules/better-auth/dist/cookies/cookie-utils.mjs",
);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "better-auth/cookies") {
    return { type: "sourceFile", filePath: betterAuthCookiesShim };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// Do NOT disable package exports — Better Auth resolves its modules via exports.
module.exports = config;
