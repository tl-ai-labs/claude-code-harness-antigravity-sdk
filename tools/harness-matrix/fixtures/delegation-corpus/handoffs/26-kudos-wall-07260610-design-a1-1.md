# DESIGN stage analysis — Kudos Wall

You are the architect analyzing a service-web scaffold to produce a design for a "Kudos Wall" feature. This is a READ-ONLY task: do NOT modify any files in the repository.

## What to do

1. Read and report the contents/structure of ALL these chassis files:
   - src/platform/** (every file in this directory tree)
   - src/app.module.ts
   - src/modules/index.ts
   - prisma/schema.prisma (especially the MODEL SLOT marker and the existing datasource/generator blocks)
   - test/platform/** (every file)
   - Also check: package.json for installed dependencies (especially validation libraries, Prisma client setup)

2. Based on what you find, produce a DESIGN REPORT with these three sections:

### Data model
- Show the exact Prisma model "Kudos" to append below the MODEL SLOT marker.
- Fields: id (String, @id @default(uuid())), senderName (String), recipientName (String), message (String), createdAt (DateTime @default(now()))
- Trace each field to FR-1.
- Note any Prisma conventions you observe in the existing schema (e.g. how the datasource is configured, what the MODEL SLOT marker looks like exactly).

### API
- Design two endpoints:
  - POST /kudos: JSON body {senderName, recipientName, message}. Validation: all required, trimmed, senderName/recipientName 1-100 chars, message 1-500 chars, must have non-whitespace. On fail: 400. On success: 201 with {id, senderName, recipientName, message, createdAt as ISO 8601}. (FR-2, FR-3, FR-4)
  - GET /kudos: Returns 200 with JSON array of all kudos, sorted by createdAt DESC then id DESC. Empty = []. (FR-5, FR-6)
- Note how the existing platform handles routing (does app.module.ts set a global prefix? How are controllers mounted?). Report what validation approach is available (are class-validator/class-transformer installed? Or should validation be manual in the service/controller?).

### Module plan
- Design the NestJS module at src/modules/kudos/ with: kudos.module.ts, kudos.controller.ts, kudos.service.ts
- Explain how it registers in the MODULES array in src/modules/index.ts (look at how index.ts currently exports MODULES and what app.module.ts does with it)
- Plan test files under test/modules/kudos/
- Trace to FR-7 (GET /health must show modules_registered: 1)

## Key questions to answer from the chassis

- What does the MODEL SLOT marker look like in prisma/schema.prisma? What's above it?
- How does app.module.ts import and use the MODULES array?
- How does the health endpoint count modules? (Look in src/platform/)
- What dependencies are available? (class-validator? @prisma/client?)
- How do existing platform tests work? (What testing patterns are used?)
- Is there a PrismaService or PrismaModule in the platform that modules should inject?
- What is the exact export shape of src/modules/index.ts?

Report ALL findings so I can write the design document.
