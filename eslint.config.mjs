import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Flat config as documented for Next.js 16 (nextjs.org/docs/app/api-reference/config/eslint).
// eslint-config-next 16 exports flat configs; wrapping them in FlatCompat
// crashed with "Converting circular structure to JSON".
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next, restated because globalIgnores overrides them.
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Throwaway probes and the standalone x402 smoke client (outside tsconfig too).
    ".scratch/**",
    "scripts/x402-smoke/**",
  ]),
]);

export default eslintConfig;
