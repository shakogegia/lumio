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

// Do NOT disable package exports — Better Auth resolves its modules via exports.
module.exports = config;
