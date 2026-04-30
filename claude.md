Code Quality Rules — What's in Place

We've got 22 automated rules that block bad code from being committed. Here's what they do, in plain language.

━━━━━━━━━━━━━━━━━━━━━━━━

"Keep files small and focused"
Long files are hard to read, hard to test, and hide bugs. We cap the size:
• Files can't exceed 350 lines (we aim for under 200)
• Background workers (small focused jobs) can't exceed 80 lines
• Functions can't exceed 50 lines
• Nesting (how many if-inside-if-inside-if) can't go deeper than 3 levels
• Complexity score — measured two ways (cyclomatic + cognitive) — has a hard ceiling. If a function has too many decision points or is too mentally taxing to follow, you have to split it.

Why it matters: Smaller pieces are easier to fix, easier to test, and easier for a new engineer to understand on day one.

━━━━━━━━━━━━━━━━━━━━━━━━

"Don't use type escape hatches"
TypeScript catches whole categories of bugs at compile time — but only if you actually use it properly.
• No any — the cheat code that turns off type checking. Banned everywhere, no exceptions.
• No ! (non-null assertion) — the "trust me, this isn't null" override. Banned.
• No eval — running text as code. Classic security hole. Banned.

Why it matters: These three patterns are the most common source of "it worked locally but crashed in production" bugs. We just don't allow them.

━━━━━━━━━━━━━━━━━━━━━━━━

"Catch problems, don't hide them"
• No silent error swallowing — empty catch blocks (where errors are caught and ignored) are banned.
• No console.log anywhere — even in tests and scripts. We use a real logger.
• No undated TODOs — every TODO/FIXME comment must reference a ticket like ZUM-1234, so they don't rot in the codebase forever.
• No "I'll fix the rule later" comments in code — rules live in one place (CLAUDE.md), not scattered across files.

Why it matters: A swallowed error is a bug that takes 6 months to find. A console.log left in production leaks data. A TODO without a ticket gets forgotten.

━━━━━━━━━━━━━━━━━━━━━━━━

"Organize files by purpose, not convenience"
• Banned junk-drawer names — utils.ts, helpers.ts, common.ts, shared.ts, misc.ts, index.ts. These names invite "I'll just dump it here for now" and become unmaintainable swamps.
• Role-based file naming — files ending in .repository.ts only talk to the database, .service.ts only orchestrate logic, .client.ts only call external APIs, .validator.ts only check rules. Each file has one job.
• Database access is restricted — only files ending in .repository.ts can touch Prisma. Only files ending in .cache.ts can touch Redis. This means a UI component physically cannot accidentally query the database.
• Layer separation — UI components can't import from server-only code. The server can't import from UI components. Data types can't pull in runtime code. The dependency arrows only go in the allowed directions.
• No deep relative imports — ../../foo/bar/baz is banned. Use the @/ shorthand which is robust to file moves.

Why it matters: When every file has a clear single purpose, finding the right place to add a new feature becomes obvious. When boundaries are enforced, "spaghetti dependencies" can't form.

━━━━━━━━━━━━━━━━━━━━━━━━

"Functions stay simple"
• Max 4 parameters per function. If a function needs more, it's doing too much — split it or pass an object.

Why it matters: Functions with 7 parameters are impossible to call correctly without re-reading the function every time.

━━━━━━━━━━━━━━━━━━━━━━━━

"Security baseline"
• No hardcoded secrets — API keys, passwords, tokens, database URLs with credentials, or third-party hostnames. All must come from environment variables. Even in test files (we use placeholder values that don't pattern-match real keys).

Why it matters: A secret accidentally committed to git is a secret leaked forever, even if you delete the commit. We block it at the source.

━━━━━━━━━━━━━━━━━━━━━━━━

"Every file has tests"
• Test colocation — every code file must have a matching .test.ts file next to it. No untested code gets in.

Why it matters: Tests are how we know a feature still works after a refactor. A file without tests is a file that will silently break.

━━━━━━━━━━━━━━━━━━━━━━━━

"The rules can't be tampered with"
• Integrity check — every rule file is fingerprinted. If anyone (or any AI) edits a rule to make it weaker, the build breaks until the change is explicitly authorized.

Why it matters: Code quality only stays high if the rules can't be quietly relaxed. This makes "I'll just turn off this one rule for now" mechanically impossible.

━━━━━━━━━━━━━━━━━━━━━━━━

What Else Is in the Pipeline

These run alongside the 22 rules whenever someone tries to commit:
• ESLint — catches dozens of TypeScript patterns the language itself allows but that cause bugs
• Duplicate detection — flags any chunk of code that's been copy-pasted (>5 lines) and tells you to extract it
• Dependency check — finds files no one imports (dead code) and circular dependencies
• Type checker — validates the entire codebase compiles cleanly
• Test coverage — requires 100% line / branch / function / statement coverage
• Build — confirms the production build succeeds

━━━━━━━━━━━━━━━━━━━━━━━━

How It's Enforced

Three gates, each one stricter than the last:
1. Pre-commit — when you save changes, the rules run on the changed files. If they fail, the commit is blocked.
2. Pre-push — when you push to GitHub, the entire codebase is re-checked. If anything anywhere fails, the push is blocked.
3. AI guardrail — a separate hook prevents AI assistants from using bypass flags (--no-verify, --force) to skirt the checks. If the AI tries, the command is denied before it runs.