#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const filePath = join(process.cwd(), 'src', 'ai-sidebar.svelte');
const source = readFileSync(filePath, 'utf8');

const checks = [
    {
        name: 'queued draft type exists',
        pass: source.includes('interface QueuedCodexSendDraft'),
    },
    {
        name: 'queue enqueue helper exists',
        pass: source.includes('function enqueueCurrentDraftForCodex()'),
    },
    {
        name: 'queue clear helper exists',
        pass: source.includes('function clearQueuedCodexSendDrafts(notify = false): number'),
    },
    {
        name: 'queue remove helper exists',
        pass: source.includes('function removeQueuedCodexSendDraft(draftId: string)'),
    },
    {
        name: 'queue drain helper exists',
        pass: source.includes('async function processQueuedCodexSends()'),
    },
    {
        name: 'running send enqueues draft when loading and payload exists',
        pass:
            source.includes('if (isLoading) {') &&
            source.includes('if (!hasComposedPayloadForSend()) {') &&
            source.includes('enqueueCurrentDraftForCodex();'),
    },
    {
        name: 'queue predicate depends on loading + payload only',
        pass: source.includes('function shouldQueueCurrentDraft(): boolean {\n        return isLoading && hasComposedPayloadForSend();\n    }'),
    },
    {
        name: 'codex send flow triggers queue drain in finally',
        pass: source.includes('} finally {\n                void processQueuedCodexSends();'),
    },
    {
        name: 'send button uses unified click handler',
        pass: source.includes('on:click={handleSendButtonClick}'),
    },
    {
        name: 'queue UI hint block exists during loading',
        pass:
            source.includes("{#if isLoading}") &&
            source.includes("t('aiSidebar.codex.queue.readyHint')") &&
            source.includes("t('aiSidebar.codex.queue.emptyHint')"),
    },
    {
        name: 'loading queue hint includes explicit stop button',
        pass:
            source.includes('class="b3-button b3-button--text ai-sidebar__queue-stop-btn"') &&
            source.includes('on:click={abortMessage}'),
    },
    {
        name: 'queue panel supports clear-all and remove-item actions',
        pass:
            source.includes('class="ai-sidebar__queue-panel"') &&
            source.includes('on:click={() => clearQueuedCodexSendDrafts(true)}') &&
            source.includes('on:click={() => removeQueuedCodexSendDraft(draft.id)}'),
    },
    {
        name: 'abort clears queued drafts',
        pass: source.includes('clearQueuedCodexSendDrafts(true);'),
    },
    {
        name: 'send button is disabled when loading without draft payload',
        pass: source.includes('(isLoading && !hasComposedPayloadForSend())'),
    },
];

const failed = checks.filter(item => !item.pass);

if (failed.length > 0) {
    console.error('[queue-regression] FAILED');
    for (const item of failed) {
        console.error(` - ${item.name}`);
    }
    process.exit(1);
}

console.log(`[queue-regression] OK (${checks.length} checks)`);
