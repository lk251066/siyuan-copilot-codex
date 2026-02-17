#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = file => readFileSync(join(process.cwd(), file), 'utf8');

const defaultSettingsSource = read('src/defaultSettings.ts');
const indexSource = read('src/index.ts');
const settingsPanelSource = read('src/SettingsPannel.svelte');
const sidebarSource = read('src/ai-sidebar.svelte');

const checks = [
    {
        name: 'default settings exposes merge helper',
        pass: defaultSettingsSource.includes('export const mergeSettingsWithDefaults'),
    },
    {
        name: 'default settings tracks settings recovery marker',
        pass: defaultSettingsSource.includes('settingsRecoveryApplied: 0 as number'),
    },
    {
        name: 'codex enabled default is forced on in merge helper',
        pass:
            defaultSettingsSource.includes('codexEnabled: true as boolean') &&
            defaultSettingsSource.includes('merged.codexEnabled = true;'),
    },
    {
        name: 'index loadSettings uses merge helper',
        pass: indexSource.includes('let mergedSettings = mergeSettingsWithDefaults(settings);'),
    },
    {
        name: 'index loadSettings has reset-recovery fallback flow',
        pass:
            indexSource.includes('const recoveryResult = this.recoverResetSettingsIfNeeded(loadedSettings);') &&
            indexSource.includes('settingsRecoveryApplied: SETTINGS_RECOVERY_VERSION'),
    },
    {
        name: 'index sync prompt path uses merge helper',
        pass: indexSource.includes('const mergedSettings = mergeSettingsWithDefaults(settings);'),
    },
    {
        name: 'saveSettings merges with persisted settings to avoid field loss',
        pass:
            indexSource.includes('const persistedSettings = (await this.loadData(SETTINGS_FILE)) || {};') &&
            indexSource.includes('const incomingSettings = this.isPlainObjectValue(settings) ? settings : {};') &&
            indexSource.includes('...persistedSettings,') &&
            indexSource.includes('...incomingSettings,'),
    },
    {
        name: 'saveSettings guards suspicious reset writes',
        pass:
            indexSource.includes('const shouldGuardResetWrite =') &&
            indexSource.includes('this.looksLikeResetSettings(incomingSettings)') &&
            indexSource.includes('this.hasUsefulRecoveryData(persistedSettings)') &&
            indexSource.includes('this.mergePreferCurrentMeaningful(incomingSettings, persistedSettings)'),
    },
    {
        name: 'settings panel loads settings through merge helper',
        pass: settingsPanelSource.includes('settings = mergeSettingsWithDefaults(loadedSettings);'),
    },
    {
        name: 'settings panel has debounced text autosave for codex config',
        pass:
            settingsPanelSource.includes('function setSettingDebounced(') &&
            settingsPanelSource.includes("on:input={e => setSettingDebounced('codexGitRepoDir', e.target.value)}"),
    },
    {
        name: 'settings panel runload no longer force-saves on mount',
        pass: !settingsPanelSource.includes('await saveSettings();\n\n        // console.debug'),
    },
    {
        name: 'sidebar starts with default settings and merges loaded settings',
        pass:
            sidebarSource.includes('let settings: any = getDefaultSettings();') &&
            sidebarSource.includes('settings = mergeSettingsWithDefaults(await plugin.loadSettings());'),
    },
    {
        name: 'send flow self-heals codexEnabled before send instead of hard-failing',
        pass:
            sidebarSource.includes('settings = mergeSettingsWithDefaults({ ...settings, codexEnabled: true });') &&
            sidebarSource.includes("console.warn('Force enable codex before send failed:', error);"),
    },
];

const failed = checks.filter(item => !item.pass);
if (failed.length > 0) {
    console.error('[settings-merge-regression] FAILED');
    for (const item of failed) {
        console.error(` - ${item.name}`);
    }
    process.exit(1);
}

console.log(`[settings-merge-regression] OK (${checks.length} checks)`);
