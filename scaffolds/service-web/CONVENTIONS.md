# service-web scaffold — conventions (fed into every codegen packet)

## The one rule

**You may create or modify files ONLY inside these slots:**

- `src/modules/**` — your modules: one directory per module
  (`src/modules/<name>/<name>.controller.ts`, `.service.ts`, `.entity.ts`, …)
- `src/modules/index.ts` — export your NestJS modules in the `MODULES` array;
  the chassis mounts whatever it contains
- `test/modules/**` — your tests, one file per module
- `prisma/schema.prisma` — APPEND domain models below the `MODEL SLOT` marker
  only; never touch the datasource/generator blocks or `AppMeta`

Everything else — `package.json`, `tsconfig.json`, `src/main.ts`,
`src/platform/**`, `test/platform/**`, `prisma/seed.mjs` — is the chassis.
It is sha256-manifested; any change fails the run's integrity check.

## Contracts

- Modules are standard NestJS `@Module()` classes; controllers/services via DI.
- The app must keep building (`pnpm build`) and testing (`pnpm test`) green.
- `GET /health` reports `modules_registered` — your modules count when mounted.
- Standard commands, identical in every run:
  `pnpm install` · `pnpm build` · `pnpm test` · `pnpm start` (port 4000) · `pnpm seed`

## Testing

- Tests run on **vitest with globals enabled** — `describe` / `it` / `expect`
  are available without imports (importing them from `vitest` also works).
- `@nestjs/testing` is installed — `Test.createTestingModule({...})` is the
  supported way to wire DI in specs.
- Everything is TypeScript. Spec files: `test/modules/**/*.spec.ts` (or `.test.ts`).
