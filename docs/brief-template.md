# SDLC brief template

The SDLC kind reads a free-text brief from the task directory. The
requirements phase and the design phase both consume it directly — so
the brief is the entire input the harness has to work from.

There is no rigid section outline. The `sdlc-mini` template expects a
brief that:

1. **Starts with an H1 title.** The exporter and the dashboard use it
   as the workload name.
2. **States what the deliverable is.** One or two sentences that a
   reviewer could quote back as "this is what we asked for".
3. **Enumerates the features or endpoints.** The plan-packets stage
   slices these into work packets, one per section.
4. **States what "done" looks like.** The verify stage's build-and-test
   gate will run against this; the judge stage's verdict quotes it.

## A minimal brief

The one shipped as `examples/kudos-wall/brief.md`:

```markdown
# Kudos Wall

Build a small kudos service: a user posts a kudos (who it's from, who
it's for, and a short message), and can list all kudos, most recent
first.

Deliverable: a working software service the client operates themselves.
Cost basis: per project.
```

That is the whole brief. Three lines of body. The kind runs cleanly
because the scaffold (`scaffolds/service-web`) fills in the
infrastructure — NestJS, Prisma, SQLite, Vitest — and the template's
stages know how to slice a small brief into packets.

## A larger brief

For a workload with several modules, spell each out under its own
subheading:

```markdown
# Workforce Ops

A workforce operations service with:

## 1. Employees
- CRUD over employee records with fields: full_name, email, phone,
  address.
- Soft delete (deleted_at).

## 2. Leave requests
- Submit → manager-approve/reject workflow.
- Leave types: annual, sick, unpaid, comp_off with per-type balance
  tracking.
…
```

The plan-packets stage will produce one packet per module. The execute
stage's retry budget is per-attempt across the whole delivery, so a
brief with many modules can exhaust the budget before it finishes —
prefer smaller briefs if you are running on the cheaper policies.

## Pinning the brief hash

`task.json` sits alongside `brief.md`. It carries a SHA-256 of the
brief file:

```json
{
  "task_id": "kudos-wall",
  "template_id": "sdlc-mini",
  "scaffold_id": "service-web",
  "brief": "brief.md",
  "brief_sha256": "26c62f79…"
}
```

When you edit the brief, re-compute the hash:

```bash
sha256sum examples/<your-task-id>/brief.md      # Linux
shasum -a 256 examples/<your-task-id>/brief.md  # macOS — ships no sha256sum
```

The offline test suite (`tasks.test.mjs`) asserts the hash matches on
every task directory; the harness refuses to run if the hash on disk
disagrees with `task.json` at launch. Pinning stops an edited brief
from masquerading as the same task across runs.

## Scaffolds and templates

`scaffold_id` names a directory under `scaffolds/`. The shipped
`service-web` scaffold is a NestJS + Prisma + SQLite + Vitest starter
with a `MODULE SLOT` marker in `src/modules/index.ts` and a `MODEL
SLOT` marker in `prisma/schema.prisma`; the execute stage's packets
append to those slots rather than replacing files. If you want a
different tech stack, add a new scaffold and set `scaffold_id`
accordingly — the SDLC kind checks the required marker files exist at
launch.

`template_id` names a directory under `templates/`. The shipped
`sdlc-mini` template defines the eight-stage walk (requirements →
design → plan-packets → execute → verify → review → judge → report).
A different template can define a different stage walk; the SDLC kind
only requires it to include an `execute` stage.
