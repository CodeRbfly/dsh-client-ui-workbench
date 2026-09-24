# 需求执行工作台 — Requirements Execution Workbench

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) web client
plugin that adds a **需求执行工作台** (Requirements Execution Workbench) tab next
to the built-in 对话轨迹 (Trajectory) tab, structured around a
`需求 → 方案 → 开发 → 测试 → 提版`
(Requirement → Design → Develop → Test → Release) pipeline.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Dependencies: 0](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#offline-installation)
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](package.json)
[![Platform](https://img.shields.io/badge/platform-web%20client%20plugin-informational.svg)](#how-it-works)

**English** · [简体中文](README.zh.md)

---

## What this is

A **requirements execution workbench** inside the DSH web GUI. It carries requirements
through a five-stage pipeline and keeps every artifact as plain files in the workspace,
so the state is diffable, reviewable and shared through git.

- **Requirements** — parallel requirements, each with an id generated as
  `XQ<yyyymmdd>-<nnnn>`. Upload a `.docx` and its text is extracted **in the browser**
  (no host dependency), kept per version, and diffable against the previous one.
  **You are not shown the extracted text.** Importing immediately hands the document to
  the AI in the current conversation, which reads it and writes an analysis —
  what the ask actually is, the systems and data it touches, the feature points at
  executable granularity, the risky parts, and the questions the document leaves open —
  into `Pipeline/需求/analysis/<version>.md`, and that analysis is what the page shows.
  **Feature points are filled in for you, and grouped into a tree**: the same run also writes
  `analysis/<version>.points.json`, and the workbench merges those points into the
  requirement page (same name = same point, so re-running never duplicates).
  The analysis **prefers the bundled skill `requirement-doc-reader`** (installed into
  `$DSH_HOME/skills/` when the plugin loads): it spells out how to read a requirement
  document — how to tell a single document from one Word file that carries several systems
  and several revision-record tables, how to pull only *this* requirement's changes by the
  highlight colour declared on its own revision-record row, how to tell a **new feature**
  (the whole block shares one colour) from a **changed feature** (only part of the block is
  coloured, the uncoloured text being what is already implemented), and what granularity a
  feature point should have. It is a **soft dependency**: if it cannot be loaded the generic
  instructions take over, but the AI is told to **say "the skill was not used this time"** in
  its summary so that failure never happens silently. The install location is fixed, and a
  user-authored skill of the same name is always left untouched. Each point
  carries a **requirement block** (`group`) taken from the document's own module structure,
  and the page renders them as a two-level tree — block → feature point — because a hundred
  flat rows tell you nothing about which module you are looking at or whether a whole block
  was missed. Blocks collapse, can be renamed (every point in the block moves with it), and
  new points can be added straight into a block. The two block dropdowns are **not** the
  same on purpose: the one on a feature-point **row** lists **only blocks that already
  exist** — it answers "which block does this point belong to", not "invent a category" —
  while the one in the **add row** at the bottom ends with **+ New block**, and picking it
  grows a text box **between the block dropdown and the assignee dropdown**: type the name,
  press **Add feature point**, and the block and its first point are created together (no
  empty block is ever left behind). Both dropdowns carry an empty **hidden placeholder**
  entry: without it, a requirement with no blocks yet makes the browser display *+ New block*
  as the current value while picking it changes nothing — the real reason "new block does
  nothing" kept coming back. Points whose analysis carried no block and
  whose name shows no module land in *Ungrouped*, which sits last and says how to file them.
  Every version row has its own **AI analysis** button (which becomes *Refine* once an
  analysis exists — the instruction says to continue from it rather than start over),
  and a **Delete** button that removes the document, its text *and* its analysis
  together (feature points stay — they may already be assigned and designed against).
  Clicking a version shows **that version's** analysis. *View source* unfolds the
  extracted text when you want to check the analysis against it. The raw text is never
  thrown away, it just no longer comes first.
- **Version comparison (two versions at once)** — pick any two versions and you get both
  the **document diff** and the **analysis diff**, plus a sanity check: a version number
  that jumped a major step while the text barely moved is almost always *the wrong file
  uploaded* (or the same file twice), and a text that changed a lot while the analysis
  barely moved means the analysis was probably made against the old text. Both thresholds
  are deliberately conservative, because one false alarm and nobody reads the warning again.
- **No requirement ↔ session binding** — every AI action (document analysis, drafting a
  design, the summary, each stage's artifacts) is sent into **the session you are currently
  using**. The plugin never creates a session for you and never switches the one you are in:
  which session you work in is your decision, not the requirement's. Requirements do not
  bleed into each other anyway — each one's artifacts live under its own folder and every
  instruction the plugin sends carries absolute paths.
- **One subagent per module** — the instructions for 需求 / 方案 / 开发 / 测试 / 提版 each
  require the AI to do the work in a subagent pinned to that one module, with upstream
  stages read-only. The five modules interlock (design reads requirement, develop reads
  design, …), and a single omniscient context drifts into "helpfully" editing upstream
  files — the hardest kind of change to trace afterwards.
  Clarifications are held as a Q&A list.
- **Key dates** — release / test-freeze / go-live, with live countdowns in the header.
  The order is enforced (`release < freeze < go-live`).
- **Developers** — one requirement supports several people. Each is a tag, and
  **design / develop / test are per-person pipelines** while **requirement and release
  are shared**. Feature points can be assigned to a person. The first person in the list is
  the **lead**, and the role can be handed over — but only by the current lead.
- **Two separate edit rights** — **your own design is editable only by you**; everyone else
  opens it read-only. **The design summary is editable only by the lead**; everyone else
  reads it. They are judged differently (the first by “is this my pipeline”, the second by
  “am I the lead”), so they are two rules, not one switch.
- **Design (per person)** — the design text, impact analysis, task breakdown, **backend API
  list**, **frontend page list** and the **generated design document** live under
  `Pipeline/方案/<developer>/`. **The AI drafts the text from the requirement**: clicking
  *Draft with AI* sends an instruction — with the target paths and artifact shapes written
  into it — into the current conversation, and the AI there writes the files with its own
  file tools. The page refreshes itself when it finishes; you then edit in place, keep a
  version snapshot, or diff against the latest one. **The API and page lists are structured
  tables** you can add to, edit and delete row by row: a real design has to answer “which
  backend APIs change or get added, and which frontend pages change or get added”, and prose
  is something nobody can edit later and nothing downstream can reference. They are also the
  AI's writing order: **lists first, text second** (the text is the narrative version of them).
- **Design document (rendered from a template)** — *Generate design document* renders the
  lists, the text, the impact analysis and the tasks into **a document you can hand over**:
  **generate first, save second** (missing fields are listed right there — after writing it
  is too late), or *Copy all* and paste it into the process system. Templates live at the
  workbench root under `templates/<stage>/` (**one set for the whole workbench**, not per
  requirement) and fall back to a built-in default; *write the built-in template to
  `templates/方案/`* gives you a file with the right placeholders so the company template can
  be pasted in. There are exactly three placeholder forms (`{{field}}`, `{{#each}}`,
  `{{#if}}`) and nested loops are deliberately unsupported; a field with no value renders as
  “（待补：path）” and is listed as a gap — **missing content has to be visible**. The
  generated file carries a header line (which template, when, which data sources) and is
  simply overwritten on regeneration.
- **Design summary (one shared file)** — when collaboration starts the lead needs the
  **overall development concept** first. *Summarize designs* has the AI read **everyone's**
  design and produce a cross-cutting view: a per-person comparison table, disagreements
  (naming who disagrees with whom), **coverage gaps** (who has not written a design yet),
  dependency order, total effort, and a risk roll-up. The page also lists each person's task
  count and person-days as plain data, so gaps are visible even before a summary exists.
  **The summary is editable only by the lead**; everyone else reads it.
- **Develop / Test / Release (three stage pages)** — each has three artifacts, one per menu
  entry on the pipeline: **Develop** = change list / commit log / self-test;
  **Test** = test cases / run results / defects; **Release** = version / changelog /
  release notes. Develop and Test are per person (only the owner can edit), Release is a
  shared pipeline. Every page has *Have the AI write this stage* — the AI reads the upstream
  stages first, then writes these three; Develop additionally has a per-task ***Run*** and Test
  a per-case ***Run*** (see the next two bullets). **These are not three bespoke pages**: they are one
  declaration table plus one renderer, so adding a stage or a block is one row, and the page,
  the storage paths, the status derivation and the AI instruction all follow.
- **“My tasks” on the Develop page** — lists the tasks the design assigns to you and shows
  each one's execution state. A task has exactly one definition (in the design's
  `tasks.json`), and **its state is derived from the Develop page's own change list**: no
  change linked = not started, linked but unfinished = in progress, all linked changes
  ticked = done. So each page owns one end — Design owns *what to do*, Develop owns *what was
  done* — and two disagreeing copies of the state cannot exist. Besides “not started yet”, it
  names the **feature points that have no task at all** — those never show up on the Develop
  page otherwise, which makes them the easiest thing to drop. Both name lists are rendered as
  **counted tag groups**, not as one comma-joined sentence: 33 task names in a sentence is a
  wall nobody reads.
  Every task row carries a ***Run*** button. It opens the exact instruction about to be sent —
  which design files to read, that only this one task is in scope, and what `taskId` the change
  row must carry — and **you can edit it before sending**. The dialog exists because sending is
  the irreversible step: the AI starts editing code the moment it goes out. *Run* is shown only
  on your own pipeline. The instruction makes the AI append one change row per edit and add
  self-test items, so the state you see afterwards is still derived, never asserted by the AI;
  new rows arrive unticked because ticking them off is the developer's own review, and if the
  workspace holds no codebase the AI is told to say so rather than invent file paths.
- **Every test case row has a *Run* too** (placed before *Remove*) — it makes the AI run that one
  case and **write the result back into the files**: the case's result becomes pass / fail with a
  note saying what was actually checked, a run record is appended, and a defect is filed on
  failure. Only rows that can meaningfully be *run* have the button (run records and defect
  records do not); which block gets it is declared by one `execute` line in `STAGE_BLOCKS`, so
  the renderer never learns a stage name.
  **If it cannot run the case it must say so**: the instruction requires the AI to name what is
  missing and leave the result pending. Inventing a pass is the worst outcome — it turns a case
  nobody verified into green evidence, and nothing on the page shows it. Test cases have no id,
  so the instruction locates the row by *name + expected + ordinal* together and tells the AI to
  stop and ask when they do not match or are ambiguous.
- **Switching away and back does not re-read** — what was read **survives the component
  unmounting** (a small in-memory, browser-local cache), so reopening a block shows content
  immediately and re-reads in the background. Saving does not blank the screen either: the
  page keeps what is on screen and swaps it when new data arrives. Measured: each RPC costs
  1.5–3 ms and opening the tab is 16 requests totalling under 40 ms, so “slow” is almost
  always a loading-state artefact rather than actual waiting. **Any write clears the cache** —
  better to read once more than to show stale content — and switching requirement or person
  clears it too, because then the old data belongs to someone else.
- **Status does not lie** — pipeline badges come from real artifacts: Develop counts as
  approved only once every change is ticked and every self-test passes; Test only once every
  case passes and no defect is left open; Release only once a version and notes exist. An
  **empty** design stays grey even if someone clicks *Finalize*.
- **Read-only by identity** — you enter your name once; you can edit only your own
  pipeline, everyone else's is view-only.
- **Overdue handling** — a requirement marked done whose go-live date has passed raises
  a bell notification and is auto-archived three days later if untouched. Archiving sets
  `archivedAt` in `requirement.json` and **leaves the folder where it is**; archived
  requirements stay reachable from a searchable dropdown and can be restored.
- **Deleting a requirement (irreversible, and it asks twice)** — under *More actions* in the
  requirement list. It is not the same thing as archiving: archiving is a flag you can undo,
  deleting removes **the whole requirement folder** — source documents, extracted text, every
  analysis, feature points, design notes, test records — and nothing keeps a copy afterwards.
  So it sits on its own in the menu in the error colour, and pressing it **replaces the whole
  menu with a confirmation screen**: the other actions are not in the DOM at that moment, so
  they cannot be hit by accident. The screen names the id and title and spells out the cost,
  and a failure keeps the screen open with the error rather than vanishing.

Everything lands under `docs/requirements/` in the workspace — see
[`docs/storage-format.md`](docs/storage-format.md) for the layout and the rules that
keep concurrent git work conflict-free.

## Highlights

- **Zero dependencies.** No `dependencies`, no `devDependencies`, no lockfile, no
  `node_modules`. The browser bundle is hand-authored and the only module it requires is
  `react`, which the DSH shell already provides.
- **Installs fully offline.** No npm, no pnpm, no registry. See
  [Offline installation](#offline-installation).
- **No build step.** Edit `lib/client.js` and the host hot-swaps it within about half a
  second — no restart, no page refresh.
- **Self-verifying.** `npm test` runs 624 assertions — bundle form, slot registration,
  locale-key completeness, component render smoke, theme-token validity, the pure
  business rules, offline readiness — plus an end-to-end install/uninstall test. No DSH,
  no browser, no network.
- **Collaboration-ready storage.** One file per independently-edited thing, so two people
  working on the same requirement do not collide in git.
- **Bilingual** (`zh` / `en`), styled entirely from DSH design tokens so light and dark
  themes both work.

## Requirements

| | |
|---|---|
| DSH | `0.1.5-rc.1` or later, with the `web` profile initialised |
| Node.js | `>= 20` (installer and test scripts only — not used at runtime) |
| OS | Windows, macOS, Linux (the installer is cross-platform Node) |

The plugin uses only `react`, which the DSH web shell already provides in its
module table at runtime. That is why nothing needs to be downloaded.

---

## Installation

### Offline installation

This is the path for air-gapped machines, and it is the reason this project has
no dependencies. **Nothing is fetched during installation.**

**On a machine that has the source** (a git checkout, or a downloaded release
archive), build the offline artifact:

```bash
npm run pack:offline
```

That produces, deterministically:

```
dist/dsh-client-ui-workbench-0.1.0.tgz
dist/SHA256SUMS.txt
```

#### Was DSH itself installed from the setup .exe?

Then Node may not be on PATH at all, and `tools/install.mjs` needs it. Use
`tools/install.ps1` instead — **plain Windows PowerShell, no Node, no npm**:

```powershell
powershell -ExecutionPolicy Bypass -File tools\install.ps1 -DryRun   # print the plan, write nothing
powershell -ExecutionPolicy Bypass -File tools\install.ps1           # actually install
```

It does the same job: resolve `$DSH_HOME` (`-DshHome` > `$env:DSH_HOME` > `~\.dsh`), find the
profile holding `cordis.patch.yml` (defaults to `web`, otherwise auto-detected under
`profiles\`), copy the package into `profiles\node_modules\`, **back up the patch layer**, then
append one host row; running it twice does not add a second row. **It never deletes anything.**

The important part: the plugin is installed only under `$DSH_HOME` and **never touches DSH's own
program directory**, so it makes no difference whether DSH came from the .exe, from npm, or
anything else. `$DSH_HOME` defaults to `%USERPROFILE%\.dsh` unless `DSH_HOME` is set.

Flags: `-DshHome <path>`, `-Profile <name>`, `-Source <unpacked dir>`, `-DryRun`.

**Carry the `.tgz` to the target machine and unpack it first** — that machine has no checkout,
and the installer itself lives inside the archive:

```bash
# verify integrity
sha256sum --check SHA256SUMS.txt        # Windows: certutil -hashfile <file> SHA256

# unpack, then enter package/
tar -xzf dsh-client-ui-workbench-0.1.0.tgz
cd package

# optional but recommended: run the contract self-check locally
# (needs no DSH, no browser, no network)
node tools/verify.mjs

# install — defaults to the current directory; no network, no npm
node tools/install.mjs
```

**★ Installing onto a machine for the first time requires one DSH restart.**
The host half (`index.js`) is loaded at boot and it is what registers `/api/rpc/workbench`.
Without the restart the tab does appear, but every read and write fails (HTTP 404) —
**it looks broken when it is only one restart away**.

| How DSH was installed | How to restart it |
|---|---|
| **from the setup .exe** | **quit the app (tray icon / Start menu) and start it again** — simplest and reliable |
| **from npm (there is a `dsh` command)** | `tools\restart-host.ps1` — it finds the pid that owns the listening port |

`restart-host.ps1` **only applies to an npm-installed DSH**. On an .exe install it finds no
`dsh` entry point and says so, telling you to quit and relaunch instead of failing silently.

After that, refresh `http://127.0.0.1:3080`: the 需求执行工作台 tab should appear to the
right of 轨迹. Later changes to `lib/client.js` need no restart (the host hot-swaps it in
about half a second).

The installer is ~400 lines of plain Node using only built-in modules
(`node:fs`, `node:zlib`, and a minimal ustar reader in `tools/lib/tar.mjs`). It
never invokes `npm`, `pnpm`, or `dsh plugin`.

Prebuilt artifacts are attached to every
[GitHub Release](https://github.com/OWNER/dsh-client-ui-workbench/releases) —
that is the intended download for offline users.

Useful flags:

```bash
node tools/install.mjs --dry-run            # print the plan, write nothing
node tools/install.mjs --skip-verify        # do not probe localhost for the boot graph
node tools/install.mjs --skip-contract      # do not run the contract self-check
node tools/install.mjs --tarball ../dsh-client-ui-workbench-0.1.0.tgz   # read the archive directly (no unpack needed)
node tools/install.mjs --dsh-home /path/.dsh --profile web
node tools/install.mjs --help
```

### From a checkout

```bash
git clone https://github.com/OWNER/dsh-client-ui-workbench.git
cd dsh-client-ui-workbench
node tools/install.mjs
```

On Windows, `.\deploy.ps1` is a thin wrapper over the same script.

### What the installer does

1. Runs the offline contract self-check (`tools/verify.mjs`) and aborts if it fails.
2. Copies the package into `$DSH_HOME/profiles/node_modules/dsh-client-ui-workbench/`.
3. Backs up the profile's `cordis.patch.yml`, then appends a managed,
   sentinel-delimited `insert:` block naming the plugin.
4. Probes `http://127.0.0.1:3080` to confirm the host composed the plugin into
   the browser boot graph. A host that is not running is a warning, not a failure.

Order matters: the package is placed **before** the patch layer is touched, so
the loader never sees a row whose package is missing.

---

## Verify it worked

Three levels, cheapest first. None require clicking in the browser.

**1. Contract self-check** — no DSH, no browser, no network, no writes:

```bash
npm run verify
```

**2. The host composed the plugin** into `window.__DSH_BOOT__`:

```bash
node tools/probe.mjs
```

Exit code `0` means the entry is present, `1` means the host is up but the
entry is missing, and `2` means the host could not be reached.

The probe is **auth-aware**. If the web UI sits behind an authentication
plugin (such as `dsh-webui-auth`), an unauthenticated request follows
`GET / → 302 /?token=… → 303 / + Set-Cookie`, and a plain
`fetch(url, { redirect: 'follow' })` keeps no cookies — so it loops until it
throws `redirect count exceeded`, which looks like "the host is down" when it
actually means "you are not logged in". The probe carries a cookie jar and
works in both cases.

The entry looks like:

```json
{"id":"dsh-client-ui-workbench","url":"/plugins/??dsh-client-ui-workbench/client.js&rev=<nonce>-<n>","rev":"<nonce>-<n>"}
```

**3. The bundle is actually served:**

```bash
curl -sI 'http://127.0.0.1:3080/plugins/??dsh-client-ui-workbench/client.js&rev=<rev-from-step-2>'
# expect: 200, content-type: text/javascript; charset=utf-8
```

Finally, open `http://127.0.0.1:3080` and press **F5**. The header should read
`对话 | 轨迹 | 需求执行工作台`.

---

## Uninstall

```bash
node tools/uninstall.mjs
```

This removes the managed patch-layer block and the package directory. It is
idempotent, and it removes the block **surgically** — other plugins' rows in the
same patch layer are left untouched. A dry run is available with `--dry-run`,
and `--keep-patch` removes only the package directory.

---

## The pipeline

Two stages are shared, three are per person:

```
需求 Requirement   capture the ask as acceptable items        ┐ shared
提版 Release       assemble changes, version, release notes   ┘
方案 Design        settle the approach and change list        ┐
开发 Develop       implement, keeping commits revertible      │ per person
测试 Test          developer self-testing and debugging       ┘
```

- **Shared stages** — `需求` and `提版` belong to the requirement as a whole.
- **Per-person stages** — `方案`, `开发`, `测试` are tracked separately for every
  developer in the list. The dropdown at the top-right of the **Developers** box selects
  whose pipeline you are viewing, and the pipeline display follows it.
- **Only your own is editable.** Your name is asked once on first open and stored in
  `$DSH_HOME/workbench/identity.json`. Viewing someone else's pipeline is read-only.
- **测试 means developer self-testing**, not formal QA — formal testing runs in a separate
  system after release.

Stage status comes from `deriveStageStatus(meta, developer, stageStates)` in `lib/client.js`.
It only **assembles**; the judging lives in `designStageStatus()` / `stageVerdict()`, so it
never needs to know the shape of any artifact — change an artifact and this function stays put.

**All five stages now carry real status**: whenever the artifacts can be read the status comes
from them (content = in progress, the stage's completion conditions met = approved), and only
an unreadable stage falls back. The single remaining placeholder rule is "a design with no
artifacts yet, whose developer has assigned feature points, counts as in progress".

### The design page: the AI drafts, you edit

The body of a design should not be hand-typed from scratch. The loop is:

1. Click *Draft with AI*. The plugin sends an instruction into **the current conversation**
   containing the requirement id, the requirement files to read, the destination paths of
   the five artifacts, and the field shapes of the four JSON files.
2. The AI in that conversation reads the requirement and writes the files with **its own
   file tools**. The plugin calls no model and holds no API key — it just hands the work to
   the AI you are already talking to.
3. When the session goes from *running* back to *idle* the page **re-reads itself**, and
   the draft appears. No polling: a half-written file read mid-flight misleads more than
   seeing it a few seconds later does.
4. Edit in place, save, keep a version snapshot, or diff against the latest version. The
   task breakdown can be seeded in one click from the feature points assigned to you.

This rides the platform channel `ctx.sessions.scope(id).conversation.send(text)`. When the
send cannot happen (a blank session has no session scope yet) the instruction is **shown
for you to paste by hand**, so the feature never just goes dead.

#### The two change lists, and the generated deliverable

What a design has to answer in practice is *"which back-end interfaces do we add or change,
and which front-end pages do we add or change"*. That is two **row-editable lists**, not a
long article — inside a wall of prose nobody can change one interface, the AI can only
rewrite the whole thing, and nothing downstream can reference it:

- `apis.json` — source feature point · task no. · interface name · method · path · add/change ·
  request · response · note
- `pages.json` — source feature point · task no. · page name · route · add/change · page
  regions · key interactions · note

Both reuse the same row-table component as the other stages. Two deliberate choices:
**`change` is free text, not a dropdown** (a dropdown's default turns "not decided yet" into
a definite answer — that is inventing data on the user's behalf), and **`（路径待确认）` is a
legal value** (with no codebase to modify, "which interfaces must be added" is the honest
answer, and a plausible-looking invented path is worse than a blank).

Those lists are what **Generate design document** renders. It is a three-step, deliberately
unsplit flow: **generate → preview (missing fields are listed then and there) → copy the full
text *or* write the file**. Templates live one level above requirements, at
`<workspace>/docs/requirements/templates/方案/方案文档.md`, and are shared by the whole
workbench. Full placeholder contract and the template syntax:
[`docs/document-generation-plan.md`](docs/document-generation-plan.md).

**Summarize designs** is another use of the same channel, and the difference is the reader:
drafting is the AI writing *my* design, summarizing is the AI showing the *lead* the whole
picture. So that instruction asks for cross-cutting comparison and explicitly **forbids the
AI from editing anyone's design files** — "helpfully rewriting someone else's draft" is the
most dangerous way this action can fail. The result is one **shared** file,
`Pipeline/方案/汇总.md`: always shown on the page (including while you are viewing someone
else's pipeline), and editable in place. Its only writer is the lead — one document, one
owner, which is exactly the kind of sharing the collaboration rule allows.

## Storage and collaboration

All state is plain files under `<workspace>/docs/requirements/`:

```
<reqId>/
├── requirement.json              shared scalars (title, status, dates, developers)
├── feature-points/<id>.json      one file per feature point
├── clarifications/<id>.json      one file per Q&A
├── documents/<version>.json      one file per document version
├── pipelines/<developer>.json    one file per person
└── Pipeline/                     everything pipeline-related
    ├── 需求/{source,parsed,analysis}/
    │                              original .docx · extracted text · per-version AI analysis (.md + .points.json)
    ├── 方案/汇总.md               one shared file, written by the lead
    ├── 方案/<developer>/           draft.md · versions/ · impact.json · tasks.json
    │                              · apis.json · pages.json  (the two change lists)
    │                              · 方案文档.md             (generated deliverable, do not hand-edit)
    ├── 开发/<developer>/           changes.json · commits.json · selftest.json
    ├── 测试/<developer>/           cases.json · runs.json · defects.json
    └── 提版/                      release.json · changelog.md · notes.md
```

Document templates are **not** per requirement — one set serves the whole workbench, so
they live at the workbench root: `<workspace>/docs/requirements/templates/<stage>/`.
See [`docs/document-generation-plan.md`](docs/document-generation-plan.md).

The rule that makes this safe for concurrent git work:

> **The same datum has exactly one writer; data written by different people lives in
> different files.**

A git conflict is "two branches changed the same place in the same file". Satisfy the
rule above and a shared requirement needs no lock, no merge tool and no custom merge
driver. The corollary matters just as much: **anything that should differ per user never
goes in this directory** — your identity and the overdue-notice timers live in
`$DSH_HOME`, and which pipeline you are viewing lives in browser storage.

### Overdue notices are per user

"Who first noticed this requirement went overdue" is not a fact about the requirement, it
is a fact about you. So the notice timer and its read state live in
`$DSH_HOME/workbench/notices.json`, next to your identity — both written **once and never
overwritten**. Put them in the shared file instead and every user's first look at the
workbench rewrites the same line, which is a collision on any day two people open it.

The timer is still inherited from the shared file on first sight, so the three-day window
does not restart just because someone else opened the board.

### Archiving is a flag, not a move

Archiving writes `archivedAt` in `requirement.json` — **the folder never moves**. That is
deliberate, and it removes three problems at once:

- git does not store renames, so moving the folder would be recorded as a batch of
  deletions plus a batch of additions, and `git log -- <path>` would never line up again;
- one person archiving while another edits a file inside would be the one conflict no
  convention can avoid (`CONFLICT (modify/delete)`). With a flag the two touch disjoint
  files and merge cleanly;
- on Windows `rename` fails outright (`EPERM`/`EBUSY`) whenever anyone has a `.docx` open
  in Word or a virus scanner is reading the directory.

Three rules come with it: `archivedAt` non-empty means archived; it is **written once and
never overwritten** (otherwise every workbench open would re-stamp every archived
requirement); and a missing or corrupt `requirement.json` counts as **active** — show a
requirement rather than silently swallow it.

Archived by an older build? Migrate once with `node tools/migrate-history.mjs` (dry run by
default, `--apply` to execute).

[`docs/storage-format.md`](docs/storage-format.md) has the per-field conflict analysis,
the target layout and the migration plan. The array → directory migration for
`feature-points` / `clarifications` / `documents` is **not implemented yet**.

## How it works

### The host half is not a no-op here

Most client UI plugins have an empty host `apply()`. This one does not: **a browser cannot
read the disk**, and the workbench is fundamentally a view over files. So the host half
registers one exact HTTP route and owns all file I/O:

```
POST /api/rpc/workbench
{ type: 'client-request', rpcId, method: 'rpc/workbench',
  payload: { op, sessionId?, args? } }
```

Two alternatives were tried and rejected — both are documented in `index.js`:

- **Typert Remote** (`@Remote` namespaces) cannot be added out-of-tree: the client half
  mounts a hard-coded static import list, and the `/api` interceptor is single-owner and
  already claimed by the gateway.
- **A new top-level prefix** (say `/workbench`) is **not protected**: `dsh-webui-auth`
  hard-codes `PROTECTED_PREFIXES = ['/api', '/plugins']`.

An exact Fetch route under `/api` is matched *before* the gateway interceptor, and
inherits both the Host/Origin fence and the browser login — so the plugin does no
authentication work of its own. Every path the client can address is confined to one
requirement folder.

A DSH client plugin is a **dual-face package**: one npm package with a Node half
and a browser half.

```
① package sits in $DSH_HOME/profiles/node_modules/<name>/
        │
        │  a row in cordis.patch.yml mounts it onto the host loader
        ▼
② the loader imports the host half: index.js  (here: the RPC route + file I/O)
        │
        │  @deepseek-ai/dsh-client-modules scans the loader's *rows*
        │  (it does not scan the filesystem)
        ▼
③ it finds dsh.client.platform === "web"
  and exports["./client"] → lib/client.js
        │
        │  the bundle bytes are composed into the boot graph
        ▼
④ window.__DSH_BOOT__ = { entries: [ { id, url: "/plugins/??<pkg>/client.js&rev=...", ... } ] }
        │
        │  the browser boots each entry: loader.create({ name })
        ▼
⑤ the browser fetches the bundle with <script async src=...>;
   executing it does exactly one thing:
   window.__ModuleLoader__.load({ id, factory })
        │
        │  factory materializes on first import and returns { apply, inject }
        ▼
⑥ cordis runs apply(ctx) in the browser
        │
        │  ctx.slots.inject('conversation.view', () => ctx.slots.register({...}, View))
        ▼
⑦ ui-conversation projects the slot roster into tabs
   → 需求执行工作台 appears in the header
```

Three consequences worth internalising:

1. **Being present in `node_modules` is not enough.** There must be a host row
   mounting it (step ②).
2. **The host and the browser are two separate cordis worlds.** The same
   package has a half in each. `index.js` is the Node half (for a UI plugin,
   usually empty); `lib/client.js` is the browser half (the actual UI).
3. **A tab is created only by
   `ctx.slots.register({ name: 'conversation.view', ... })`.**
   `ctx.uiConversation.views.register(...)` is a different mechanism — it
   registers a Conversation *data builder*, not a tab. This plugin does not
   need it.

---

## The contract

Hard constraints, verified against DSH `0.1.5-rc.2`. Breaking any of them
produces a white screen or a silent no-show. `npm run verify` checks them all.

### `package.json`

```jsonc
{
  "name": "dsh-client-ui-workbench",   // ① equals the browser module id, verbatim
  "type": "module",
  "main": "index.js",                  // ② host half; the loader row resolves through it
  "exports": {
    ".": "./index.js",
    "./client": { "default": "./lib/client.js" },  // ③ browser half; missing it is a hard throw
    "./package.json": "./package.json"
  },
  "dsh": {
    "client": {
      "platform": "web",               // ④ must be exactly "web"; other values are ignored silently
      "inject": [ /* package names, not service names */ ]
    }
  }
}
```

### `index.js` (host half)

Registers one exact `/api/rpc/workbench` Fetch route through
`ctx.connection.fetch.register()` and implements the ops on `node:fs/promises`: layout,
requirement addressing, document and version files, archive/restore, and identity.

It needs `inject = ['connection', 'sessions', 'sandboxPolicy']`, and **must not export a
plain-object `Config`.** cordis calls `Config["~standard"].validate(...)`; a plain object
has no `~standard`, which throws
`TypeError: Cannot read properties of undefined (reading 'validate')` and fails the
**entire plugin tree**, taking `dsh web` down with it. Use a `@deepseek-ai/schemastery`
schema, or export no `Config` at all.

### `lib/client.js` (browser half)

```js
window.__ModuleLoader__.load({
  id: 'dsh-client-ui-workbench',   // must equal the package name
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    /* ... all side effects live in here ... */
    exports.apply = apply;
    exports.inject = inject;       // cordis *service* names, not package names
    return module.exports;
  }
});
```

| Rule | Consequence of breaking it |
|---|---|
| Must be a classic script — no top-level `import`/`export`, no top-level `await` | Loaded via `<script async src>`; ESM syntax is a `SyntaxError` |
| Only `load(...)` at the top level; all side effects (including style injection) inside the factory | Executing the script only registers; the factory materializes lazily, exactly once |
| `require()` may only name a baseline module, or a package declared in `dsh.client.external` that has a supplier | Otherwise: `require("...") missed the module table` |
| The factory must return `apply`; every name in `inject` must exist | A missing service leaves the entry pending → `web boot: N entries did not activate` → **the whole GUI white-screens** |

**The baseline module table** (DSH `0.1.5-rc.2`, exactly nine — a whitelist):

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-ui-dockkit
```

This plugin requires only `react`.

### Tab registration

```js
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'workbench',
  order: 20,                          // ascending: chat = 0, trajectory = 10
  locale: NS,
  label: () => t('view.workbench'),   // a thunk, so it follows language switches
}, WorkbenchView));
```

- **`slots.inject` is required**; registering directly can run before the
  declaring plugin (`ui-conversation`) has mounted.
- `conversation.view` is a `list` slot with `session` scope. The component
  receives:
  - owner props: `viewRequest`, `openView(view, focus)`, `completeViewRequest()`
  - session standard props: `sessionId`, `useSession`, `useProjection`
  - global standard props: `useSessions`, `useSessionPendingInteraction`, `useWorkspaces`
  - `t` only if `locale:` is declared; `useStore`/`actions` only if `store:` is
    declared; `use<Name>` hooks from an `inject:` callback
- **The header hides the tab strip when there are fewer than two tabs.** With
  chat + trajectory already present, a third appears.
- A new tab is **never auto-selected**; the default stays on chat.

---

## Extending: adding features to a stage

The single extension point is the `STAGES` array in `lib/client.js`. Four ways
to make a placeholder real, in increasing cost:

### 1. A real panel, no backend

Add a selected-menu state to `WorkbenchView` and dispatch on
`(stage.id, menu.id)`:

```js
const menuState = react.useState(null);
const activeMenu = menuState[0];
// render: activeMenu === null ? the menu grid : the concrete panel
```

Data lives in memory only. Good for validating the interaction first.

### 2. Per-session persistence, no backend

Add `store:` to the slot registration, using `@deepseek-ai/dsh-client-store`
(a baseline module, so it can be required directly):

```js
ctx.slots.register({
  name: 'conversation.view',
  id: 'workbench',
  order: 20,
  locale: NS,
  store: workbenchStore,          // now the component gets useStore / actions
  label: () => t('view.workbench'),
}, WorkbenchView);
```

The component gains `useStore(selector)` and `actions`. Use a namespaced
persist key such as `dsh.workbench`.

### 3. Read existing session data, no backend

The component already receives session state:

```js
const running   = useSession((s) => s.running);
const openState = useSession((s) => s.openState);   // 'cold' | 'loading' | 'open' | 'error'
const queued    = useSession((s) => s.queue.length);
```

Other available sources, contributed by other plugins (present at runtime, but
note their types are conditional): `useConversation` (assembled conversation
snapshot), `useInput` + `inputActions` (composer draft/queue/submit),
`useTrajectory` (trajectory data, from `ui-trajectory`), `useProjection`
(host-computed projection values).

To relate requirement items to tool calls or todos, reading `useProjection` or
`useTrajectory` is the cheapest route — no backend required.

### 4. Real read/write, needs a host capability

If the workbench must own its own data, share it across sessions, or drive the
agent, it needs host-side support. Three options:

1. **A custom tool writing a workspace file.** Add a tool plugin
   (`defineTool` + `ctx.tools.register`) that reads and writes something like
   `requirements.json`; the workbench observes the result through session
   events. **Cheapest; start here.**
2. **A host HTTP route.** Register `ctx.webServer.register(...)` in the host
   half and call it with `fetch` from the browser. Good for structured CRUD.
   Mind DSH's authenticated prefix.
3. **A cordis service.** `ctx.provide('workbench', ...)` in the host half plus
   an `isolate` realm on the row. Heaviest; only worth it for multi-consumer reuse.

### Cross-tab navigation

The owner `openView` callback switches tabs (demonstrated in the scaffold):

```js
openView('trajectory', '');   // second argument is the target tab's own focus identity
```

Conversely, `viewRequest` lets another tab jump into the workbench; call
`completeViewRequest()` when handled.

---

## Development

**Which half you changed decides how it takes effect — and they are not the same.**

| Changed | How it lands |
|---|---|
| `lib/client.js` | The host polls the bundle and hot-swaps it in about half a second. No restart, no refresh. |
| `index.js`, `package.json` | **Restart `dsh web`.** Module reload is opt-in: the `hmr` row ships `disabled: true`, and `patchReload: live` only reloads *config*, never an already-imported module. |
| A row in `cordis.patch.yml` | Live-reloaded by the host. No restart — **except when re-introducing an entry that was previously removed**, see the troubleshooting table. |
| Adding a **brand-new** plugin | The page's boot graph is fixed at load time — **F5 is required**. |
| A **new host op** in `index.js` | Restart. Ops are registered at boot, so an old host answers `workbench/unknown-op`. |

Use `tools/restart-host.ps1` (or `tools/restart-host.cmd`); it finds the listening pid itself.

Handy while working on the host half: `node tools/rpc.mjs <op>` calls any workbench op
straight from the shell, so you can check the file channel without opening a browser at all.
Pass arguments through a file (`--args-file`), never inline: PowerShell eats the quotes.

Not sure which document to read? [`docs/README.md`](docs/README.md) is the index.

```bash
npm run verify     # contract verification — no DSH, no browser, no network, no writes
npm run selftest   # end-to-end offline install/uninstall against a throwaway DSH home
npm test           # both
```

`selftest` fabricates a DSH home in a temp directory and exercises the real
installer: pack → install from tarball → install again (idempotence) →
uninstall → install from directory → dry-run → uninstall. It asserts in
particular that patch-layer surgery never damages **other** plugins' rows.

### The edit loop

Minimum loop while iterating on the UI:

```bash
cp lib/client.js "$DSH_HOME/profiles/node_modules/dsh-client-ui-workbench/lib/client.js"
# wait ~1s, the browser is already showing the new version
```

---

## Troubleshooting

| Symptom / message | Cause | Fix |
|---|---|---|
| `dsh web` exits at startup; log has `Cannot read properties of undefined (reading 'validate')` | The host half exported a plain-object `Config` | Remove `Config`, or use a `schemastery` schema |
| `client-modules: <pkg> declares dsh.client but exports no "./client" bundle` | `exports["./client"]` is missing | Add it |
| `client-modules: <pkg> exports["./client"] must be a string or an object with a string default` | Wrong `exports["./client"]` shape | Use a string or `{ "default": "..." }` |
| The package is absent from the boot graph | ① no host row ② `platform` is not `"web"` ③ the row is disabled ④ the row failed to load | Check in that order; read the host stderr |
| Package present and the patch layer correct, yet the plugin never reaches the boot graph | The entry was removed earlier (e.g. right after an `uninstall`), and that patch-layer write was not consumed by the live reload | `tools/install.mjs` re-triggers the reload and retries automatically; if it still fails, restart `dsh web` |
| `bundle ... loaded without registering "<id>" via __ModuleLoader__.load` | The `id` in the bundle does not match the package name | Make them identical |
| `require("X") missed the module table` | Required something outside the baseline without declaring it | Use only the nine baseline words, or declare `dsh.client.external` with a real supplier |
| `web boot: N entries did not activate ... pending (waiting for service: ...)` → **white screen** | `inject` names a cordis service that does not exist | List only services that exist (here: `slots`, `locale`) |
| The tab does not appear, but the boot graph contains it | Wrong slot name, or `register` was called without `slots.inject` | Use `conversation.view`; wait for the declaration |
| The tab is in the wrong position | The `order` value | chat = 0, trajectory = 10, this plugin = 20 |
| `fetch failed: redirect count exceeded` when checking the boot graph by hand | The web UI sits behind an auth plugin; `fetch` keeps no cookies, so `GET / → 302 → 303 + Set-Cookie → GET /` loops forever | Use `node tools/probe.mjs`, which carries a cookie jar |
| The plugin's new host behaviour does not appear after `tools/install.mjs` | `install.mjs` copies files, but the loader keeps the host half it already imported | Restart DSH (setup .exe: quit and relaunch; npm: `tools/restart-host.ps1`). The browser half needs no restart. |
| After installing, the tab **never appears** | Two causes with opposite fixes: **installed into the wrong home** (common with the setup .exe — the installer writes to `%USERPROFILE%\.dsh` while the app reads elsewhere), or **installed correctly but never loaded** | Run `node tools/doctor.mjs` — it separates the two and prints a fix command you can paste |
| **Creating a requirement works, but the next action on it fails with `requirement.json not found`** | A call was made without `sessionId`, so it resolved the **fallback** workspace root instead of the session cwd. On a dev machine those two paths are often identical, which hides it | Fixed: `callWorkbench` fills `sessionId` for every workspace op and throws when it cannot. Client-only — **no host restart needed** |
| `workbench/unknown-op: unknown op "…"` from `tools/rpc.mjs` | Same cause: the running host half predates that op | Restart `dsh web`. |
| Mojibake in scripts or console output | Windows PowerShell 5.1 reads a BOM-less `.ps1` as ANSI | Save `.ps1` as UTF-8 **with BOM**, or keep it pure ASCII (as `deploy.ps1` does) |
| `dsh --profile web --dump-config` fails with `EPERM ... cordis.yml` | That command **writes** `cordis.yml`, and it only prints host rows — it never evaluates `dsh.client` | Do not use it to check client plugins; use the boot-graph check instead |

### Pitfalls observed on this machine

- `_restart-dsh-web.ps1` has a hard-coded, stale `$oldPid`; running it as-is
  skips stopping the old process and double-binds port 3080. Refresh it first:
  ```powershell
  netstat -ano | Select-String '127.0.0.1:3080.*LISTENING'
  ```
  It also gets killed inside the agent sandbox (tool children live in a
  kill-on-close job), so launch it from a terminal outside the sandbox.
- `profiles/<profile>/cordis.yml` is **rewritten on every launch** (it is the
  loader's anchor). Never write rows there — use `cordis.patch.yml`.
- Most `@deepseek-ai/*` entries under `profiles/node_modules/` are junctions
  pointing at the global npm install. Your own package must be a **physical
  directory**.
- `profiles/<profile>/node_modules/` is pnpm's hoisted directory; a
  hand-placed directory there is treated as extraneous and deleted by the next
  `dsh plugin install`. `profiles/node_modules/` is the safe location.

---

## Repository layout

```
.
├── package.json                  manifest: dsh.client declaration + exports["./client"]
├── index.js                      host half: /api/rpc/workbench route + file I/O ops
├── lib/client.js                 browser half ★ all UI work happens here
├── cordis.patch.yml              the package's own patch layer (bundle installs only)
├── docs/                         developer documentation (also archived into the offline tarball,
│                                 so the links from the two READMEs still work after unpacking)
│   ├── README.md                 index: which doc answers which question
│   ├── storage-format.md         collaboration storage spec: one writer per datum
│   ├── document-generation-plan.md  templates + placeholder contract + intranet steps
│   └── workflow-gap.md           decision record: target workflow vs. what the tool did
├── tools/
│   ├── verify.mjs                offline contract checks (624 assertions)
│   ├── install.mjs               cross-platform, fully offline installer
│   ├── uninstall.mjs             surgical, idempotent uninstaller
│   ├── pack-offline.mjs          builds dist/*.tgz + SHA256SUMS.txt
│   ├── migrate-history.mjs       one-shot: legacy `_history/` → in-place + flag
│   ├── migrate-layout.mjs        one-shot: flat stage dirs → Pipeline/<stage>
│   ├── selftest.mjs              end-to-end offline install/uninstall test
│   ├── probe.mjs                 auth-aware boot-graph probe + host channel ping
│   ├── check-bundle.mjs          fetch the bundle the browser actually gets and check its markers
│   ├── doctor.mjs                install diagnosis: splits "not in the boot graph" into causes
│   ├── rpc.mjs                   call any workbench op from the shell, no browser
│   ├── restart-host.ps1/.cmd     restart dsh web so host-half changes take effect
│   └── lib/
│       ├── http.mjs              cookie jar + bounded redirect following
│       ├── tar.mjs               minimal ustar reader/writer (no system tar, no npm)
│       ├── theme-tokens.mjs      every --dsw-* token the DSH theme really defines
│       ├── home-detect.mjs       find the live $DSH_HOME among several candidates
│       └── doctor-verdict.mjs    pure rules behind doctor.mjs's four verdicts
├── deploy.ps1                    thin ASCII-only Windows wrapper over tools/install.mjs
├── .github/                      CI, release, issue forms, PR template
├── README.md · README.zh.md      bilingual pair (equal authority)
├── README.i18n.yaml              pairing record: git blob hash of each side
├── CHANGELOG.md · CONTRIBUTING.md · SECURITY.md · LICENSE
└── .editorconfig · .gitattributes · .gitignore
```

Installed locations:

```
$DSH_HOME/profiles/node_modules/dsh-client-ui-workbench/   the package
$DSH_HOME/profiles/<profile>/cordis.patch.yml              the managed insert block
$DSH_HOME/workbench/identity.json                          who you are (per user)
<workspace>/docs/requirements/                             all workbench data
<workspace>/docs/requirements/templates/                   document templates (design / test / release, one set for the whole workbench)
```

## Compatibility

Verified against DSH `0.1.5-rc.2` running in the `web` profile. The client
plugin contract — `dsh.client`, `exports["./client"]`, the `/plugins` route,
the baseline module table, and the `conversation.view` slot — is stable across
`0.1.5-rc.1`, `0.1.5-rc.2`, and `0.1.6-alpha.1`.

Newer DSH versions may add names such as `@deepseek-ai/dsh-client-runtime` that
do **not** exist in older ones. Do not add such names to `dsh.client.inject`
unless you know the target version ships them.

---

## Reference implementations

Live, installed examples worth reading:

| What to look at | File |
|---|---|
| Smallest client tab plugin (with a `conversation.view` registration) | `…/node_modules/@deepseek-ai/dsh-client-ui-jobs/lib/client.js` |
| The built-in Trajectory tab, in full | `…/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js` |
| **A hand-authored bundle like this one** (no build, `react.createElement`) | `…/@deepseek-ai/dsh-webui-auth/lib/client.js` |
| The type source of truth for slots and owner props | `…/@deepseek-ai/dsh-client-ui-conversation/lib/types/client/contract/slots.d.ts` |
| A minimal no-op host half | `…/@deepseek-ai/dsh-client-ui-trajectory/lib/index.js` |
| The upstream source repository | <https://github.com/deepseek-ai/deepseek-harness> |

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
first — the two hard rules are **no dependencies, ever** and **keep the two
READMEs in sync**.

## Security

See [SECURITY.md](SECURITY.md) for the trust boundary, what this plugin does
and does not do, and how to report a vulnerability privately.

## License

[MIT](LICENSE)
