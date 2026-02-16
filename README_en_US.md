# SiYuan Copilot Codex

> Personal Codex-focused fork (Codex CLI only)  
> Repository: <https://github.com/lk251066/siyuan-copilot-codex>  
> Original project: <https://github.com/Achuan-2/siyuan-plugin-copilot>

## Overview

- Current version: `v1.6.37` (2026-02-16)
- Codex CLI only (`ask` / `agent`)
- Model list is loaded from local config: `CODEX_HOME/config.toml` (fallback: `~/.codex/config.toml`)
- Keeps practical features: sessions, context references, attachments, MCP tool self-check
- Supports syncing system prompt with `AGENTS.md` in the current working directory (current workspace only)

## Core Features

- **Chat + context**: switch mode/model/reasoning effort; right-click “Send to Codex” for fast context injection
- **Git Sync panel**: integrated `status / init / add / commit / pull / push`
- **Sync scope**: choose notes-only (`.sy + assets`) or whole repository
- **Safer pull**: rebase pull uses autostash by default to reduce local-change conflicts
- **Image workflow**: extract/import/capture images and insert them into notes via MCP tools

## Installation

1. Install `siyuan-copilot-codex` from SiYuan Bazaar, or copy it into `data/plugins/siyuan-copilot-codex`
2. Ensure `codex` command is available locally
3. Enable `Codex CLI` in plugin settings and set working directory (`--cd`)

## Usage

- Switch mode, model, and reasoning effort in chat header
- “Fetch Models” reads model ids from local Codex config
- “Tool Check” validates currently available tools
- Right-click “Send to Codex” to add selected text/blocks to reference context

## Git Sync

### Optional Environment Variables

- `SIYUAN_CODEX_GIT_CLI_PATH`: git executable path
- `SIYUAN_CODEX_GIT_REPO_DIR`: repository directory
- `SIYUAN_CODEX_GIT_REMOTE_NAME`: remote name (default `origin`)
- `SIYUAN_CODEX_GIT_REMOTE_URL`: remote URL
- `SIYUAN_CODEX_GIT_BRANCH`: branch name
- `SIYUAN_CODEX_GIT_PULL_REBASE=1`: pull with rebase
- `SIYUAN_CODEX_GIT_PULL_AUTOSTASH=1`: autostash local changes for rebase pull (enabled by default)
- `SIYUAN_CODEX_GIT_SYNC_SCOPE=notes|repo`: sync scope (`notes` = notes-only)
- `SIYUAN_CODEX_GIT_AUTO_SYNC=1`: auto-run Auto Sync when opening Git Sync dialog
- `SIYUAN_CODEX_GIT_COMMIT_MESSAGE`: auto-commit message

> Note: interactive auth prompts are disabled by default; prefer SSH or a system credential helper.

## Codex Image Workflow

Recommended sequence:

1. `siyuan_extract_page_images` (extract image URLs from a webpage)
2. `siyuan_import_image_urls` (batch import external image URLs)
3. `siyuan_capture_webpage_screenshot` (capture screenshot and import)
4. `siyuan_insert_images_to_note` (insert images into a target note)

If MCP is in read-only mode, enable write permission first.

## Recent Release Highlights

- **v1.6.37**: introduced `copilot-tokens.scss` and unified key chat-card / diff-dialog styles into design tokens
- **v1.6.36**: enhanced Diff dialog (Split/Unified, line numbers, wrap toggle, collapsible context, large-diff optimization) and keyboard accessibility
- **v1.6.34**: added new-message / scroll-to-bottom UX and improved streaming rendering performance

For full details, see `CHANGELOG.md`.

## Development & Packaging

```bash
npm install
npm run dev
npm run build
npm run make-install
```

- Build output: `dist/`
- Release package: `package.zip`

## Changelog

<https://github.com/lk251066/siyuan-copilot-codex/blob/main/CHANGELOG.md>

## License

GPL-3.0

## Credits

- SiYuan plugin template: <https://github.com/siyuan-note/plugin-sample-vite-svelte>
- sy-f-misc: <https://github.com/frostime/sy-f-misc>
- Cherry Studio: <https://github.com/CherryHQ/cherry-studio>
