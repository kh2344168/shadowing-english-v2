# Self Review — Tooling Addition

**Date:** 2026-09-22
**Scope:** Angular CDK + ESLint + Prettier + Playwright + Tailwind/SCSS integration

## Rules review

### PASS — No architecture rule broken
- Backend remains source of truth.
- No business logic was added to startup/login/refresh.
- No secrets were added.
- Student/Admin priority unchanged.
- Modular Monolith rule unchanged.
- Vertical-slice production rule unchanged.
- Offline/Workbox decision remains open; no Workbox package was added.
- Angular Material was not added.

### PASS — Performance and hosting
- ESLint and Prettier are dev-only.
- Playwright is dev/CI-only. Its large browser binaries are intentionally excluded from hosting artifacts.
- Tailwind and SCSS are build-time tooling; production gets generated CSS.
- Angular CDK is the only newly approved runtime library; it must be imported selectively and measured when actually used.
- Production bundle budgets are present as an initial guard, but they remain provisional until the first real baseline per approved rules.

### PASS — Tailwind + SCSS conflict avoided
Tailwind v4 is placed in a separate global `tailwind.css` entry using the PostCSS plugin. Component-specific styling remains `.scss`. This avoids trying to run Tailwind directives through Sass and preserves the approved styling boundaries.

## Criticism / remaining limitations

1. **Dependencies are declared/configured, not installed in this artifact.**
   - No `node_modules` is included by design.
   - The real machine still needs `npm install` and a generated lockfile.

2. **Build/lint/E2E have not been honestly marked as passing yet.**
   - They require dependency installation.
   - BUILD_PROGRESS keeps V2 Foundation as IN PROGRESS.

3. **Angular CDK can increase runtime bundle size if abused.**
   - Mitigation: import only exact CDK feature modules inside the lazy feature needing them and measure the chunk.

4. **Playwright consumes substantial disk space in dev/CI.**
   - This does not affect production hosting if browser binaries/reports are excluded, which is now documented and gitignored.

5. **Initial bundle budget values are only safeguards, not final performance contracts.**
   - Approved rules require baseline measurement before making a number a hard gate.

6. **Angular 21 LTS is used as the scaffold baseline rather than silently upgrading to Angular 22.**
   - This aligns with the existing V1/V2 direction and reduces migration risk during the 5-day rebuild.
   - A future Angular major upgrade should be explicit, not accidental.

## Result

**Tooling structure: APPROVED-SAFE TO CONTINUE, with dependency installation/build verification still pending.**

## Corrections made during self-critique

- Removed provisional `maximumError` bundle budgets from `angular.json`. The approved rules explicitly say hard performance gates must wait for a measured baseline; keeping an arbitrary hard error threshold would have contradicted that rule.
- Removed unused `@angular/animations` and `@angular/platform-browser-dynamic` runtime dependencies from the initial scaffold. They can be added only if a real feature requires them.
