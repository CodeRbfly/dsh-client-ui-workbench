<!--
Thanks for the pull request. Two things make review fast here:

  1. `npm test` passes (it runs the contract checks and the offline install
     end-to-end self-test; it needs no network and no install step).
  2. The change is scoped to one concern.
-->

## What changed

<!-- A short description, and the issue this closes if there is one: "Closes #12". -->

## Which stage / area

<!--
  需求 / 方案 / 开发 / 测试 / 提版, or "plugin infrastructure".
  Delete this section if the change is not user-visible.
-->

## How it was verified

<!--
  Paste the relevant output. `npm test` covers most of it. If you changed the
  browser bundle, say which DSH version you loaded it in and what you saw in
  the GUI. If you changed the installer, describe the machine/OS you ran it on.
-->

- [ ] `npm test` passes
- [ ] Verified in a real DSH web GUI at http://127.0.0.1:3080 (F5, tab appears and renders)
- [ ] Not applicable — docs/tooling only

## Checklist

- [ ] No new dependencies were added (`package.json` has no `dependencies`/`devDependencies`; the project must stay installable offline)
- [ ] Any new UI text was added to **both** the `zh` and `en` dictionaries in `lib/client.js`
- [ ] If `lib/client.js` changed, the bundle still contains no top-level `import`/`export` (it is loaded as a classic script)
- [ ] If the patch-layer block format changed, `tools/uninstall.mjs` was updated to match and `npm run selftest` still passes
- [ ] `README.md` and `README.zh.md` were kept in sync, and `README.i18n.yaml` re-recorded
