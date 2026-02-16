import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const filePath = 'src/ai-sidebar.svelte';
const source = readFileSync(filePath, 'utf8');

function ensureIncludes(label, text) {
    assert.equal(
        source.includes(text),
        true,
        `${label} missing: ${text}`
    );
}

function ensureRegex(label, regex, minCount = 1) {
    const matches = source.match(regex);
    const count = matches ? matches.length : 0;
    assert.ok(
        count >= minCount,
        `${label} expected >= ${minCount}, got ${count}`
    );
}

// 1) dry-run 开关与持久化
ensureIncludes('dry-run state declaration', 'let gitAutoSyncDryRun = false;');
ensureIncludes('dialog hydrate from settings', 'gitAutoSyncDryRun = (settings as any)?.codexGitAutoSyncDryRun === true;');
ensureIncludes('env key read', "const envDryRun = getEnvFirst(['SIYUAN_CODEX_GIT_DRY_RUN']);");
ensureIncludes('env patch key', 'patch.codexGitAutoSyncDryRun = parsedDryRun;');
ensureIncludes('checkbox patch key', 'codexGitAutoSyncDryRun: gitAutoSyncDryRun');

// 2) runGitAutoSync dry-run 分支
ensureIncludes('runGitAutoSync options signature', 'async function runGitAutoSync(options?: { dryRun?: boolean })');
ensureIncludes('dry-run compute line', 'const dryRun = options?.dryRun ?? gitAutoSyncDryRun === true;');
ensureIncludes('dry-run title log', "appendGitLogLine(dryRun ? '== Auto Sync (Dry Run) ==' : '== Auto Sync ==');");
ensureIncludes('dry-run done log', "appendGitLogLine(dryRun ? '== Auto Sync Dry-run Done ==' : '== Auto Sync Done ==');");
ensureIncludes('dry-run helper', "previewWriteStep");
ensureIncludes('dry-run command marker', "[dry-run]");

// 3) 写操作预演日志断言（核心回归点）
ensureRegex('skip write pull', /skip write: pull/g, 1);
ensureRegex('skip write add', /skip write: add/g, 1);
ensureRegex('skip write commit', /skip write: commit/g, 1);
ensureRegex('skip write push', /skip write: push/g, 1);

// 4) UI文案与按钮态
ensureIncludes('dry-run ui hint', "aiSidebar.git.dryRunHint");
ensureIncludes('dry-run button text key', "aiSidebar.git.autoSyncDryRun");

console.log('Git Auto Sync dry-run regression: PASS');
console.log('checked_file=' + filePath);
console.log('checks=toggle+persistence+dryrun-log+write-skip+ui-label');
