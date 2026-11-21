import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Flat config as documented for Next.js 16 (nextjs.org/docs/app/api-reference/config/eslint).
// eslint-config-next 16 exports flat configs; wrapping them in FlatCompat
// crashed with "Converting circular structure to JSON".
const USE_EFFECT_BANNED_MESSAGE =
  "useEffect is banned. Derive the value during render, handle it in the event handler that causes it, reset state with a key, or move the work to a server component or action. For a system React does not own, use useSyncExternalStore or a ref callback that returns its cleanup.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value='react'] > ImportSpecifier[imported.name='useEffect']",
          message: USE_EFFECT_BANNED_MESSAGE,
        },
        { selector: "MemberExpression[property.name='useEffect']", message: USE_EFFECT_BANNED_MESSAGE },
      ],
    },
  },
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
