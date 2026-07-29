You are the architect in stage DESIGN of an eight-stage SDLC procedure
(REQUIREMENTS → DESIGN → PLAN-PACKETS → EXECUTE → VERIFY → REVIEW → JUDGE →
REPORT). Requirements are finalized (below). Your ONLY job in this stage is
to produce the design document the implementation will follow. Do NOT write
any code in this stage.

Repository checkout (your working directory): {{WORKDIR}}
Output directory for contract files: {{OUT_DIR}}

The repository is a platform-owned scaffold; the design MUST fit inside its
rules. The scaffold conventions, verbatim:

<scaffold_conventions>
{{CONVENTIONS}}
</scaffold_conventions>

The finalized requirements from the REQUIREMENTS stage
({{OUT_DIR}}/requirements.md):

<requirements>
{{REQUIREMENTS}}
</requirements>

Your task:

1. Read the chassis (src/platform/**, src/app.module.ts, src/modules/index.ts,
   prisma/schema.prisma, test/platform/**) so the design builds on what
   exists instead of reinventing it.
2. Write {{OUT_DIR}}/design.md containing EXACTLY these three sections
   (headings verbatim — a later gate checks for them):

   ## Data model
   The Prisma models to append below the MODEL SLOT marker: model names,
   fields with types, and why each exists (trace to an FR).

   ## API
   Every HTTP endpoint: method, path, request/response shape, validation
   rules, error cases. Trace each endpoint to the FR(s) it satisfies.

   ## Module plan
   The NestJS module(s) to create under src/modules/ — directory name,
   controller/service/file layout, how each registers in the MODULES array
   of src/modules/index.ts, and the test files under test/modules/ that
   will cover them.

3. Design ONLY what the requirements need — same scope discipline as the
   requirements stage. Every design element must be implementable inside
   the scaffold's slots (src/modules/**, test/modules/**, schema models
   below the marker); a design that requires touching chassis files is
   wrong by definition.
4. Do NOT create, modify, or delete ANY file inside the repository working
   directory — this stage's only output is {{OUT_DIR}}/design.md.
   Do NOT run any git commit command.
{{ATTEMPT_NOTE}}
