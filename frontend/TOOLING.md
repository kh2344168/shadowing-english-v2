# Frontend Tooling Policy

Approved tooling:

- Angular CDK — runtime dependency, but import only the specific CDK feature needed by a lazy-loaded feature.
- Tailwind CSS — build-time styling pipeline; keep utility CSS in `src/tailwind.css`.
- SCSS — component-specific styles and complex scoped styling.
- ESLint — development/CI only; never part of the production browser bundle.
- Prettier — development/CI only; never part of the production browser bundle.
- Playwright — E2E development/CI only; browser binaries and reports must never be deployed to production hosting.

## Production deployment rule

Deploy only the built frontend output (`dist/...`) plus the backend `dotnet publish` output and required runtime configuration.
Do NOT deploy:

- `node_modules/`
- Playwright browser binaries
- `playwright-report/`
- `test-results/`
- source tests
- development caches

## Performance rule

Installing a dependency does not justify importing it globally. Runtime packages are measured when first used. CDK features must remain feature-scoped/lazy where possible. No Angular Material dependency is implied by using Angular CDK.
