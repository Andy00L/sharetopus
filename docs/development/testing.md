# Testing

## Test Framework

The project does not have a test framework configured. There is no test script in `package.json` and no test runner (Jest, Vitest, etc.) in the dependencies.

## Linting

ESLint is available and can be run with:

```bash
bun lint
```

This runs `next lint` as defined in `package.json`.

The ESLint configuration is in `eslint.config.mjs` and extends two rule sets:
- `next/core-web-vitals`
- `next/typescript`

No additional ESLint plugins or custom rules are configured.

---

[Back to Development](./README.md) | [Back to docs](../README.md) | [Back to project root](../../README.md)
