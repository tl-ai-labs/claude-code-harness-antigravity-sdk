# Delegation hand-off corpus

Fifty real driver→worker hand-offs, hand-labelled, committed so the delegation
content lint in `../../audit.mjs` has a regression test that runs anywhere.

## Why this exists

`lintDelegationText` answers one question: **did the driver dictate what the
worker typed?** That question has no structural answer. The driver has no
file-edit tools and a pre-tool hook refuses every tree-writing shell command, so
it provably typed nothing — but the hand-off channel is deliberately free text,
and free text can carry a finished function. The only way to know is to read the
hand-offs, and the only way to keep *knowing* is to pin the reading.

Every threshold in the lint was measured on exactly these fifty files. Without
them in the repo, the numbers in `audit.mjs`'s comments are unverifiable claims
about files on one laptop, and a future edit that widens or narrows a rule shows
up as nothing at all. With them, it shows up as a failing test that names the
hand-off it started or stopped catching.

An earlier draft of this test read the hand-offs out of `../../runs/` and skipped
itself when those directories were absent. That is worse than no test: on a fresh
clone, or in CI, it passes by doing nothing. Hence copies.

## What is in here

- `labels.json` — 50 rows, one per hand-off. Each row carries the human label
  (`clean` | `solution-leaked`), the **families the lint produced when the corpus
  was committed**, full provenance back to the run directory it came from, and
  the size metrics used when the thresholds were chosen.
- `handoffs/NN-<target>-<run>-<delegation>.md` — the hand-off text itself.

The ground truth is 44 `clean`, 6 `solution-leaked`. The lint reproduces that
split exactly: 6/6 true positives, 0 false positives. One hand-off additionally
carries a `driver-proxy-shell-command` (a `git checkout -- pnpm-lock.yaml` handed
to the worker); none carries a critical `guard-evasion-by-proxy`.

The margin is one line. The largest non-shell, non-tree fence in a *clean*
hand-off is 8 lines (`30-kudos-wall-07260610-plan-packets-a1-1.md`, a JSON
example); the smallest in a labelled dictation is 9
(`42-kudos-wall-07260637-execute-a1-3.md`). `DICTATION_MIN_LINES = 9` sits in
that gap, and the test re-derives both ends from these files so the constant can
never drift away from the evidence that justifies it.

## Provenance and the immutability rule

These files are **copies**. The run directories under `../../runs/` are the
record of what happened and are never edited, re-audited in place, or otherwise
written to — a corpus that was built by mutating its own source would be worth
nothing. `labels.json` keeps `source.path` so any row can be traced back and
compared against the original.

The copies differ from the originals in exactly one way: the absolute host path
`/home/user/Desktop/<repo>/tools/harness-matrix` was replaced with
`/harness`. That substitution was verified not to change a single lint result —
the builder linted both forms of all fifty files and required identical family
sets before writing anything — and a test asserts no committed file has regained
a `/Users/` path, so the sanitisation cannot quietly come undone.

That one-off builder step now exists as `../../scrub-paths.mjs`, the general
sanitiser every extracted repo runs, covering four host-path shapes instead of
one and applying the same verdict-equivalence gate file by file. It reuses this
`/harness` placeholder deliberately: a second name for the same directory would
leave the published evidence and these published fixtures describing the same
path two different ways. `scrub-paths.test.mjs` asserts the rules are a **no-op**
on all fifty files here — these are already in their final, publishable form, so
extraction copies them through unchanged rather than sanitising them twice.

Nothing else was touched. The hand-offs are otherwise byte-for-byte what the
driver sent, including the six that hand over code, which are kept **because**
they are the finding, not in spite of it.

## Changing the lint

If a change to `audit.mjs` makes `delegation-corpus.test.mjs` fail, the failure
names the file and the family that moved. Read that hand-off and decide which is
wrong — the rule or the label. Then update whichever it is *and say so in the
commit*, because the recorded `families` in `labels.json` are the only thing
standing between a deliberate re-tune and an accidental one.

Adding hand-offs is welcome and cheap: drop the file in `handoffs/`, add its row,
run the test. It fails on an orphan file or an orphan label, so a half-finished
addition cannot slip through.
