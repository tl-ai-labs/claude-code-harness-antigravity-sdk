# Task: Analyze the service-web scaffold chassis and produce a design for a Kudos Wall feature

## Goal

Read the chassis files of the service-web scaffold to understand the existing structure (module registration pattern, Prisma schema layout, test patterns, platform conventions), then produce a design document for a Kudos Wall feature based on the requirements below.

## IMPORTANT: This is a READ-ONLY stage

Do NOT create, modify, or delete ANY file in the working directory. Your output is ONLY the design analysis printed to stdout. The driver will write the contract file.

## Files to read

Read these files from the working directory to understand the chassis:
- `src/platform/` — all files in this directory (health controller, app structure)
- `src/app.module.ts` — how modules are composed
- `src/modules/index.ts` — the MODULES array pattern
- `prisma/schema.prisma` — the MODEL SLOT marker location and existing models
- `test/platform/` — all test files (to understand testing patterns)

## Requirements to design for

1. FR-1: POST /kudos endpoint for new kudos submissions
2. FR-2: Payload has three string fields: from, to, message
3. FR-3: Validation rules:
   - from: non-empty, non-whitespace-only, max 100 chars after trim
   - to: non-empty, non-whitespace-only, max 100 chars after trim
   - message: non-empty, non-whitespace-only, max 500 chars after trim
   - Invalid → 400 Bad Request, nothing persisted
4. FR-4: Prisma model named `Kudos` appended below MODEL SLOT marker:
   - id: Auto-incrementing integer primary key
   - from: Trimmed sender name (String)
   - to: Trimmed recipient name (String)
   - message: Trimmed message text (String)
   - createdAt: DateTime @default(now())
5. FR-5: GET /kudos returns all kudos
6. FR-6: Ordered by createdAt DESC, ties broken by id DESC
7. FR-7: Returns 200 with JSON array (empty array if none)

## Scaffold constraints

- Only create/modify files in: src/modules/**, src/modules/index.ts, test/modules/**, prisma/schema.prisma (below MODEL SLOT marker)
- Never touch chassis files (package.json, tsconfig, src/main.ts, src/platform/**, test/platform/**)
- Modules are standard NestJS @Module() classes; controllers/services via DI
- Tests use vitest with globals + @nestjs/testing
- Test files go in test/modules/**/*.spec.ts

## Output format

Print your analysis in this EXACT structure (three sections with these exact headings):

```
## Data model

[The Prisma model to append below MODEL SLOT: model name, fields with types, and why each exists traced to FR]

## API

[Every HTTP endpoint: method, path, request/response shape, validation rules, error cases. Trace each to FR(s)]

## Module plan

[NestJS module(s) under src/modules/ — directory name, controller/service/file layout, how each registers in MODULES array, test files under test/modules/]
```

Include specific details:
- For Data model: show the exact Prisma model definition with field types and decorators
- For API: show request/response JSON shapes, HTTP status codes, and validation error behavior
- For Module plan: list every file to create, its role, and the test file(s) that cover it
- Trace every element to the requirement (FR-N) it satisfies
