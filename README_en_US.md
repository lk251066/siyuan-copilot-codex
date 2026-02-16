# SiYuan Copilot Codex

> Personal-use Codex edition, maintained in spare time.  
> Repository: <https://github.com/lk251066/siyuan-copilot-codex>  
> Tribute to the original project: <https://github.com/Achuan-2/siyuan-plugin-copilot>

## Overview

- Current release: `v1.6.37` (2026-02-16)
- Codex CLI only (`ask` / `agent` workflows).
- Model list is loaded from local `CODEX_HOME/config.toml` (fallback: `~/.codex/config.toml`) with no third-party model API dependency.
- Keeps practical features: sessions, context references, file attachments, and MCP self-check.
- System prompt can sync with `AGENTS.md` in the current Codex working directory.
- Adds a Codex image workflow via MCP tools: extract page images, import image URLs, capture webpage screenshots, and insert them into notes.

## Differences from the Original Project

Compared with the original project <https://github.com/Achuan-2/siyuan-plugin-copilot>, this branch differs as follows:

- Engine strategy: Codex CLI is the only chat engine; this branch no longer acts as a multi-provider AI hub.
- Model source: model options come from local Codex config (`CODEX_HOME/config.toml` or `~/.codex/config.toml`), not external model-list APIs.
- Settings focus: the settings panel is streamlined for Codex workflows; platform management is disabled by default and kept only for compatibility.
- Prompt sync: system prompt can sync with `AGENTS.md` in the active working directory.
- Interaction: context menus include “Send to Codex” to add selected text/blocks into chat references.
- Feature scope: keeps high-frequency features (sessions, references, attachments, tool check) while no longer maintaining legacy applet/translation entry points.
- Chat actions changed: removed in-chat “Save to Note” and “Edit Message” buttons; note writes now follow tool-driven workflows.

## Install

1. Install `siyuan-copilot-codex` from SiYuan Bazaar, or copy build output to `data/plugins/siyuan-copilot-codex`.
2. Ensure `codex` command is available on your machine.
3. Enable `Codex CLI` in plugin settings and set the working directory (`--cd`).

## Usage

- Switch mode, model, and reasoning effort from the chat header.
- "Fetch Models" reads model ids from local Codex config.
- "Tool Check" verifies currently available tools.
- Recommended image tools:
  - `siyuan_extract_page_images`
  - `siyuan_import_image_urls`
  - `siyuan_capture_webpage_screenshot`
  - `siyuan_insert_images_to_note`

## Latest Changes Mapped (2026-02-16)

- Released `v1.6.37`: P4 (aligned with VSCode Copilot Chat) — added `copilot-tokens.scss` and migrated core styles of chat message cards and the Diff dialog to tokens (colors/borders/radius/spacing/shadow) while keeping behavior unchanged.
- Released `v1.6.36`: P3 (aligned with VSCode Copilot Chat) — Diff dialog enhancements (Split/Unified toggle, line numbers, default no-wrap + horizontal scrolling, wrap toggle, collapsible context, and large-diff performance); plus keyboard support for dialogs (Esc to close, focus-visible Tab navigation).
- Released `v1.6.35`: P2 (aligned with VSCode Copilot Chat) — improved code block toolbar: language label (only when present), copy, wrap toggle, and fold/unfold long code.
- Released `v1.6.34`: P1 (aligned with VSCode Copilot Chat) — new-message indicator / scroll-to-bottom button, selection protection, and streaming performance optimizations (reduced DOM full-scan during streaming).
- Released `v1.6.33`: fixed Windows git detection when the git executable path contains spaces (previously could fail to run `git --version` and show “git not found”).
- Released `v1.6.32`: Git Sync scope now supports “Notes only (.sy + assets)” vs “Whole repo”; in notes-only mode Auto Sync/Add/Commit no longer runs `git add -A` for the entire repo.

## Latest Changes Mapped (2026-02-15)

- Released `v1.6.31`: the Diff dialog now prefers `git diff --no-index` (fallback to built-in diff), and supports copying the unified patch.
- Added a Git Sync dialog: status/init/add/commit/pull/push with repo/remote/branch config and execution logs.
- Fixed chat scrolling and message deletion: scrolling up pauses auto-scroll; a final scroll runs after streaming completes; deleting a message group also removes associated tool messages.

## Git Sync (Environment Variables)

If you prefer not to fill settings manually, you can prefill Git Sync via env vars (lower priority than dialog/settings):

- `SIYUAN_CODEX_GIT_CLI_PATH`: git executable path (optional)
- `SIYUAN_CODEX_GIT_REPO_DIR`: repo directory
- `SIYUAN_CODEX_GIT_REMOTE_NAME`: remote name (default origin)
- `SIYUAN_CODEX_GIT_REMOTE_URL`: remote URL (GitHub/Gitee)
- `SIYUAN_CODEX_GIT_BRANCH`: branch name (optional)
- `SIYUAN_CODEX_GIT_PULL_REBASE=1`: pull with rebase (optional)
- `SIYUAN_CODEX_GIT_PULL_AUTOSTASH=1`: auto-stash local changes for rebase pull (enabled by default)
- `SIYUAN_CODEX_GIT_SYNC_SCOPE=notes|repo`: sync scope (`notes` = notes-only)
- `SIYUAN_CODEX_GIT_AUTO_SYNC=1`: auto-run Auto Sync when opening the Git Sync dialog
- `SIYUAN_CODEX_GIT_COMMIT_MESSAGE`: auto-commit message (optional)

Note: interactive auth prompts are disabled by default to avoid hanging the UI; prefer SSH remotes or a system credential helper. On failure, the log includes copyable troubleshooting steps.

## Latest Changes Mapped (2026-02-14)

- Released `v1.6.30`: uninstall cleanup now removes plugin config/data residues (including legacy namespace directories).
- Full i18n parity check completed: recursive keys are aligned (`zh_CN=612`, `en_US=612`) with no missing keys.
- Timeline now follows real execution order: `Thought -> Search -> Tool Call -> Diff`, with expand/collapse support.
- Sub-agent outputs now stay in the execution timeline only, and are no longer appended into the final assistant answer body.
- `Diff` is rendered as an independent timeline item (separate style from thought/tool rows).
- Tool calls support inline diff previews; final diffs are grouped by note file with line-change stats.
- The current note page auto-refreshes after one answer is fully completed.
- In-chat "Save to Note / Edit Message" buttons are removed; writes are unified through tool calls.

## Codex Image Workflow

- Goal: let Codex complete image extraction/import/screenshot/note insertion with minimal manual steps.
- Recommended flow:
  - Extract image URLs from a page: `siyuan_extract_page_images`
  - Import external image URLs: `siyuan_import_image_urls`
  - Capture webpage screenshot and import: `siyuan_capture_webpage_screenshot`
  - Insert image assets into a target note: `siyuan_insert_images_to_note`
- Write safety: MCP can run in read-only mode; if you see “read-only 模式下不允许写入”, switch write permissions first.

## Right-Click Context Injection

- Supports right-click "Send to Codex" on text selections, blocks, and doc-tree items.
- Selected content is added into chat references automatically.

## Development

```bash
npm install
npm run dev
npm run build
```

Build output: `dist/`

## Changelog

<https://github.com/lk251066/siyuan-copilot-codex/blob/main/CHANGELOG.md>

## License

GPL-3.0

## Credits

- SiYuan plugin template: <https://github.com/siyuan-note/plugin-sample-vite-svelte>
- sy-f-misc: <https://github.com/frostime/sy-f-misc>
- Cherry Studio: <https://github.com/CherryHQ/cherry-studio>
