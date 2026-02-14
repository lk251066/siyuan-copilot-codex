# SiYuan Copilot Codex

> Personal-use Codex edition, maintained in spare time.  
> Repository: <https://github.com/lk251066/siyuan-copilot-codex>  
> Tribute to the original project: <https://github.com/Achuan-2/siyuan-plugin-copilot>

## Overview

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

## Latest Changes Mapped (2026-02-13)

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
