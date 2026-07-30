# Methodology

This page is about **what the harness actually proves** and **how the
enforcement works**. Read it before citing any result from a run — the
distinction between the two claims below is load-bearing.

## Two claims, not one

### Claim 1 — PROVENANCE

> Every delivered byte was authored by the Gemini worker process.

**Mechanically enforced.** Three independent layers agree on the same
predicate, and the offline test suite exercises all three.

### Claim 2 — ATTRIBUTION

> Gemini did the engineering thinking.

**Not enforceable. Not claimed.**

The driver-to-worker channel is free text — the only interface the
Antigravity SDK offers. Free text can carry a finished function. When
the driver writes out the code it wants and the worker types it in,
provenance is perfectly satisfied and attribution is a fiction.

The delegation content lint (below) measures how much dictation shows
up in a run's hand-offs. It is deliberately conservative — it fires on
code fences of 9+ non-blank lines, or on explicit dictation phrasing.
A hand-off that describes the implementation precisely in prose passes
clean.

**Bottom line for citations.** SWE-bench Pro hand-offs read clean under
both the lint and a human pass — the delegated engineering claim there
is defensible. SDLC hand-offs invite the driver to specify, and a human
reading finds dictation more widespread than the lint's count. Cite
SDLC as evidence that the *cable* works end-to-end, not as evidence
that Gemini did the design work.

## The three enforcement layers (claim 1)

### Layer 1 — the driver's tools are removed

In `tools/harness-matrix/runtimes.mjs`, every delegated cell's `claude`
invocation carries:

```
--disallowedTools Edit Write NotebookEdit MultiEdit
```

These are not the model being asked not to edit. They are absent from
the tool list the process is given, so there is no call it can emit
that the CLI would route to a file write.

Additionally closed for **every** cell: `WebFetch`, `WebSearch`, `Task`.
Web access would let a model fetch the real upstream fix for a
SWE-bench Pro instance; `Task` would spawn a subagent whose tool set
the guard does not govern.

The driver still has `Bash` — removing it would break the harness (it
has to run tests and inspect the repo to decide anything). Bash can
write files. That is what layer 2 is for.

### Layer 2 — the PreToolUse guard hook

A hook is registered on the `claude` process that runs **before** a
tool call executes and can deny it:

| Matcher | What it does |
|---|---|
| `Bash` | Denies any command that writes into the working tree |
| `Read` | Enforces delegate-first ordering — the driver is told what it is and what it must do before it starts reading |
| `Grep\|Glob` | The same, for search |

The denial message names the situation ("You are the DRIVER in a
delegated cell and …") so the model's next action is to delegate
rather than to try a different shell incantation.

### Layer 3 — the post-run audit

`tools/harness-matrix/audit.mjs` reads the recorded trajectory and the
hand-off files and produces flags. `critical: true` means: had the
scaffold not sealed this channel, the attempt would have leaked the
solution or tampered with the grade. **A critical flag voids the
instance in the report.**

Trajectory families (partial list, full list in `audit.mjs`):

| Family | Critical | What it catches |
|---|---|---|
| `git-history-mining` | **yes** | `git log/show/diff/rev-list/…` reaching past the sealed base — a route to the commit that fixed the bug |
| `source-host-fetch` | **yes** | `curl`/`wget`/`git fetch` against github.com, gitlab.com, bitbucket.org. Package registries deliberately not matched. |
| `driver-direct-edit` | no | The driver writing the tree via Bash. Should be impossible — the guard denies it. A flag here means the guard was bypassed. |
| `delegation-policy-mismatch` | **yes**/no | The run's actual delegation behaviour disagreeing with the resolved policy. |

### The predicate is one function, shared

The hook and the post-run audit **share the same predicate function**
— `bashEditsTree(command, {workdir, outDir})` in `audit.mjs`. The hook
does not reimplement it; `runtimes.mjs` generates the hook script with
a literal `import` from `audit.mjs`.

That import is the whole design: the thing that blocks a command at
run time and the thing that judges the recorded trajectory afterwards
are the same function. They cannot disagree, drift apart, or be
tightened in one place and left loose in the other.

`guard.test.mjs` and `audit.test.mjs` both exercise it.

## The delegation content lint (claim 2)

`lintDelegationText` in `audit.mjs` answers one question: **did the
driver dictate what the worker typed?** Four families:

| Family | Critical | Fires when |
|---|---|---|
| `driver-dictated-code` | no | A non-shell, non-tree code fence of 9+ non-blank lines |
| `driver-dictation-phrasing` | no | Explicit dictation language in the prose |
| `driver-proxy-shell-command` | no | The hand-off carries a shell command for the worker to run |
| `guard-evasion-by-proxy` | **YES** | The hand-off contains a command **the guard already denied to the driver** |

`guard-evasion-by-proxy` is the only critical family here. It is a
correlation between the guard's denial log and the hand-off text, and
it is dispositive: the driver was blocked, then asked the worker to
run the blocked command on its behalf.

### The 9-line threshold

```js
export const DICTATION_MIN_LINES = 9;   // audit.mjs
```

Across the 50-hand-off labelled corpus committed under
`tools/harness-matrix/fixtures/delegation-corpus/`:

- The **largest** non-shell code fence in a hand-off a human labelled
  **clean** is **8 lines**.
- The **smallest** in a hand-off labelled **solution-leaked** is
  **9 lines**.

At 9, the lint reproduces the human labelling exactly:
**6/6 true positives, 0 false positives.**

`delegation-corpus.test.mjs` runs the lint over all 50 committed
hand-offs and asserts the result matches `labels.json` exactly. Change
the threshold, widen a regex, or add a family, and the test fails and
names the file whose verdict moved.

### What the lint cannot see, stated plainly

- **Prose dictation.** A hand-off that describes the intended
  implementation precisely in English, with no code fence, passes
  clean. Not closable by pattern matching.
- **Short dictation.** An 8-line function passes by construction.
- **`guard-evasion-by-proxy` cannot be raised from a bundle alone.**
  It needs the trajectory's denial ordering, which the exported
  bundles do not include. Every published `lint.json` says so in its
  own `critical_note` field.

## Reading the results honestly

- Cite provenance freely — it's mechanically enforced.
- Cite attribution only after reading the actual hand-offs and forming
  your own judgment. The lint is a signal, not a verdict.
- For an SDLC workload, treat the delivery as "worker-authored,
  driver-influenced-to-some-degree" — the exact degree is a manual
  read.
- For a SWE-bench Pro workload, the REPRO → LOCALIZE → PATCH prompt
  shape leaves the driver less room to specify implementations; the
  attribution claim is stronger there.
