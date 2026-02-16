---
name: worker
description: Team worker protocol for OMX tmux teams (ACK, claim, execute, update task/status)
---

# Worker Skill (Local)

This repository uses OMX `$team` mode. When you are launched as a team worker, follow the
protocol in your inbox first, then use this checklist to avoid missing lifecycle steps.

## Required Flow

1. Read your inbox: `.omx/state/team/<team>/workers/<worker>/inbox.md`
2. Send ACK to the lead via MCP tool `omx_state.team_send_message` (to_worker=`leader-fixed`)
3. Read your task: `.omx/state/team/<team>/tasks/task-<id>.json`
4. Claim the task via MCP tool `omx_state.team_claim_task`
5. Do the work **only within the allowed paths** in the task description
6. On completion:
   - Update task file to `{"status":"completed","result":"..."}` (or use `team_update_task`)
   - Update your status file to `{"state":"idle"}`
7. If blocked, set status to `{"state":"blocked","reason":"..."}` and message the lead

## Rules

- Do not print secrets (tokens, API keys, full settings.json) to the terminal.
- Do not edit files outside the paths listed in the task description.
- Prefer minimal, verifiable changes and record executable verification results when asked.

