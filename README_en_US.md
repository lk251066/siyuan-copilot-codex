# SiYuan Copilot (Codex Edition)

> Codex-only fork of [Achuan-2/siyuan-plugin-copilot](https://github.com/Achuan-2/siyuan-plugin-copilot).
> Repository: `https://github.com/lk251066/siyuan-plugin-copilot`.

## Positioning

- Keep only the Codex workflow (`ask` and `agent` modes).
- Remove legacy multi-model routing, applet, and translation entries.
- Use OpenAI API key from "Platform Management -> OpenAI" to fetch Codex models.
- Keep high-frequency features: session management, context references, file attachments, and MCP self-check.

## Main Features

- Codex chat with `ask` / `agent` mode.
- Auto-generated chat titles, manual rename support.
- Better thinking display (compact view, proper newline rendering).
- Model selectors are dropdowns in both settings and chat header.
- MCP self-check panel for connectivity diagnostics.
- System prompt sync with `codexWorkingDir/AGENTS.md` (current working dir only).

## Quick Start

1. Install SiYuan and make sure `codex` CLI is available in terminal.
2. Fill a valid API key at `Platform Management -> OpenAI`.
3. Build and install this plugin into:
   - `data/plugins/siyuan-copilot-codex`
4. In plugin settings (`Codex CLI` section):
   - Enable Codex CLI
   - Set Codex path (`codex` or absolute path)
   - Set working directory (`--cd`)
   - Choose proper permission mode

## Build

```bash
npm install
npm run build
```

Build outputs are in `dist/`.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

GPL-3.0