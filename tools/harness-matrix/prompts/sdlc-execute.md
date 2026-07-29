You are the implementer in stage EXECUTE of an eight-stage SDLC procedure
(REQUIREMENTS → DESIGN → PLAN-PACKETS → EXECUTE → VERIFY → REVIEW → JUDGE →
REPORT). Design and task packets are finalized (below). Your job in this
stage is to IMPLEMENT every packet, in order, by creating/editing files in
the repository — and to leave the scaffold building and testing green.
{{REPAIR_CONTEXT}}
Repository checkout (your working directory): {{WORKDIR}}
Output directory for contract files: {{OUT_DIR}}

HOW TO RUN ANYTHING IN THE REPOSITORY — this machine does NOT have the
repository's toolchain. Every build/test/run command MUST go through the
helper script, which executes it inside the scaffold's containerized
environment (node + pnpm) with your working directory mounted at /app (your
edits are visible to it):

    {{OUT_DIR}}/run-in-env.sh "<command>"

Example: {{OUT_DIR}}/run-in-env.sh "pnpm test"
Dependencies are already installed (node_modules is present); do not run
pnpm install unless you add a dependency — and you must NOT add
dependencies, because package.json is a chassis file you may not touch.

<scaffold_conventions>
{{CONVENTIONS}}
</scaffold_conventions>

The finalized design ({{OUT_DIR}}/design.md):

<design>
{{DESIGN}}
</design>

The task packets to implement, in order ({{OUT_DIR}}/packets.json):

<packets>
{{PACKETS}}
</packets>

Your task:

1. Implement every packet, in the listed order.
2. HARD RULES (a gate checks each of these mechanically):
   - Create/modify files ONLY inside the slots: src/modules/**,
     test/modules/**, and prisma/schema.prisma. Any change to any other
     file — package.json, tsconfig.json, src/main.ts, src/platform/**,
     test/platform/**, vitest.config.ts, prisma/seed.mjs, lockfiles — fails
     the stage.
   - In prisma/schema.prisma, APPEND models below the MODEL SLOT marker
     only; the datasource/generator blocks, AppMeta, and everything above
     the marker must remain byte-identical.
   - Register every NestJS module you create in the MODULES array of
     src/modules/index.ts (that file is inside the slot).
   - Write tests under test/modules/** covering the implemented behavior.
   - Do NOT run any git commit command; leave your edits uncommitted.
3. Verify your work before finishing: run
   {{OUT_DIR}}/run-in-env.sh "pnpm build" and
   {{OUT_DIR}}/run-in-env.sh "pnpm test"
   and iterate until BOTH exit zero — the next stage re-runs them as a gate.
4. When done, write {{OUT_DIR}}/execute.json with exactly this shape:

   {
     "packets_done": ["<every packet id, in the order implemented>"],
     "notes": "<anything the reviewer should know: deviations from a
               files_hint, decisions taken where the design was silent>"
   }
{{ATTEMPT_NOTE}}
