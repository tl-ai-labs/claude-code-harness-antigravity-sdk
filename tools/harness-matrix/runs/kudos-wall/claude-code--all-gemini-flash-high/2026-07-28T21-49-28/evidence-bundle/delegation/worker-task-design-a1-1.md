# Task: Analyze the service-web scaffold chassis for Kudos Wall design

You are in the DESIGN stage of an SDLC procedure. Your job is READ-ONLY: analyze the existing scaffold chassis and report your findings. Do NOT modify any files.

## What to read

Read and analyze these chassis files in the working directory:

1. `src/platform/` — all files in this directory (list them, read each one)
2. `src/app.module.ts` — the root NestJS module
3. `src/modules/index.ts` — the slot file where modules are exported
4. `src/main.ts` — the application bootstrap
5. `prisma/schema.prisma` — the Prisma schema (note the MODEL SLOT marker)
6. `test/platform/` — all test files in this directory

## What to report

After reading all files, produce a structured report with:

### A. Chassis structure
- What modules/providers does `app.module.ts` import?
- How does the health endpoint work? What does it count for `modules_registered`?
- How does `src/modules/index.ts` work — what is the MODULES array pattern?
- What is the bootstrap setup in `main.ts`?

### B. Prisma schema
- What is the current schema content?
- Where exactly is the MODEL SLOT marker?
- What is the datasource/generator configuration?

### C. Test patterns
- How are platform tests structured?
- What testing utilities/patterns are used?
- How is the NestJS test module created?

### D. Design recommendations for Kudos Wall
Based on what you found, recommend:
1. The exact Prisma model to append (fields, types, decorators) — trace each field to FR-1/FR-3
2. The file layout under `src/modules/kudos/` (which files, what each contains)
3. How the KudosModule registers in the MODULES array
4. How the controller should structure POST /kudos and GET /kudos endpoints
5. How validation should work (manual, no class-validator)
6. How tests should be structured under `test/modules/`
7. How the service layer should use PrismaService for database access

**IMPORTANT: This is a READ-ONLY analysis stage. Do NOT create or modify any files. Only read and report.**
