# Contributing

Thanks for helping. This project is small, dependency-free, and deliberately
boring to build — there is no compile step and no package manager involved.

---

## Ground rules

1. **No dependencies, ever.** `package.json` must keep empty `dependencies`,
   `devDependencies`, `peerDependencies`, and `optionalDependencies`. The whole
   point of the hand-written browser bundle is that this plugin installs on a
   machine with no network and no npm. CI fails the build if a dependency
   appears. Node built-in modules (`node:fs`, `node:zlib`, …) are fine.

2. **LF line endings.** `.gitattributes` normalizes to LF on checkout, and
   `.editorconfig` pins what your editor writes. Don't fight it.

3. **The two READMEs move together.** `README.md` (English) and `README.zh.md`
   (Chinese) carry equal authority. If you change one, change the other and
   re-record the pairing hashes in `README.i18n.yaml`:

   ```bash
   node -e "
     const { execSync } = require('node:child_process');
     const fs = require('node:fs');
     for (const f of ['README.md', 'README.zh.md']) {
       console.log(f + ': ' + execSync('git hash-object ' + f, { encoding: 'utf8' }).trim());
     }
   "
   ```

4. **The browser bundle is a classic script.** `lib/client.js` is fetched with
   `<script async src>` — no `type="module"`. A top-level `import`/`export` is a
   `SyntaxError` at page load, which white-screens the entire GUI.
   `npm run verify` checks this.

---

## Setup

Nothing to install:

```bash
git clone https://github.com/OWNER/dsh-client-ui-workbench.git
cd dsh-client-ui-workbench
node --version   # must be >= 20
```

## The two test suites

```bash
npm run verify     # offline contract verification (no DSH, no network, no writes)
npm run selftest   # end-to-end offline install/uninstall against a throwaway DSH home
npm test           # both
```

`verify` loads `lib/client.js` in a `vm` sandbox and asserts the whole host
contract: classic-script form, registration id, factory exports, no `Config`,
locale dictionaries, slot registration, component render, module-table
baseline, and offline readiness.

`selftest` fakes a DSH home in a temp directory, then exercises the real
`install.mjs` / `uninstall.mjs` scripts: pack → install from tarball → install
again (idempotence) → uninstall → install from directory → dry-run → uninstall.
It asserts in particular that patch-layer surgery never damages **other**
plugins' rows.

Both run in CI on Linux, macOS, and Windows against Node 20 and 22.

## Trying it in a real GUI

```bash
node tools/install.mjs        # or: .\deploy.ps1   on Windows
```

Then open `http://127.0.0.1:3080`, press **F5**, and look for the
需求执行工作台 tab next to 轨迹.

To confirm the host composed it, without touching the browser:

```bash
node -e "fetch('http://127.0.0.1:3080').then(r=>r.text()).then(h=>console.log(h.includes('\"id\":\"dsh-client-ui-workbench\"')))"
```

## The edit loop

| What you changed | How it takes effect |
|---|---|
| `lib/client.js` | The host polls the bundle every ~500 ms and hot-swaps it. No restart, no refresh. |
| `index.js`, `package.json` | Restart `dsh web`. |
| A `cordis.patch.yml` row | Live-reloaded by the host. No restart. |
| Adding a **brand-new** plugin | The page's boot graph is fixed at load time — **F5 is required**. |

---

## Adding a feature to the pipeline

The single extension point is the `STAGES` array near the top of
`lib/client.js`. Each stage has a `labelKey`, a `hintKey`, and a `menus` array.

To add one menu entry:

1. Append `{ id: 'yourId', labelKey: 'menu.<stage>.yourId' }` to that stage's
   `menus`.
2. Add `'menu.<stage>.yourId'` to **both** the `zh` and `en` dictionaries with
   the same key.
3. Run `npm run verify` — it fails if the two dictionaries disagree.

Menus currently render as disabled placeholders. To make one real, either give
the component a selected-menu state that dispatches to a panel per
`(stage.id, menu.id)`, or replace the placeholder grid. See the *Extending*
section of the README for the four data-source options and their costs.

---

## Style

- Match the surrounding code. The browser bundle is plain JS with
  `react.createElement`; the tooling is modern ESM with JSDoc types.
- Comments explain **why**, not what — especially where a rule exists because
  the host will break otherwise.
- CSS in the bundle uses design tokens (`--dsw-alias-*`) only. No literal
  colours; both light and dark themes must work.

## Commits and pull requests

- Conventional-commit subject lines (`fix:`, `feat:`, `docs:`, `ci:`, `chore:`).
- One concern per pull request. Fill in the PR template — the checklist is
  load-bearing, not decoration.
- CI must be green.

## Releasing

Maintainers only:

1. Pick the version and update `package.json` and `CHANGELOG.md`.
2. Make sure the two READMEs and their `README.i18n.yaml` hashes are current.
3. Tag and push:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

   The `Release` workflow re-runs the full test suite, builds
   `dist/dsh-client-ui-workbench-0.1.0.tgz`, verifies it against
   `SHA256SUMS.txt`, checks the tag matches `package.json`, and attaches both
   files to a GitHub Release. Air-gapped users download the `.tgz` from there.

### Pre-publication checklist

The repository ships with placeholders that must be replaced before the first
push:

- [ ] `OWNER` in `package.json` (`repository`, `bugs`, `homepage`)
- [ ] `OWNER` in `.github/ISSUE_TEMPLATE/config.yml`
- [ ] `OWNER` in `CONTRIBUTING.md`
- [ ] Confirm the `LICENSE` copyright line
- [ ] Decide whether to keep `"private": true` in `package.json`
      (keep it unless you intend to publish to npm)
