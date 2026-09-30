# BontaFlowStack Engines

Own browser, rendering and local design tools for the 28-skill BontaFlowStack plugin.
The source package uses the BontaFlow MIT license in [LICENSE](LICENSE).

## Install

Requirements: Windows x64, Node.js 24+ with npm.
Run the BontaFlowStack plugin's setup with `-WithEngines`, or from this source directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build.ps1 -Install -InstallBrowser
```

Setup installs the exact Playwright and Pretext dependencies in `package-lock.json`
and Chromium under `.browsers`. It generates the checked `engine.json` registration.
There is no compiler, Bun runtime or image-provider API key to configure.
Dependencies and browser binaries are installed separately; they are absent from
the source archive. Their installed package files remain intact.

## Capabilities

- **Browser:** navigation, fresh element references, page/DOM reading, forms,
  interaction, one-time JavaScript, tables, screenshots, PDF, responsive capture,
  performance samples, logs and separate tabs.
- **Continuation:** a task-owned profile, cookies and local storage persist.
  Visible handoff also preserves session storage, open URLs and the selected tab.
  Active HTTP headers survive handoff, restart and user-agent changes within the
  running service. They are kept in memory and must be set again after stop.
  Switching from headless to visible through handoff/connect relaunches Chromium
  and reloads pages. It does not preserve in-memory application state or unsaved
  form edits. Use connect before those interactions when human access is needed.
  Restart also reloads pages. Resume uses the same logical session.
- **Render:** actual Chromium output from a local HTML file or URL, desktop/mobile
  viewports, page errors and overflow observations.
- **Design:** local comparison boards, explicit selection with image fingerprints,
  a gallery, before/after comparison and implementation prompts.
  Regenerating a board clears its choice. Reading a choice checks the current
  board metadata and image bytes; changed inputs require a new user choice.
- **Images:** the BontaFlowStack skill calls Codex's image generation/editing tool.
  This package makes no image API requests.
- **Pretext:** the entry ES module from the separately installed npm package,
  for a requested measured-text-layout integration.

Each browser session uses a local authenticated service bound to 127.0.0.1.
The plugin passes its task session directory in `BFS_ENGINE_SESSION`.
Chromium profiles use `~/.bontaflowstack/browser-profiles/<session-hash>` to avoid
Windows path-length failures. Cookies and local sign-ins stay in that profile.
Only an explicit stop closes the owned service; unrelated browser instances are
untouched. Old user files are never automatically imported or deleted.

Use `node src/browser.mjs --help`, `node src/render.mjs --help` and
`node src/design.mjs --help` for the command interface. Dialogs are dismissed by
default; `dialog-accept [text]` configures the next dialog before the interaction.

## Optional external design tools

These are prerequisites only for their specific integration, not for ordinary design:

| Tool | Purpose | Source |
| --- | --- | --- |
| impeccable | Additional automated design checks | [GitHub](https://github.com/pbakaus/impeccable) |
| Google DESIGN.md | Validation and token export for Google's format | [GitHub](https://github.com/google-labs-code/design.md) |

Install the chosen tool following its own instructions. No source, rule catalog,
format specification or installer from either project is included here.
Google DESIGN.md works independently of Stitch. This package contains no Stitch connector.

Configure the installed command as a JSON argument array in the Codex process
environment. Use absolute executable paths; commands run without a shell:

```powershell
$env:BFS_DESIGN_MD_COMMAND = '["C:/Program Files/nodejs/node.exe","C:/your-tools/node_modules/@google/design.md/dist/index.js"]'
$env:BFS_IMPECCABLE_COMMAND = '["C:/your-tools/impeccable.exe"]'
```

The sample paths must be replaced with the actual installed paths.
The first integration forwards official CLI commands; `check` maps to `lint`
and `tokens` to `export --format dtcg`. The second forwards the installed
impeccable executable's arguments; inspect its own `--help`.
Missing tools produce a specific unavailable capability without blocking the core.

## Verify

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.browsers'
npm.cmd test
```

The browser test opens a real Chromium session, tests interaction, rejects a wrong
service token, switches to a visible window, and checks login storage after resume
and restart. Tests use temporary project/session folders.

For the full plugin integration, run from the core repository:

```powershell
node tests/engine.integration.mjs C:/path/to/bontaflowstack-engines
```

## Package

`scripts/package.ps1` packages tracked source files, records their SHA-256 values
and produces a release checksum. Installed dependencies, profiles, browser
downloads and generated runtime state are excluded.
