import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Ban `x as Error` casts: they silently produce `undefined` (rendered as the
// literal "undefined") when a non-Error is thrown. Use `errorMessage(e)` from
// @lumio/shared for messages, or narrow with `e instanceof Error`.
const banAsError = {
  selector: "TSAsExpression[typeAnnotation.typeName.name='Error']",
  message:
    "Don't cast to Error — use errorMessage(e) from @lumio/shared, or narrow with `e instanceof Error`.",
};

// API routes must not query Prisma directly (injecting `prisma` as a `db`
// argument is fine — that's an identifier value, not a member access).
const banPrismaInRoutes = {
  selector: "MemberExpression[object.name='prisma']",
  message:
    "Don't query Prisma directly in a route — call a service/@lumio/db function. (Injecting `prisma` as a `db` argument is fine.)",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", banAsError],
    },
  },
  {
    // API routes additionally ban raw Prisma queries. Flat config REPLACES a
    // same-key rule rather than merging arrays, so re-include `banAsError` here.
    files: ["src/app/api/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", banAsError, banPrismaInRoutes],
    },
  },
]);

export default eslintConfig;
