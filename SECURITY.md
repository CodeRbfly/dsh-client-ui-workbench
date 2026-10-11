# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities **privately**, using GitHub's
[private security advisory](https://github.com/OWNER/dsh-client-ui-workbench/security/advisories/new)
form. Do not open a public issue.

Include what you can of: the affected version or commit, your DSH version, a
reproduction, and the impact you believe it has. You can expect an initial
response within a few days. This is a volunteer-maintained project, so please
allow reasonable time before disclosing publicly.

## Supported versions

Only the latest release receives security fixes. This plugin is a UI
contribution with no server component, so the practical attack surface is
small.

## What this plugin does and does not do

Understanding the design bounds the risk. The whole plugin is two small files
plus a dependency-free installer.

**It does:**

- Register one `conversation.view` slot (a React component) and one locale
  namespace with the browser-side DSH slot registry.
- Inject a single `<style data-plugin="dsh-client-ui-workbench">` element into
  `document.head`, removed on plugin unload. The CSS uses design tokens only —
  no `url()`, no `@import`, no remote fonts.
- Read session state through the hooks the host passes to the view
  (`useSession`) and render it.
- At install time, copy files into `$DSH_HOME/profiles/node_modules/<pkg>/` and
  append one `insert:` block to the profile's `cordis.patch.yml`, backing the
  file up first.

**It does not:**

- Make any network request at runtime. The view performs no `fetch`; the only
  `fetch` in the codebase is a one-shot `localhost` probe in
  `tools/install.mjs`, disabled with `--skip-verify`, used to confirm the boot
  graph.
- Use `eval`, `new Function`, dynamic `import()`, or remote code loading.
- Read credentials, tokens, cookies, or files outside `$DSH_HOME/profiles/`.
- Ship any dependency, so there is no transitive supply chain to trust. CI
  fails the build if a dependency is declared.
- Run any install-time script hook: `package.json` has no `postinstall` or
  other lifecycle scripts, and `tools/install.mjs` is explicit about never
  invoking npm, pnpm, or `dsh plugin`.

## Verifying a download

Offline artifacts are published to GitHub Releases with a checksum file:

```bash
sha256sum --check SHA256SUMS.txt
```

On Windows:

```powershell
Get-FileHash .\dsh-client-ui-workbench-0.1.0.tgz -Algorithm SHA256
# compare against the value in SHA256SUMS.txt
```

Because the project is dependency-free, you can also read the entire runtime
surface before installing: `index.js`, `lib/client.js`, and `cordis.patch.yml`.
The installer is `tools/install.mjs` plus `tools/lib/tar.mjs` — around 400 lines
total, no dependencies.

## Trust boundary

This plugin runs with the same privileges as the DSH web GUI in your browser
and installs files into your DSH home directory. It is not sandboxed from DSH
itself. Treat the installed package the same way you would treat any code you
add to `~/.dsh`.
