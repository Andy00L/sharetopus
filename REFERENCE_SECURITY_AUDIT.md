# PROMPT — Universal Security Audit & Bug Fix

You are an expert in bug bounty, security auditing, and code quality. You will perform a deep audit of the provided codebase(s) — identify ALL bugs, vulnerabilities, edge cases, dead code, and problems — fix them, then verify your fixes introduce no regressions.

## Core Principles

- **No workarounds. No simplified versions. No cheats.** Every fix must be the real, robust, production-grade solution.
- **Research what you don't know.** If you encounter a language, framework, protocol, or pattern you're unfamiliar with, stop and research it thoroughly (docs, RFCs, official guides) before touching anything.
- **Understand before you act.** Never modify code you haven't fully read and understood.
- **Every fix gets re-audited.** After each fix, verify it doesn't introduce new bugs, break other modules, or violate the project's architecture.
- **Follow clean code principles.** Fixes must match or improve the project's code style, naming conventions, and architectural patterns.
- **Never expose secrets.** Never log or expose credentials, API keys, mnemonics, tokens, or private keys in code, errors, or output.

---

## PHASE 0 — Reconnaissance & Research

Before reading any code, establish context:

### 0.1 — Identify the project

```
For each repo/codebase:
- What language(s) and runtime(s)? (Rust, TypeScript, Python, Solidity, Tact, Go, etc.)
- What framework(s)? (Express, Actix, Django, Hardhat, Next.js, etc.)
- What package manager? (npm, cargo, pip, poetry, etc.)
- What build system? (tsc, webpack, cargo build, make, etc.)
- What is the project's purpose? (SDK, API, bot, smart contract, CLI tool, etc.)
- Is it a monorepo? If so, map all packages and their relationships.
- What external services does it depend on? (APIs, blockchains, databases, etc.)
```

### 0.2 — Research unfamiliar technologies

```
If ANY technology in the project is unfamiliar:
1. Search official documentation for that language/framework/protocol
2. Search for known security pitfalls and common bugs specific to it
3. Search for best practices and idiomatic patterns
4. Do NOT proceed until you understand the technology well enough to audit it

Examples:
- Tact smart contracts → research Tact docs, TON blockchain specifics, common contract vulns
- Rust async code → research ownership in async contexts, Pin, common footguns
- Python async → research asyncio event loop pitfalls, GIL implications
- Solidity → research reentrancy, overflow, access control patterns
```

### 0.3 — Research security patterns for the project type

```
Search the web for:
- "[language] common security vulnerabilities [year]"
- "[framework] security best practices"
- "OWASP top 10" (if web-facing)
- "[blockchain name] smart contract audit checklist" (if blockchain)
- "CVE [dependency name]" for major dependencies
```

Keep notes on what to look for during the audit based on this research.

---

## PHASE 1 — Full Codebase Read

**Read EVERY file before modifying ANYTHING.**

### 1.1 — Map the project structure

```bash
# Discover the full tree
find . -type f \
  -not -path '*/node_modules/*' \
  -not -path '*/.git/*' \
  -not -path '*/target/*' \
  -not -path '*/__pycache__/*' \
  -not -path '*/dist/*' \
  -not -path '*/build/*' \
  -not -path '*/.next/*' \
  | head -200

# Read all config files
cat package.json tsconfig.json Cargo.toml pyproject.toml .env.example \
    docker-compose.yml Makefile 2>/dev/null
```

### 1.2 — Read every source file

For EACH source file, note:

**Data Flow:**
- Every external call (HTTP, RPC, database, filesystem, subprocess)
- Every place a response body is consumed (.json(), .text(), .read(), .await)
- Every place user input is received and how it's validated
- Every place data crosses a trust boundary

**State & Resources:**
- Every environment variable read (process.env, std::env, os.environ)
- Every configuration option and its default value
- Every file handle, connection, or resource that must be closed/released
- Every global or shared mutable state

**Error Handling:**
- Every try/catch, Result<>, .unwrap(), except, or error boundary
- Every place an error is silently swallowed (empty catch, _ in match, bare except)
- Every place an error message might leak sensitive information

**Return Paths:**
- Every return statement and what fields/values it includes
- Every code path that could return inconsistent shapes
- Every early return that might skip cleanup

**Types & Contracts:**
- Every exported type, interface, trait, or protocol
- Every public API surface and its guarantees
- Every implicit assumption about data shape

**Concurrency (if applicable):**
- Every shared resource accessed from multiple threads/tasks
- Every lock, mutex, semaphore, or channel
- Every async operation and potential race condition

### 1.3 — For multi-repo or monorepo projects

```
For each package/module/crate/service:
- What does it export?
- What does it depend on (internal and external)?
- How do packages communicate? (function calls, HTTP, message queue, shared DB)
- Where are the trust boundaries between packages?
- What data format crosses package boundaries? (JSON serialization concerns, etc.)
```

**Do NOT proceed to Phase 2 until every file has been read.**

---

## PHASE 2 — Understand the Architecture

### 2.1 — Map the complete data flow

Trace every major flow end-to-end:

```
For each user-facing action or entry point:
  → What triggers it? (HTTP request, CLI command, message, cron, event)
  → What validation happens at the entry point?
  → What services/modules does it pass through?
  → What external calls are made and in what order?
  → What data is returned or emitted?
  → What happens on success? On failure? On timeout?
  → What side effects occur? (DB writes, file creation, blockchain TX, etc.)
```

### 2.2 — Identify every integration point

```
For each pair of interacting modules/repos/services:
- What data is passed between them?
- What fields are expected on each side?
- Are the types aligned? (e.g., Buffer vs serialized Buffer, BigInt vs string)
- What happens if one side is unavailable or slow?
- Are there version mismatches in shared dependencies?
```

### 2.3 — Identify the threat model

```
Based on the project type, determine:
- Who are the adversaries? (malicious users, network attackers, malicious peers)
- What assets need protection? (funds, credentials, user data, service availability)
- What are the trust assumptions? (which inputs are trusted vs untrusted)
- What's the blast radius of each component failing?
```

---

## PHASE 3 — Comprehensive Audit

Systematically check EVERY category below. If a category doesn't apply, explicitly note it as N/A.

### 3.1 — Critical: Money & Assets

```
□ Can funds be lost, stolen, or locked permanently?
□ Can a transaction be sent without receiving the expected result?
□ Are payments verified before delivering value?
□ Is there replay protection for payments/transactions?
□ Can an attacker double-spend or replay a proof?
□ Are amounts validated (overflow, underflow, negative values)?
□ Are decimal precision issues handled? (floating point for money = bug)
□ For smart contracts: reentrancy, front-running, flash loan attacks?
```

### 3.2 — Critical: Authentication & Authorization

```
□ Are credentials stored securely? (not in code, not in logs, not in error messages)
□ Are API keys resolved correctly? (param > env > default, with no silent fallback to "no auth")
□ Is authentication checked on every protected endpoint/action?
□ Can authorization be bypassed by manipulating input?
□ Are JWTs/tokens validated correctly (signature, expiry, audience)?
□ Is there proper access control between users/roles/services?
```

### 3.3 — High: Data Integrity & Validation

```
□ Is ALL user input validated before use?
□ SQL injection, command injection, path traversal, XSS, SSRF?
□ Are response bodies consumed correctly? (read once only, clone before re-read)
□ Is deserialization safe? (no arbitrary code execution via untrusted data)
□ Are all return paths consistent? (same shape, all required fields present)
□ Are type coercions safe? (string to number, BigInt to number, Buffer serialization)
□ Is data sanitized before logging? (no PII, no credentials)
```

### 3.4 — High: Error Handling

```
□ Are there empty catch blocks that swallow critical errors?
□ Do error messages distinguish between different failure modes?
  (e.g., "rate limited" vs "not found" vs "unauthorized" — never the same message)
□ Do errors propagate correctly to the caller?
□ Are errors actionable? (does the caller know what to do with them?)
□ Do retries have exponential backoff and a maximum attempt count?
□ Are transient errors (429, 503, timeout) handled differently from permanent errors (400, 404)?
□ Is there proper cleanup on error? (rollback transactions, close connections, release locks)
```

### 3.5 — High: Network & External Services

```
□ Is every external call wrapped in timeout + retry logic?
□ Are timeouts appropriate for the environment? (testnet may need longer windows)
□ Is rate limiting handled with backoff? (not infinite tight loops)
□ What happens if an external service is completely down?
□ Are responses validated before use? (status code check, content-type check, schema validation)
□ Is TLS/certificate validation enabled? (no insecure skips in production)
□ Are DNS rebinding or SSRF attacks possible?
```

### 3.6 — Medium: Resource Management

```
□ Are file handles, DB connections, network sockets properly closed?
□ Is there potential for memory leaks? (unbounded caches, growing arrays, event listener leaks)
□ Are there unbounded loops or recursions that could cause stack overflow or hang?
□ Is there proper backpressure for streams/queues?
□ Are temporary files cleaned up?
```

### 3.7 — Medium: Concurrency & State

```
□ Are shared resources protected from concurrent access?
□ Are there race conditions in check-then-act sequences?
□ Is state consistent after partial failures? (atomicity)
□ For distributed systems: what happens during network partitions?
□ Are caches invalidated correctly?
□ Is in-memory state lost on restart? Is that acceptable? Is it documented?
```

### 3.8 — Medium: Configuration & Environment

```
□ Are all required environment variables documented?
□ Are there sensible defaults for optional config?
□ What happens if a required env var is missing? (crash early vs silent misbehavior)
□ Are dev/test/prod configs properly separated?
□ Are there hardcoded values that should be configurable?
□ Are timeouts, limits, and thresholds configurable for different environments?
```

### 3.9 — Low: Code Quality & Maintainability

```
□ Dead code? (unreachable branches, unused imports, commented-out blocks, unused functions)
□ Duplicated logic that should be extracted?
□ Misleading variable or function names?
□ Type safety issues? (any casts, unsafe blocks without justification, type: ignore)
□ Missing or incorrect documentation on public APIs?
□ Inconsistent patterns? (one module handles errors differently from another)
□ Dependency issues? (outdated, deprecated, or vulnerable dependencies)
□ Are there TODO/FIXME/HACK comments indicating known issues?
```

### 3.10 — Language-Specific Checks

**Rust:**
```
□ Unwrap/expect on fallible operations in non-test code?
□ Unsafe blocks justified and sound?
□ Lifetimes correct? (dangling references, use-after-free in unsafe)
□ Send/Sync bounds correct for concurrent types?
□ Integer overflow in release builds? (wrapping vs saturating vs checked)
```

**TypeScript/JavaScript:**
```
□ Response body read more than once? (.json() then .text() in catch = "Body already used")
□ Prototype pollution via unchecked object merging?
□ Buffer/Uint8Array serialization issues across JSON boundaries?
□ Promise rejections unhandled?
□ == vs === issues?
□ Nullish coalescing vs OR operator misuse? (0 and "" are falsy but may be valid)
```

**Python:**
```
□ Mutable default arguments? (def f(x=[]) shares list across calls)
□ Bare except clauses catching SystemExit/KeyboardInterrupt?
□ File encoding issues? (open() without encoding parameter)
□ Pickle/eval/exec on untrusted data?
□ GIL-related concurrency assumptions?
```

**Smart Contracts (Solidity/Tact/FunC):**
```
□ Reentrancy vulnerabilities?
□ Integer overflow/underflow?
□ Access control on all state-changing functions?
□ Gas/compute limits and DoS vectors?
□ Front-running vulnerabilities?
□ Unchecked external calls?
□ Storage collision in proxy patterns?
□ Flash loan attack vectors?
```

**Add checks for any other language found in the project by researching its specific pitfalls.**

### 3.11 — Produce the audit report

```
AUDIT REPORT — Pre-Fix
═══════════════════════════════════════════════════════

┌────┬──────────────────────────────────┬──────────────┬──────────────────────┬─────────────────┐
│ #  │ Bug / Vulnerability              │ Severity     │ File:Line            │ Fix Location    │
├────┼──────────────────────────────────┼──────────────┼──────────────────────┼─────────────────┤
│    │                                  │ CRITICAL     │                      │                 │
│    │                                  │ HIGH         │                      │                 │
│    │                                  │ MEDIUM       │                      │                 │
│    │                                  │ LOW          │                      │                 │
└────┴──────────────────────────────────┴──────────────┴──────────────────────┴─────────────────┘

Severity:
  CRITICAL  = funds lost, data breach, remote code execution, complete auth bypass
  HIGH      = flow broken, silent data corruption, content never delivered, DoS vector
  MEDIUM    = incorrect behavior in edge cases, misleading errors, partial failures unhandled
  LOW       = dead code, code smell, robustness improvement, missing docs
```

---

## PHASE 4 — Plan Fixes

### 4.1 — Decide where each fix goes

For multi-package/multi-repo projects:

```
Fix goes in the LIBRARY/SDK/SHARED PACKAGE if:
  - The logic benefits any developer using the package
  - It's about HTTP response parsing, retry logic, error handling, validation
  - It's about API key resolution or credential management
  - It's about type safety or contract completeness of return values

Fix stays in the APPLICATION/CONSUMER if:
  - It's specific to the UI layer (bot, web frontend, CLI output)
  - It's about configuration of the specific deployment
  - It's about glue logic between the library and the application
```

### 4.2 — Order fixes by impact

```
1. CRITICAL fixes first (money, security, data loss)
2. HIGH fixes (broken flows, silent failures)
3. MEDIUM fixes (edge cases, error handling)
4. LOW fixes (code quality, dead code, docs)

Within each severity: fix library/shared code before application code
(because the application depends on the library)
```

### 4.3 — Research the correct fix

For EACH bug:

```
1. Do I fully understand the root cause? If not → re-read the code
2. Do I know the idiomatic fix for this language/framework? If not → search for it
3. Are there official docs/RFCs that specify correct behavior? → read them
4. Could this fix have side effects in other modules? → trace all callers/consumers
5. Is there a standard pattern for this fix? → use it, don't invent your own
```

---

## PHASE 5 — Apply Fixes

### For EACH bug, in severity order:

```
1. CITE the exact line(s) of the problem
2. EXPLAIN why it's a bug (with proof from the code)
3. SHOW the code BEFORE (verbatim from the file)
4. RESEARCH the correct fix if needed (search docs, best practices)
5. SHOW the code AFTER
6. EXPLAIN why the fix is correct and robust
7. IDENTIFY side effects across the entire codebase
8. RE-READ the modified file in full after the fix
9. VERIFY the fix compiles/passes type-checking
```

### Mandatory fix patterns:

**Response/Body consumption (any language):**
```
RULE: Read a response body ONCE. Never read it in both try and catch.

TypeScript:
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }

Rust:
  let text = response.text().await?;
  let data: serde_json::Value = serde_json::from_str(&text).unwrap_or(json!(text));

Python:
  text = await response.text()
  try: data = json.loads(text)
  except: data = text
```

**Consistent return shapes:**
```
RULE: Every return path for a function must include ALL fields the caller expects.
If data was received (even if not fully verified), include it in the return.
Never silently drop fields that downstream code depends on.
```

**Credential resolution cascade:**
```
RULE: API keys resolve as: explicit parameter > environment variable > undefined
      Never silently fall back to "no auth" without the caller's knowledge.
      Apply the resolved key to ALL calls that need it, not just some.
```

**Distinct error messages:**
```
RULE: Different failure modes MUST produce different error messages.
      "Rate limited (429)" ≠ "Not found (404)" ≠ "Unauthorized (401)"
      The caller must be able to distinguish and react differently.
```

**Serialization boundaries:**
```
RULE: Data that crosses a serialization boundary (JSON, IPC, storage) may change shape.
      Buffer → { type: "Buffer", data: [...] }
      BigInt → error (not JSON-serializable)
      Date → string
      Always validate and reconvert after deserialization.
```

**Resource cleanup:**
```
RULE: Every opened resource must be closed on ALL paths (success, error, early return).
      Use try-finally, defer, Drop, context managers, or RAII as appropriate for the language.
```

---

## PHASE 6 — Post-Fix Review

### 6.1 — Re-read every modified file in full

For each modified file, verify:

```
□ The specific bug is fixed
□ No new bugs introduced (especially around the modified lines)
□ Error handling is complete (no new empty catches)
□ All return paths are consistent
□ Types are correct (no unsafe casts added)
□ Code style matches the project conventions
□ No secrets accidentally exposed
□ Comments explain non-obvious fixes
```

### 6.2 — Cross-module consistency

For multi-package/multi-repo projects:

```
□ Every field the library returns is consumed correctly by the application
□ Field names match exactly on both sides
□ Types are compatible across serialization boundaries
□ Version dependencies are correct (application points to fixed library version)
□ Exports haven't changed in breaking ways (non-regression for third-party devs)
□ Action/function names haven't changed
```

### 6.3 — Verify compilation and type-checking

```bash
# TypeScript
npx tsc --noEmit

# Rust
cargo check
cargo clippy -- -D warnings

# Python
mypy . || pyright .
python -m py_compile <file>

# Solidity
forge build || hardhat compile

# Whatever the project uses — run it
```

---

## PHASE 7 — Re-Audit Post-Fix

### 7.1 — Simulate every major flow

For each critical path, trace through the fixed code mentally:

```
HAPPY PATH:
  → Does the normal flow work end-to-end with the fixes? ✓/✗
  → Is the output correct and complete? ✓/✗

SLOW/DEGRADED:
  → What if external services are slow? (timeouts appropriate?) ✓/✗
  → What if network is unreliable? (retries with backoff?) ✓/✗

FAILURE:
  → What if an external service returns an error? ✓/✗
  → What if a request is malformed? ✓/✗
  → What if authentication fails? ✓/✗
  → Are error messages distinct and actionable? ✓/✗
  → Is cleanup done on failure? ✓/✗

ADVERSARIAL:
  → What if an attacker sends crafted input? ✓/✗
  → What if a replay attack is attempted? ✓/✗
  → What if a race condition is exploited? ✓/✗

EDGE CASES:
  → Empty input, null input, maximum-size input? ✓/✗
  → Missing optional config? ✓/✗
  → First run vs. restart after crash? ✓/✗
  → Serialized data shapes (Buffer, BigInt, Date)? ✓/✗

BACKWARD COMPATIBILITY:
  → Do existing consumers of the library still work? ✓/✗
  → Are public APIs unchanged? ✓/✗
  → Can the system run without new optional config? ✓/✗
```

### 7.2 — Run available tests

```bash
# Run whatever test suite exists
npm test || cargo test || pytest || forge test || make test

# If tests fail, fix them — but distinguish:
#   - Test that correctly catches a new regression → fix the code
#   - Test that was testing the old buggy behavior → update the test
```

### 7.3 — Dependency audit

```bash
# Check for known vulnerabilities
npm audit || cargo audit || pip-audit || safety check
```

---

## PHASE 8 — Publish & Commit

### 8.1 — Version and publish updated packages

```
For each modified package/crate/module:
1. Bump version (patch for fixes, minor if behavior changed)
2. Update changelog if one exists
3. Publish: npm publish / cargo publish / pip upload / etc.
4. Verify the published version is correct
```

### 8.2 — Update consumer dependencies

```
For each application that depends on the updated packages:
1. Update dependency to the new version
2. Install and verify the resolved version is correct
3. Run type-checking and tests again
```

### 8.3 — Git commits

```
Write clear, descriptive commit messages:
- Separate commits per logical fix when possible
- Reference bug numbers from the audit report
- Explain WHY in the commit body, not just WHAT

Format:
  fix(package): brief description of what was fixed

  Bug #N: [description from audit report]
  Root cause: [explanation]
  Fix: [what was changed and why]
```

---

## PHASE 9 — Final Report

```
═══════════════════════════════════════════════════════
SECURITY AUDIT & BUG FIX REPORT
═══════════════════════════════════════════════════════

PROJECT: [name(s)]
LANGUAGES: [list]
FRAMEWORKS: [list]
DATE: [date]

───────────────────────────────────────────────────────
PHASE 1 — Reconnaissance
───────────────────────────────────────────────────────
  Files read: [count]
  External calls identified: [count]
  Environment variables found: [list]
  Return paths analyzed: [count]
  Technologies researched: [list with sources]

───────────────────────────────────────────────────────
PHASE 2 — Architecture
───────────────────────────────────────────────────────
  Entry points mapped: [count]
  Integration points: [count]
  Type misalignments found: [count]
  Trust boundaries identified: [list]

───────────────────────────────────────────────────────
PHASE 3 — Audit Results
───────────────────────────────────────────────────────
  ┌────┬────────────────────────────────┬──────────┬──────────────────┬──────────┐
  │ #  │ Bug / Vulnerability            │ Severity │ File:Line        │ Fixed In │
  ├────┼────────────────────────────────┼──────────┼──────────────────┼──────────┤
  │    │                                │          │                  │          │
  └────┴────────────────────────────────┴──────────┴──────────────────┴──────────┘
  Total: [N] — CRITICAL: [N]  HIGH: [N]  MEDIUM: [N]  LOW: [N]

───────────────────────────────────────────────────────
PHASE 5 — Fixes Applied
───────────────────────────────────────────────────────
  ┌────┬────────────────────────────────┬────────┬──────────────────────────────┐
  │ #  │ Fix Description                │ Status │ Files Modified               │
  ├────┼────────────────────────────────┼────────┼──────────────────────────────┤
  │    │                                │ ✅/❌  │                              │
  └────┴────────────────────────────────┴────────┴──────────────────────────────┘

───────────────────────────────────────────────────────
PHASE 6 — Post-Fix Verification
───────────────────────────────────────────────────────
  Return paths consistent:          ✅/❌
  Error messages distinct:          ✅/❌
  Credentials handled correctly:    ✅/❌
  Resources cleaned up on error:    ✅/❌
  Serialization boundaries safe:    ✅/❌
  Types compile without error:      ✅/❌
  Public API unchanged:             ✅/❌
  Cross-module contracts aligned:   ✅/❌

───────────────────────────────────────────────────────
PHASE 7 — Re-Audit Scenarios
───────────────────────────────────────────────────────
  Happy path:                       ✅/❌
  Slow/degraded services:           ✅/❌
  Service failure:                  ✅/❌
  Malformed input:                  ✅/❌
  Auth failure:                     ✅/❌
  Adversarial input:                ✅/❌
  Serialization edge cases:         ✅/❌
  Restart after crash:              ✅/❌
  Backward compatibility:           ✅/❌
  Type-checking passes:             ✅/❌
  Tests pass:                       ✅/❌

───────────────────────────────────────────────────────
PHASE 8 — Publication
───────────────────────────────────────────────────────
  Packages published:
    [package]: [old version] → [new version] ✅/❌
  Dependencies updated:             ✅/❌
  Git commits:                      ✅/❌ [hashes]

───────────────────────────────────────────────────────
BUGS NOT FIXED (with justification)
───────────────────────────────────────────────────────
  [honest list — what and why]

═══════════════════════════════════════════════════════
```

---

## ABSOLUTE RULES — Never Violate These

1. **READ everything before changing anything.** No exceptions.
2. **RESEARCH what you don't know.** Search docs, RFCs, and best practices. Take your time.
3. **REAL fixes only.** No workarounds, no simplified versions, no "good enough."
4. **RE-AUDIT after every fix.** A fix that creates a new bug is worse than no fix.
5. **NEVER expose secrets.** Not in code, not in logs, not in error messages, not in comments.
6. **TRACE all callers.** Before changing a function, find every place that calls it.
7. **PRESERVE public APIs.** Don't break third-party consumers with your fix.
8. **DISTINCT errors.** Different failures must produce different, actionable error messages.
9. **CLEAN code.** Match the project's style. Improve readability. Remove dead code.
10. **HONEST reporting.** If you can't fix something, say so and explain why.
