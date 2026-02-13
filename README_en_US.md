# SiYuan Copilot Codex

> Personal-use Codex edition, maintained in spare time.  
> Repository: <https://github.com/lk251066/siyuan-copilot-codex>  
> Tribute to the original project: <https://github.com/Achuan-2/siyuan-plugin-copilot>

## Overview

- Codex CLI only (`ask` / `agent` workflows).
- Model list is read from local `~/.codex/config.toml` (no third-party model API dependency).
- Keeps practical features: sessions, context references, file attachments, and MCP self-check.
- System prompt can sync with `AGENTS.md` in the current Codex working directory.
- Adds a Codex image workflow via MCP tools: extract page images, import image URLs, capture webpage screenshots, and insert them into notes.

## Differences from the Original Project

Compared with the original project <https://github.com/Achuan-2/siyuan-plugin-copilot>, this branch differs as follows:

- Engine strategy: Codex CLI is the only chat engine; this branch no longer acts as a multi-provider AI hub.
- Model source: model options are loaded from local `~/.codex/config.toml`, not external model-list APIs.
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
