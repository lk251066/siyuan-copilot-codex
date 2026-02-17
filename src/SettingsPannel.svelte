<script lang="ts">
    import { onMount } from 'svelte';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { t } from './utils/i18n';
    import {
        getDefaultSettings,
        mergeSettingsWithDefaults,
        type CustomProviderConfig,
    } from './defaultSettings';
    import { pushMsg, pushErrMsg, lsNotebooks } from './api';
    import { confirm } from 'siyuan';
    import ProviderConfigPanel from './components/ProviderConfigPanel.svelte';
    import { fetchCodexModels, resolveCodexLocalConfigPaths } from './codex/codex-models';
    import {
        listWorkspaceSkills,
        type WorkspaceSkillMeta,
        type WorkspaceSkillOverride,
    } from './codex/workspace-skills';
    export let plugin;

    // 使用动态默认设置
    let settings = { ...getDefaultSettings() };

    // 笔记本列表
    let notebookOptions: Record<string, string> = {};

    let codexModelOptions: string[] = [];
    let isLoadingCodexModels = false;
    let codexSkillOptions: WorkspaceSkillMeta[] = [];
    let isLoadingCodexSkills = false;
    let codexSkillsRefreshKey = '';
    let selectedSkillKey = '';
    let selectedSkill: WorkspaceSkillMeta | null = null;
    let skillEditorSelectedKey = '';
    let skillEditorName = '';
    let skillEditorDescription = '';
    let codexLocalConfigPaths: string[] = [];
    $: codexLocalConfigPaths = resolveCodexLocalConfigPaths({
        workingDir: String(settings?.codexWorkingDir || '').trim(),
    });

    function setSetting(key: string, value: any) {
        settings = { ...settings, [key]: value };
        saveSettings();
    }

    async function refreshCodexModels(showToast = false) {
        if (isLoadingCodexModels) return;
        isLoadingCodexModels = true;
        try {
            codexModelOptions = await fetchCodexModels({
                workingDir: String(settings?.codexWorkingDir || '').trim(),
            });
            if (showToast) {
                pushMsg(
                    t('aiSidebar.codex.modelsRefreshed', {
                        count: String(codexModelOptions.length),
                    })
                );
            }
        } catch (error) {
            codexModelOptions = [];
            const detail = (error as Error).message || String(error);
            if (showToast) {
                pushErrMsg(
                    t('aiSidebar.codex.refreshModelsFailed', {
                        error: detail,
                    })
                );
            }
        } finally {
            isLoadingCodexModels = false;
        }
    }

    function getCodexSkillOverrides(): Record<string, WorkspaceSkillOverride> {
        if (settings?.codexSkillOverrides && typeof settings.codexSkillOverrides === 'object') {
            return settings.codexSkillOverrides;
        }
        return {};
    }

    function getSkillOverride(skill: WorkspaceSkillMeta): WorkspaceSkillOverride {
        return getCodexSkillOverrides()[skill.key] || {};
    }

    function formatSkillOptionLabel(skill: WorkspaceSkillMeta): string {
        const source = skill.source === 'workspace' ? 'workspace' : 'plugin';
        return `${skill.name} (${source})`;
    }

    function getSkillCustomName(skill: WorkspaceSkillMeta): string {
        const value = getSkillOverride(skill).name;
        return typeof value === 'string' ? value : '';
    }

    function getSkillCustomDescription(skill: WorkspaceSkillMeta): string {
        const value = getSkillOverride(skill).description;
        return typeof value === 'string' ? value : '';
    }

    function updateSkillOverride(skill: WorkspaceSkillMeta, patch: WorkspaceSkillOverride) {
        const base = { ...getCodexSkillOverrides() };
        const merged = { ...(base[skill.key] || {}), ...patch };
        const clean: WorkspaceSkillOverride = {};

        if (typeof merged.name === 'string' && merged.name.trim()) clean.name = merged.name.trim();
        if (typeof merged.description === 'string' && merged.description.trim()) {
            clean.description = merged.description.trim();
        }

        if (Object.keys(clean).length > 0) {
            base[skill.key] = clean;
        } else {
            delete base[skill.key];
        }
        setSetting('codexSkillOverrides', base);
    }

    function resetSkillOverride(skill: WorkspaceSkillMeta) {
        const base = { ...getCodexSkillOverrides() };
        if (base[skill.key]) {
            delete base[skill.key];
            setSetting('codexSkillOverrides', base);
        }
    }

    function syncSkillEditorFields(skill: WorkspaceSkillMeta | null) {
        if (!skill) {
            skillEditorSelectedKey = '';
            skillEditorName = '';
            skillEditorDescription = '';
            return;
        }
        const customName = getSkillCustomName(skill);
        const customDescription = getSkillCustomDescription(skill);
        skillEditorSelectedKey = skill.key;
        skillEditorName = customName || skill.name;
        skillEditorDescription = customDescription || skill.description;
    }

    function saveSkillEditorFields() {
        if (!selectedSkill) return;
        const name = String(skillEditorName || '').trim();
        const description = String(skillEditorDescription || '').trim();
        updateSkillOverride(selectedSkill, {
            name: name && name !== selectedSkill.name ? name : '',
            description:
                description && description !== selectedSkill.description ? description : '',
        });
        void refreshCodexSkills(false);
    }

    function resetSkillEditorFields() {
        if (!selectedSkill) return;
        resetSkillOverride(selectedSkill);
        syncSkillEditorFields(selectedSkill);
        void refreshCodexSkills(false);
    }

    async function refreshCodexSkills(showToast = false) {
        if (isLoadingCodexSkills) return;
        isLoadingCodexSkills = true;
        try {
            codexSkillOptions = listWorkspaceSkills(String(settings?.codexWorkingDir || '').trim(), {
                includePlugin: true,
                maxSkills: 100,
            });
            const exists = codexSkillOptions.some(skill => skill.key === selectedSkillKey);
            if (!exists) {
                selectedSkillKey = codexSkillOptions[0]?.key || '';
            }
            if (showToast) {
                pushMsg(
                    t('settings.codex.skills.editor.refreshed', {
                        count: String(codexSkillOptions.length),
                    }) || `Skills 已刷新（${codexSkillOptions.length}）`
                );
            }
        } catch (error) {
            codexSkillOptions = [];
            if (showToast) {
                pushErrMsg(
                    t('settings.codex.skills.editor.refreshFailed', {
                        error: (error as Error).message || String(error),
                    }) || `Skills 刷新失败：${(error as Error).message || String(error)}`
                );
            }
        } finally {
            isLoadingCodexSkills = false;
        }
    }

    function detectCodexCliPath() {
        try {
            const nodeRequire = (globalThis as any).require || require;
            const childProcess = nodeRequire('child_process') as typeof import('child_process');
            const child = childProcess.spawn('cmd.exe', ['/d', '/s', '/c', 'where codex'], {
                windowsHide: true,
                shell: true,
            });
            let out = '';
            child.stdout?.on('data', (buf: Buffer) => {
                out += buf.toString('utf8');
            });
            child.on('close', () => {
                const lines = out
                    .split(/\r?\n/)
                    .map(s => s.trim())
                    .filter(Boolean);
                if (lines.length > 0) {
                    setSetting('codexCliPath', lines[0]);
                    pushMsg(`${t('settings.codex.detectCliPath') || '自动探测'}: ${lines[0]}`);
                } else {
                    pushErrMsg(t('settings.codex.notFoundInPath'));
                }
            });
        } catch (e) {
            console.error('Detect codex path failed:', e);
            pushErrMsg(t('settings.codex.detectCliFailed'));
        }
    }

    function detectGitCliPath() {
        try {
            const nodeRequire = (globalThis as any).require || require;
            const childProcess = nodeRequire('child_process') as typeof import('child_process');
            const isWin = (globalThis as any)?.process?.platform === 'win32';

            const cmd = isWin ? 'cmd.exe' : 'sh';
            const args = isWin ? ['/d', '/s', '/c', 'where git'] : ['-lc', 'which git'];

            const child = childProcess.spawn(cmd, args, {
                windowsHide: true,
                shell: true,
            });
            let out = '';
            child.stdout?.on('data', (buf: Buffer) => {
                out += buf.toString('utf8');
            });
            child.on('close', () => {
                const lines = out
                    .split(/\r?\n/)
                    .map(s => s.trim())
                    .filter(Boolean);
                if (lines.length > 0) {
                    setSetting('codexGitCliPath', lines[0]);
                    pushMsg(`${t('settings.codex.git.detectCliPath') || '自动探测'}: ${lines[0]}`);
                } else {
                    pushErrMsg(t('settings.codex.git.notFoundInPath'));
                }
            });
        } catch (e) {
            console.error('Detect git path failed:', e);
            pushErrMsg(t('settings.codex.git.detectCliFailed'));
        }
    }

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
        //  Type："checkbox" | "select" | "textinput" | "textarea" | "number" | "slider" | "button" | "hint" | "custom";
    }

    // Codex-only：平台管理入口停用（底层配置结构保留，便于回滚）
    const ENABLE_PLATFORM_MANAGEMENT = false;

    const builtInProviderNames: Record<string, string> = {
        gemini: t('platform.builtIn.gemini'),
        openai: t('platform.builtIn.openai'),
        deepseek: t('platform.builtIn.deepseek'),
        moonshot: t('platform.builtIn.moonshot'),
        volcano: t('platform.builtIn.volcano'),
    };

    // 内置平台的默认 API 地址
    const builtInProviderDefaultUrls: Record<string, string> = {
        gemini: 'https://generativelanguage.googleapis.com',
        deepseek: 'https://api.deepseek.com',
        moonshot: 'https://api.moonshot.cn',
        openai: 'https://api.openai.com',
        volcano: 'https://ark.cn-beijing.volces.com',
    };

    // 内置平台的官网链接
    const builtInProviderWebsites: Record<string, string> = {
        gemini: 'https://aistudio.google.com/apikey',
        deepseek: 'https://platform.deepseek.com/',
        moonshot: 'https://platform.moonshot.cn/',
        openai: 'https://platform.openai.com/',
        volcano: 'https://console.volcengine.com/ark',
    };

    // 当前选中的平台ID
    let selectedProviderId = '';

    // 新增自定义平台相关状态
    let showAddPlatform = false;
    let newPlatformName = '';

    function handleProviderChange() {
        saveSettings();
    }

    // 处理平台重命名
    function handleProviderRename(providerId: string, newName: string) {
        const provider = settings.aiProviders.customProviders.find(p => p.id === providerId);
        if (provider) {
            provider.name = newName;
            // 触发响应式更新
            settings = {
                ...settings,
                aiProviders: {
                    ...settings.aiProviders,
                    customProviders: [...settings.aiProviders.customProviders],
                },
            };
            saveSettings();
            pushMsg(`平台已重命名为: ${newName}`);
        }
    }

    // 生成自定义平台ID
    function generateCustomPlatformId(): string {
        return `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 添加自定义平台
    function addCustomPlatform() {
        if (!newPlatformName.trim()) {
            pushErrMsg(t('platform.nameRequired'));
            return;
        }

        const newPlatform: CustomProviderConfig = {
            id: generateCustomPlatformId(),
            name: newPlatformName.trim(),
            apiKey: '',
            customApiUrl: '',
            models: [],
        };

        // 使用响应式更新确保 Svelte 检测到变化
        settings = {
            ...settings,
            aiProviders: {
                ...settings.aiProviders,
                customProviders: [...settings.aiProviders.customProviders, newPlatform],
            },
            // 自动选中新创建的平台（仅设置面板，不影响对话）
            selectedProviderId: newPlatform.id,
        };

        // 更新本地选中状态
        selectedProviderId = newPlatform.id;

        newPlatformName = '';
        showAddPlatform = false;
        saveSettings();
        pushMsg(t('aiSidebar.success.addPromptSuccess') + `: ${newPlatform.name}`);
    }

    // 删除平台（内置平台也可删除）
    function removePlatform(providerId: string) {
        const platformName =
            builtInProviderNames[providerId] ||
            settings.aiProviders?.customProviders?.find(p => p.id === providerId)?.name ||
            t('platform.unknown');

        confirm(
            t('aiSidebar.confirm.deletePlatform.title'),
            t('aiSidebar.confirm.deletePlatform.message', { platformName }),
            async () => {
                // 检查是否需要清空当前选中的模型
                // 只有当删除的平台是当前正在使用的平台时才清空模型选择
                const shouldClearModel = settings.currentProvider === providerId;

                // 如果是内置平台，删除其所有配置
                if (builtInProviderNames[providerId]) {
                    // 使用响应式更新确保 Svelte 检测到变化
                    settings = {
                        ...settings,
                        aiProviders: {
                            ...settings.aiProviders,
                            [providerId]: {
                                apiKey: '',
                                customApiUrl: '',
                                models: [],
                            },
                        },
                    };
                } else {
                    // 如果是自定义平台，从列表中移除
                    // 使用响应式更新确保 Svelte 检测到变化
                    const filteredProviders = settings.aiProviders.customProviders.filter(
                        p => p.id !== providerId
                    );
                    settings = {
                        ...settings,
                        aiProviders: {
                            ...settings.aiProviders,
                            customProviders: filteredProviders,
                        },
                    };
                }

                // 如果删除的是当前选中的平台（在设置面板中），清空面板选择
                if (selectedProviderId === providerId) {
                    selectedProviderId = '';
                    settings.selectedProviderId = '';
                }

                // 只有当删除的平台是当前对话使用的平台时，才清空对话中的平台和模型选择
                if (shouldClearModel) {
                    settings = {
                        ...settings,
                        currentProvider: '',
                        currentModelId: '',
                    };
                }

                saveSettings();
                pushMsg(t('aiSidebar.success.deletePromptSuccess') + `: ${platformName}`);
            }
        );
    }

    // 获取所有平台选项（内置+自定义） - 使用响应式语句
    $: allProviderOptions = (() => {
        const builtIn = Object.keys(builtInProviderNames).map(id => ({
            id,
            name: builtInProviderNames[id],
            type: 'built-in' as const,
        }));

        const custom = (settings.aiProviders?.customProviders || []).map(
            (p: CustomProviderConfig) => ({
                id: p.id,
                name: p.name,
                type: 'custom' as const,
            })
        );

        return [...builtIn, ...custom];
    })();

    // 获取当前选中平台的名称 - 使用响应式语句
    $: selectedProviderName = (() => {
        if (!selectedProviderId) return t('platform.select');

        if (builtInProviderNames[selectedProviderId]) {
            return builtInProviderNames[selectedProviderId];
        }

        const customProvider = settings.aiProviders?.customProviders?.find(
            (p: CustomProviderConfig) => p.id === selectedProviderId
        );
        return customProvider?.name || t('platform.unknown');
    })();

    // 保存选中的平台ID（仅在设置面板中选择平台，不影响对话中的当前平台）
    function handleProviderSelect() {
        // 使用响应式更新确保 Svelte 检测到变化
        settings = {
            ...settings,
            selectedProviderId: selectedProviderId,
        };
        saveSettings();
    }

    let groups: ISettingGroup[] = [
        {
            name: t('settings.settingsGroup.systemPrompt'),
            items: [
                {
                    key: 'aiSystemPrompt',
                    value: settings.aiSystemPrompt,
                    type: 'textarea',
                    title: t('settings.ai.systemPrompt.title'),
                    description: t('settings.ai.systemPrompt.description'),
                    direction: 'row',
                    rows: 4,
                    placeholder: t('settings.ai.systemPrompt.placeholder'),
                },
            ],
        },
        ...(ENABLE_PLATFORM_MANAGEMENT
            ? [
                  {
                      name: t('settings.settingsGroup.platformManagement'),
                      items: [],
                  },
              ]
            : []),
        {
            name: t('settings.settingsGroup.displayAndOperation'),
            items: [
                {
                    key: 'sendMessageShortcut',
                    value: settings.sendMessageShortcut,
                    type: 'select',
                    title: t('settings.sendMessageShortcut.title'),
                    description: t('settings.sendMessageShortcut.description'),
                    options: {
                        'ctrl+enter': t('settings.sendMessageShortcut.options.ctrlEnter'),
                        enter: t('settings.sendMessageShortcut.options.enter'),
                    },
                },
                {
                    key: 'messageFontSize',
                    value: settings.messageFontSize,
                    type: 'number',
                    title: t('settings.messageFontSize.title'),
                    description: t('settings.messageFontSize.description'),
                    number: {
                        min: 5,
                        max: 32,
                        step: 1,
                    },
                },
            ],
        },
        {
            name: t('settings.settingsGroup.noteExport'),
            items: [
                {
                    key: 'exportNotebook',
                    value: settings.exportNotebook,
                    type: 'select',
                    title: t('settings.exportNotebook.title'),
                    description: t('settings.exportNotebook.description'),
                    options: notebookOptions,
                },
                {
                    key: 'exportDefaultPath',
                    value: settings.exportDefaultPath,
                    type: 'textinput',
                    title: t('settings.exportDefaultPath.title'),
                    description: t('settings.exportDefaultPath.description'),
                    placeholder: t('settings.exportDefaultPath.placeholder'),
                },
            ],
        },
        {
            name: t('settings.settingsGroup.sessionManagement') || '会话管理',
            items: [
                {
                    key: 'autoRenameSession',
                    value: settings.autoRenameSession,
                    type: 'checkbox',
                    title: t('settings.autoRenameSession.title') || '会话自动重命名',
                    description:
                        t('settings.autoRenameSession.description') ||
                        '在首次发送消息时，自动使用AI生成会话标题',
                },
            ],
        },
        {
            name: t('settings.settingsGroup.codexCli') || 'Codex CLI',
            items: [],
        },
        {
            name: t('settings.settingsGroup.reset') || 'Reset Settings',
            items: [
                {
                    key: 'reset',
                    value: '',
                    type: 'button',
                    title: t('settings.reset.title') || 'Reset Settings',
                    description:
                        t('settings.reset.description') || 'Reset all settings to default values',
                    button: {
                        label: t('settings.reset.label') || 'Reset',
                        callback: async () => {
                            confirm(
                                t('settings.reset.title') || 'Reset Settings',
                                t('settings.reset.confirmMessage') ||
                                    'Are you sure you want to reset all settings to default values? This action cannot be undone.',
                                async () => {
                                    // 确认回调
                                    settings = { ...getDefaultSettings() };
                                    updateGroupItems();
                                    await saveSettings();
                                    await pushMsg(t('settings.reset.message'));
                                },
                                () => {
                                    // 取消回调（可选）
                                    console.log('Reset cancelled');
                                }
                            );
                        },
                    },
                },
            ],
        },
    ];

    let focusGroup = groups[0].name;

    interface ChangeEvent {
        group: string;
        key: string;
        value: any;
    }

    const onChanged = ({ detail }: CustomEvent<ChangeEvent>) => {
        console.log(detail.key, detail.value);
        // 使用 in 操作符检查 key 是否存在，而不是检查值是否为 undefined
        // 这样可以正确处理值为 undefined 的设置项
        if (detail.key in settings) {
            settings[detail.key] = detail.value;
            saveSettings();
        }
    };

    async function saveSettings() {
        await plugin.saveSettings(settings);
    }

    onMount(async () => {
        await runload();
    });

    async function runload() {
        const loadedSettings = await plugin.loadSettings();
        settings = mergeSettingsWithDefaults(loadedSettings);

        // 确保 aiProviders 存在
        if (!settings.aiProviders) {
            settings.aiProviders = {
                gemini: { apiKey: '', customApiUrl: '', models: [] },
                deepseek: { apiKey: '', customApiUrl: '', models: [] },
                openai: { apiKey: '', customApiUrl: '', models: [] },
                moonshot: { apiKey: '', customApiUrl: '', models: [] },
                volcano: { apiKey: '', customApiUrl: '', models: [] },
                customProviders: [],
            };
        }

        // 确保每个内置平台都存在（支持旧配置升级）
        const builtInPlatformIds = [
            'gemini',
            'deepseek',
            'openai',
            'moonshot',
            'volcano',
        ];
        for (const platformId of builtInPlatformIds) {
            if (!settings.aiProviders[platformId]) {
                settings.aiProviders[platformId] = { apiKey: '', customApiUrl: '', models: [] };
            }
        }

        // 确保 customProviders 数组存在
        if (!settings.aiProviders.customProviders) {
            settings.aiProviders.customProviders = [];
        }

        // 恢复选中的平台ID（仅用于设置面板显示）
        // 优先使用 selectedProviderId，如果不存在则使用 currentProvider 作为初始值
        selectedProviderId = settings.selectedProviderId || settings.currentProvider || 'openai';

        // 确保 selectedProviderId 设置被保存
        if (!settings.selectedProviderId) {
            settings.selectedProviderId = selectedProviderId;
        }

        // 加载笔记本列表
        await loadNotebooks();

        await refreshCodexModels(false);
        await refreshCodexSkills(false);

        updateGroupItems();

        // console.debug(t('common.configComplete'));
    }

    // 加载笔记本列表
    async function loadNotebooks() {
        try {
            const notebooks = await lsNotebooks();
            if (notebooks?.notebooks && notebooks.notebooks.length > 0) {
                // 构建笔记本选项对象 { id: name }，只显示 closed=false 的笔记本
                notebookOptions = {};
                notebookOptions[''] =
                    t('settings.exportNotebook.placeholder') || '-- 请选择笔记本 --';
                notebooks.notebooks
                    .filter(notebook => notebook.closed === false)
                    .forEach(notebook => {
                        notebookOptions[notebook.id] = notebook.name;
                    });
            } else {
                notebookOptions = {
                    '': t('settings.exportNotebook.placeholder') || '-- 请选择笔记本 --',
                };
            }
        } catch (error) {
            console.error('Load notebooks error:', error);
            notebookOptions = {
                '': t('settings.exportNotebook.placeholder') || '-- 请选择笔记本 --',
            };
        }
    }

    function updateGroupItems() {
        groups = groups.map(group => ({
            ...group,
            items: group.items.map(item => {
                const updatedItem: any = {
                    ...item,
                    value: settings[item.key] ?? item.value,
                };
                // 为笔记本选择器更新 options
                if (item.key === 'exportNotebook') {
                    updatedItem.options = notebookOptions;
                }
                return updatedItem;
            }),
        }));
    }

    $: {
        const refreshKey = String(settings?.codexWorkingDir || '').trim();
        if (refreshKey !== codexSkillsRefreshKey) {
            codexSkillsRefreshKey = refreshKey;
            void refreshCodexSkills(false);
        }
    }

    $: selectedSkill = codexSkillOptions.find(skill => skill.key === selectedSkillKey) || null;
    $: {
        if (!selectedSkill) {
            syncSkillEditorFields(null);
        } else if (skillEditorSelectedKey !== selectedSkill.key) {
            syncSkillEditorFields(selectedSkill);
        }
    }

    $: currentGroup = groups.find(group => group.name === focusGroup);
</script>

<div class="fn__flex-1 fn__flex config__panel">
    <ul class="b3-tab-bar b3-list b3-list--background">
        {#each groups as group}
            <li
                data-name="editor"
                class:b3-list-item--focus={group.name === focusGroup}
                class="b3-list-item"
                on:click={() => {
                    focusGroup = group.name;
                }}
                on:keydown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        focusGroup = group.name;
                    }
                }}
                role="tab"
                tabindex="0"
            >
                <span class="b3-list-item__text">{group.name}</span>
            </li>
        {/each}
    </ul>
    <div class="config__tab-wrap">
        {#if focusGroup === t('settings.settingsGroup.systemPrompt')}
            <div class="system-prompt-panel">
                <SettingPanel
                    group={currentGroup?.name || ''}
                    settingItems={currentGroup?.items || []}
                    display={true}
                    on:changed={onChanged}
                />

                <div class="system-prompt-skills">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.skills.editor.title') || 'Skills 编辑'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.skills.editor.description') ||
                                '按技能逐条编辑注入提示词中的名称与说明'}
                        </div>
                    </div>

                    <div class="codex-settings__inline">
                        <select class="b3-select fn__flex-1" bind:value={selectedSkillKey}>
                            <option value="" disabled>
                                {t('settings.codex.skills.editor.selectPlaceholder') || '请选择 Skill'}
                            </option>
                            {#each codexSkillOptions as skill}
                                <option value={skill.key}>{formatSkillOptionLabel(skill)}</option>
                            {/each}
                        </select>
                        <button
                            class="b3-button b3-button--outline"
                            type="button"
                            on:click={() => refreshCodexSkills(true)}
                            disabled={isLoadingCodexSkills}
                        >
                            {isLoadingCodexSkills
                                ? t('settings.codex.skills.editor.refreshing') || '刷新中...'
                                : t('settings.codex.skills.editor.refresh') || '刷新技能'}
                        </button>
                    </div>
                    <div class="codex-settings__desc">
                        {t('settings.codex.skills.editor.count', {
                            count: String(codexSkillOptions.length),
                        }) || `共 ${codexSkillOptions.length} 个技能`}
                    </div>

                    {#if codexSkillOptions.length === 0}
                        <div class="codex-settings__desc">
                            {t('settings.codex.skills.editor.empty') ||
                                '未读取到技能，请检查工作目录或插件目录中的 skills/'}
                        </div>
                    {:else if selectedSkill}
                        <div class="codex-skill-item">
                            <div class="codex-skill-item__header">
                                <span>{selectedSkill.name}</span>
                                <span class="codex-skill-item__path">{selectedSkill.relativePath}</span>
                            </div>
                            <div class="codex-settings__desc">
                                {t('settings.codex.skills.editor.sourceLabel') || '来源'}:
                                {selectedSkill.source === 'workspace' ? 'workspace' : 'plugin'}
                            </div>
                            <div class="codex-settings__desc">
                                {t('settings.codex.skills.editor.defaultDescriptionLabel') ||
                                    '默认说明'}: {selectedSkill.description}
                            </div>
                            <div class="codex-skill-item__controls">
                                <div class="codex-skill-field">
                                    <div class="codex-settings__desc">
                                        {t('settings.codex.skills.editor.nameLabel') || '显示名称'}
                                    </div>
                                    <input
                                        class="b3-text-field"
                                        type="text"
                                        bind:value={skillEditorName}
                                        placeholder={t('settings.codex.skills.editor.namePlaceholder') ||
                                            '覆盖名称（留空使用默认）'}
                                    />
                                </div>
                                <div class="codex-skill-field codex-skill-field--full">
                                    <div class="codex-settings__desc">
                                        {t('settings.codex.skills.editor.descriptionLabel') ||
                                            '显示说明'}
                                    </div>
                                    <textarea
                                        class="b3-text-field"
                                        rows="3"
                                        bind:value={skillEditorDescription}
                                        placeholder={t('settings.codex.skills.editor.descriptionPlaceholder') ||
                                            '覆盖说明（留空使用默认）'}
                                    ></textarea>
                                </div>
                                <div class="codex-skill-actions">
                                    <button
                                        class="b3-button b3-button--outline"
                                        type="button"
                                        on:click={saveSkillEditorFields}
                                    >
                                        {t('settings.codex.skills.editor.save') || '保存'}
                                    </button>
                                    <button
                                        class="b3-button b3-button--text"
                                        type="button"
                                        on:click={resetSkillEditorFields}
                                    >
                                        {t('settings.codex.skills.editor.reset') || '恢复默认'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    {/if}
                </div>
            </div>
        {:else if ENABLE_PLATFORM_MANAGEMENT &&
            focusGroup === t('settings.settingsGroup.platformManagement')}
            <!-- 新的侧边栏布局：左侧为平台列表/操作，右侧为平台配置主区域 -->
            <div class="platform-management-layout">
                <aside class="platform-sidebar">
                    <div class="unified-platform-manager">
                        <div class="manager-header">
                            <h5>{t('platform.management')}</h5>
                            <button
                                class="b3-button b3-button--outline"
                                on:click={() => (showAddPlatform = !showAddPlatform)}
                            >
                                {showAddPlatform ? t('platform.cancel') : t('platform.add')}
                            </button>
                        </div>

                        {#if showAddPlatform}
                            <div class="add-platform-form">
                                <div>
                                    <div>{t('platform.name')}</div>
                                    <input
                                        class="b3-text-field fn__flex-1"
                                        type="text"
                                        bind:value={newPlatformName}
                                        placeholder={t('platform.namePlaceholder')}
                                        on:keydown={e => e.key === 'Enter' && addCustomPlatform()}
                                    />
                                </div>
                                <button
                                    class="b3-button b3-button--outline"
                                    on:click={addCustomPlatform}
                                    disabled={!newPlatformName.trim()}
                                >
                                    {t('platform.confirmAdd')}
                                </button>
                            </div>
                        {/if}

                        <div class="platform-list">
                            {#each allProviderOptions as platform}
                                <div
                                    class="platform-item"
                                    class:platform-item--selected={selectedProviderId ===
                                        platform.id}
                                    on:click={() => {
                                        selectedProviderId = platform.id;
                                        handleProviderSelect();
                                    }}
                                    on:keydown={e => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            selectedProviderId = platform.id;
                                            handleProviderSelect();
                                        }
                                    }}
                                    role="button"
                                    tabindex="0"
                                >
                                    <div class="platform-item__info">
                                        <span class="platform-item__name">{platform.name}</span>
                                        <span class="platform-item__type">
                                            {platform.type === 'built-in'
                                                ? t('platform.type.builtin')
                                                : t('platform.type.custom')}
                                        </span>
                                    </div>
                                    <button
                                        class="b3-button b3-button--text b3-button--error"
                                        on:click|stopPropagation={() => removePlatform(platform.id)}
                                        title={t('dialogs.confirm.deletePlatform.title')}
                                    >
                                        <svg class="b3-button__icon">
                                            <use xlink:href="#iconTrashcan"></use>
                                        </svg>
                                    </button>
                                </div>
                            {/each}
                            {#if allProviderOptions.length === 0}
                                <div class="empty-hint">{t('platform.noAvailable')}</div>
                            {/if}
                        </div>
                    </div>
                </aside>

                <main class="platform-main">
                    {#if selectedProviderId}
                        {#if builtInProviderNames[selectedProviderId]}
                            {#key selectedProviderId}
                                <ProviderConfigPanel
                                    providerId={selectedProviderId}
                                    providerName={selectedProviderName}
                                    defaultApiUrl={builtInProviderDefaultUrls[selectedProviderId]}
                                    websiteUrl={builtInProviderWebsites[selectedProviderId]}
                                    bind:config={settings.aiProviders[selectedProviderId]}
                                    isCustomProvider={false}
                                    on:change={handleProviderChange}
                                />
                            {/key}
                        {:else}
                            {#each settings.aiProviders.customProviders as customProvider}
                                {#if customProvider.id === selectedProviderId}
                                    {#key customProvider.id}
                                        <ProviderConfigPanel
                                            providerId={customProvider.id}
                                            providerName={customProvider.name}
                                            defaultApiUrl=""
                                            websiteUrl=""
                                            bind:config={customProvider}
                                            isCustomProvider={true}
                                            on:change={handleProviderChange}
                                            on:rename={e =>
                                                handleProviderRename(
                                                    customProvider.id,
                                                    e.detail.newName
                                                )}
                                        />
                                    {/key}
                                {/if}
                            {/each}
                        {/if}
                    {:else}
                        <div class="no-selection">
                            {t('platform.selectHint') || '请选择一个平台以查看或编辑其配置'}
                        </div>
                    {/if}
                </main>
            </div>
        {:else if focusGroup === (t('settings.settingsGroup.sessionManagement') || '会话管理')}
            <div class="session-management-panel">
                <SettingPanel
                    group={currentGroup?.name || ''}
                    settingItems={currentGroup?.items || []}
                    display={true}
                    on:changed={onChanged}
                />

                {#if settings.autoRenameSession}
                    <div class="auto-rename-model-selector">
                        <div class="config__item">
                            <div class="config__item-label">
                                <div class="config__item-title">
                                    {t('settings.autoRenameSession.modelTitle') || '重命名模型'}
                                </div>
                                <div class="config__item-description">
                                    {t('settings.autoRenameSession.modelDescription') ||
                                        '选择用于生成会话标题的 Codex 模型（通过 Codex CLI 调用）'}
                                </div>
                            </div>
                            <div
                                class="config__item-control"
                                style="display: flex; gap: 8px; align-items: center;"
                            >
                                <select
                                    class="b3-select"
                                    bind:value={settings.autoRenameModelId}
                                    on:change={saveSettings}
                                >
                                    <option value="">
                                        {t('settings.autoRenameSession.selectModel') ||
                                            '-- 选择 Codex 模型 --'}
                                    </option>
                                    {#if settings.autoRenameModelId &&
                                        !codexModelOptions.includes(settings.autoRenameModelId)}
                                        <option value={settings.autoRenameModelId}>
                                            {settings.autoRenameModelId}
                                        </option>
                                    {/if}
                                    {#each codexModelOptions as model}
                                        <option value={model}>{model}</option>
                                    {/each}
                                </select>
                                <button
                                    class="b3-button b3-button--outline"
                                    on:click={() => refreshCodexModels(true)}
                                    disabled={isLoadingCodexModels}
                                    type="button"
                                >
                                    {isLoadingCodexModels ? '拉取中...' : '拉取模型'}
                                </button>
                                {#if codexModelOptions.length === 0}
                                    <span class="config__item-description">
                                        暂未读取到本地模型，请点击“拉取模型”
                                    </span>
                                {/if}
                            </div>
                        </div>

                        <div class="config__item" style="margin-top: 12px;">
                            <div class="config__item-label">
                                <div class="config__item-title">
                                    {t('settings.codex.reasoningEffort.title') || '思考长度'}
                                </div>
                                <div class="config__item-description">
                                    {'会话自动命名使用的思考长度，默认 low'}
                                </div>
                            </div>
                            <div class="config__item-control">
                                <select
                                    class="b3-select"
                                    bind:value={settings.autoRenameReasoningEffort}
                                    on:change={saveSettings}
                                >
                                    <option value="low">
                                        {t('settings.codex.reasoningEffort.options.low') || 'low'}
                                    </option>
                                    <option value="medium">
                                        {t('settings.codex.reasoningEffort.options.medium') || 'medium'}
                                    </option>
                                    <option value="high">
                                        {t('settings.codex.reasoningEffort.options.high') || 'high'}
                                    </option>
                                    <option value="xhigh">
                                        {t('settings.codex.reasoningEffort.options.xhigh') || 'xhigh'}
                                    </option>
                                </select>
                            </div>
                        </div>

                        <!-- 自定义提示词 -->
                        <div class="config__item" style="margin-top: 16px;">
                            <div class="config__item-label">
                                <div class="config__item-title">
                                    {t('settings.autoRenameSession.promptTitle') || '自定义提示词'}
                                </div>
                                <div class="config__item-description">
                                    {t('settings.autoRenameSession.promptDescription') ||
                                        '自定义生成会话标题的提示词，使用 {message} 作为用户消息的占位符'}
                                </div>
                            </div>
                            <div class="config__item-control">
                                <textarea
                                    class="b3-text-field"
                                    rows="4"
                                    bind:value={settings.autoRenamePrompt}
                                    on:change={saveSettings}
                                    placeholder={t(
                                        'settings.autoRenameSession.promptPlaceholder'
                                    ) ||
                                        '请根据以下用户消息生成一个简洁的会话标题（不超过20个字，不要使用引号）：\n\n{message}'}
                                ></textarea>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        {:else if focusGroup === (t('settings.settingsGroup.codexCli') || 'Codex CLI')}
            <div class="config__tab-container_plugin codex-settings-container">
                <div class="codex-settings">
                <div class="codex-settings__header">
                    <h5>{t('settings.codex.title') || 'Codex CLI'}</h5>
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.enabled.title') || '启用 Codex CLI'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.enabled.description') || ''}
                            {` `}
                            {t('settings.codex.enabled.fixed') ||
                                '当前插件为 Codex-only，已固定启用。'}
                        </div>
                    </div>
                    <input
                        class="b3-switch"
                        type="checkbox"
                        checked={true}
                        disabled={true}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.cliPath.title') || 'Codex 路径'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.cliPath.description') || ''}
                        </div>
                    </div>
                    <div class="codex-settings__inline">
                        <input
                            class="b3-text-field fn__flex-1"
                            type="text"
                            value={settings.codexCliPath || ''}
                            placeholder="codex 或 C:\\Users\\...\\codex.cmd"
                            on:change={e => setSetting('codexCliPath', e.target.value)}
                        />
                        <button
                            class="b3-button b3-button--outline"
                            on:click={detectCodexCliPath}
                            type="button"
                        >
                            {t('settings.codex.detectCliPath') || '自动探测'}
                        </button>
                    </div>
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.workingDir.title') || '工作目录（--cd）'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.workingDir.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-text-field fn__flex-1"
                        type="text"
                        value={settings.codexWorkingDir || ''}
                        placeholder="C:\\path\\to\\siyuan-workspace"
                        on:change={e => setSetting('codexWorkingDir', e.target.value)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.runMode.title') || '执行权限'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.runMode.description') || ''}
                        </div>
                    </div>
                    <select
                        class="b3-select"
                        value={settings.codexRunMode || 'read_only'}
                        on:change={e => {
                            const next = e.target.value;
                            if (next === 'fully_open') {
                                confirm(
                                    t('settings.codex.runMode.options.fullyOpen') ||
                                        '完全放开（危险）',
                                    t('settings.codex.runMode.fullyOpenWarning') ||
                                        '完全放开模式风险极高，是否继续？',
                                    () => setSetting('codexRunMode', 'fully_open'),
                                    () => setSetting('codexRunMode', 'read_only')
                                );
                                return;
                            }
                            setSetting('codexRunMode', next);
                        }}
                    >
                        <option value="read_only">
                            {t('settings.codex.runMode.options.readOnly') || '只读（推荐）'}
                        </option>
                        <option value="workspace_write">
                            {t('settings.codex.runMode.options.workspaceWrite') || '工作区可写'}
                        </option>
                        <option value="fully_open">
                            {t('settings.codex.runMode.options.fullyOpen') || '完全放开（危险）'}
                        </option>
                    </select>
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.skipGitRepoCheck.title') || '允许非 Git 目录'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.skipGitRepoCheck.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-switch"
                        type="checkbox"
                        checked={settings.codexSkipGitRepoCheck !== false}
                        on:change={e => setSetting('codexSkipGitRepoCheck', !!e.target.checked)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.diffPreferGit.title') || 'Diff 优先使用 git'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.diffPreferGit.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-switch"
                        type="checkbox"
                        checked={settings.codexDiffPreferGit !== false}
                        on:change={e => setSetting('codexDiffPreferGit', !!e.target.checked)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.git.cliPath.title') || 'Git 路径'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.git.cliPath.description') || ''}
                        </div>
                    </div>
                    <div class="codex-settings__inline">
                        <input
                            class="b3-text-field fn__flex-1"
                            type="text"
                            value={settings.codexGitCliPath || ''}
                            placeholder="git 或 C:\\Program Files\\Git\\bin\\git.exe"
                            on:change={e => setSetting('codexGitCliPath', e.target.value)}
                        />
                        <button
                            class="b3-button b3-button--outline"
                            on:click={detectGitCliPath}
                            type="button"
                        >
                            {t('settings.codex.git.detectCliPath') || '自动探测'}
                        </button>
                    </div>
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.git.repoDir.title') || 'Git 仓库目录'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.git.repoDir.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-text-field fn__flex-1"
                        type="text"
                        value={settings.codexGitRepoDir || ''}
                        placeholder={settings.codexWorkingDir || ''}
                        on:change={e => setSetting('codexGitRepoDir', e.target.value)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.git.remote.title') || 'Git Remote'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.git.remote.description') || ''}
                        </div>
                    </div>
                    <div class="codex-settings__inline">
                        <input
                            class="b3-text-field"
                            style="width: 140px;"
                            type="text"
                            value={settings.codexGitRemoteName || 'origin'}
                            placeholder="origin"
                            on:change={e => setSetting('codexGitRemoteName', e.target.value)}
                        />
                        <input
                            class="b3-text-field fn__flex-1"
                            type="text"
                            value={settings.codexGitRemoteUrl || ''}
                            placeholder="git@github.com:user/repo.git"
                            on:change={e => setSetting('codexGitRemoteUrl', e.target.value)}
                        />
                    </div>
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.git.branch.title') || '默认分支（可选）'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.git.branch.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-text-field fn__flex-1"
                        type="text"
                        value={settings.codexGitBranch || ''}
                        placeholder={t('aiSidebar.git.branchOptional') || '可选，留空用当前分支'}
                        on:change={e => setSetting('codexGitBranch', e.target.value)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.git.syncScope.title') || '同步范围'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.git.syncScope.description') || ''}
                        </div>
                    </div>
                    <select
                        class="b3-select fn__flex-1"
                        value={settings.codexGitSyncScope || 'notes'}
                        on:change={e => setSetting('codexGitSyncScope', e.target.value)}
                    >
                        <option value="notes">
                            {t('settings.codex.git.syncScope.options.notes') ||
                                '仅笔记内容（.sy + assets）'}
                        </option>
                        <option value="repo">
                            {t('settings.codex.git.syncScope.options.repo') ||
                                '整个仓库（git add -A）'}
                        </option>
                    </select>
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.git.pullRebase.title') || 'Pull 使用 rebase'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.git.pullRebase.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-switch"
                        type="checkbox"
                        checked={settings.codexGitPullRebase !== false}
                        on:change={e => setSetting('codexGitPullRebase', !!e.target.checked)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.git.pullAutostash.title') ||
                                'Pull 自动暂存本地改动'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.git.pullAutostash.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-switch"
                        type="checkbox"
                        checked={settings.codexGitPullAutostash !== false}
                        on:change={e => setSetting('codexGitPullAutostash', !!e.target.checked)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.git.autoSyncEnabled.title') || '自动同步（可选）'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.git.autoSyncEnabled.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-switch"
                        type="checkbox"
                        checked={settings.codexGitAutoSyncEnabled === true}
                        on:change={e => setSetting('codexGitAutoSyncEnabled', !!e.target.checked)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.git.autoCommitMessage.title') || '自动提交信息（可选）'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.git.autoCommitMessage.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-text-field fn__flex-1"
                        type="text"
                        value={settings.codexGitAutoCommitMessage || ''}
                        placeholder={t('aiSidebar.git.commitPlaceholder') || '输入 commit message'}
                        on:change={e => setSetting('codexGitAutoCommitMessage', e.target.value)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            模型列表来源
                        </div>
                        <div class="codex-settings__desc">
                            自动读取本地 Codex 配置（`config.toml`），不依赖远端模型接口
                        </div>
                    </div>
                    <span
                        class="codex-settings__status"
                        class:codex-settings__status--ready={codexLocalConfigPaths.length > 0}
                        class:codex-settings__status--missing={codexLocalConfigPaths.length === 0}
                    >
                        {codexLocalConfigPaths.length > 0
                            ? `已检测到 ${codexLocalConfigPaths.length} 个本地配置`
                            : '未检测到本地配置'}
                    </span>
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.modelOverride.title') || '模型覆盖（可选）'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.modelOverride.description') || ''}
                        </div>
                    </div>
                    <div class="codex-settings__inline">
                        <select
                            class="b3-select fn__flex-1"
                            value={settings.codexModelOverride || ''}
                            on:change={e => setSetting('codexModelOverride', e.target.value)}
                        >
                            <option value="">
                                {t('aiSidebar.codex.modelOverridePlaceholder') || '留空使用默认'}
                            </option>
                            {#if settings.codexModelOverride &&
                                !codexModelOptions.includes(settings.codexModelOverride)}
                                <option value={settings.codexModelOverride}>
                                    {settings.codexModelOverride}
                                </option>
                            {/if}
                            {#each codexModelOptions as model}
                                <option value={model}>{model}</option>
                            {/each}
                        </select>
                        <button
                            class="b3-button b3-button--outline"
                            type="button"
                            disabled={isLoadingCodexModels}
                            on:click={() => refreshCodexModels(true)}
                        >
                            {isLoadingCodexModels ? '拉取中...' : '拉取模型'}
                        </button>
                    </div>
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.reasoningEffort.title') || '思考长度'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.reasoningEffort.description') ||
                                '传递给 Codex 的 reasoning effort（留空使用本地配置默认值）'}
                        </div>
                    </div>
                    <select
                        class="b3-select"
                        value={settings.codexReasoningEffort || ''}
                        on:change={e => setSetting('codexReasoningEffort', e.target.value)}
                    >
                        <option value="">
                            {t('settings.codex.reasoningEffort.options.default') || '使用配置默认'}
                        </option>
                        <option value="low">
                            {t('settings.codex.reasoningEffort.options.low') || 'low'}
                        </option>
                        <option value="medium">
                            {t('settings.codex.reasoningEffort.options.medium') || 'medium'}
                        </option>
                        <option value="high">
                            {t('settings.codex.reasoningEffort.options.high') || 'high'}
                        </option>
                        <option value="xhigh">
                            {t('settings.codex.reasoningEffort.options.xhigh') || 'xhigh'}
                        </option>
                    </select>
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.siyuanApiUrl.title') || 'SiYuan API 地址'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.siyuanApiUrl.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-text-field fn__flex-1"
                        type="text"
                        value={settings.siyuanApiUrl || ''}
                        placeholder="http://127.0.0.1:6806"
                        on:change={e => setSetting('siyuanApiUrl', e.target.value)}
                    />
                </div>

                <div class="codex-settings__row">
                    <div class="codex-settings__label">
                        <div class="codex-settings__title">
                            {t('settings.codex.siyuanApiToken.title') || 'SiYuan API Token'}
                        </div>
                        <div class="codex-settings__desc">
                            {t('settings.codex.siyuanApiToken.description') || ''}
                        </div>
                    </div>
                    <input
                        class="b3-text-field fn__flex-1"
                        type="password"
                        value={settings.siyuanApiToken || ''}
                        placeholder="Token"
                        on:change={e => setSetting('siyuanApiToken', e.target.value)}
                    />
                </div>

                </div>
            </div>
        {:else}
            <SettingPanel
                group={currentGroup?.name || ''}
                settingItems={currentGroup?.items || []}
                display={true}
                on:changed={onChanged}
            />
        {/if}
    </div>
</div>

<style lang="scss">
    .config__panel {
        height: 100%;
        display: flex;
        flex-direction: row;
        overflow: hidden;
    }
    .config__panel > .b3-tab-bar {
        width: 170px;
    }

    .config__tab-wrap {
        flex: 1;
        height: 100%;
        min-height: 0;
        overflow: hidden;
        padding: 2px;
        display: flex;
        flex-direction: column;
    }
    .system-prompt-panel {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-y: auto;
        padding-right: 4px;
    }
    .system-prompt-skills {
        margin: 0 2px 8px;
        padding: 12px;
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        background: var(--b3-theme-surface);
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .codex-settings-container {
        flex: 1;
        height: 100%;
        max-height: 100%;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        -webkit-overflow-scrolling: touch;
    }

    /* 平台管理：侧边栏布局 */
    .platform-management-layout {
        display: flex;
        gap: 16px;
        flex: 1;
        min-height: 0;
        align-items: stretch;
    }

    .platform-sidebar {
        width: 260px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .platform-main {
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }

    .no-selection {
        padding: 24px;
        background: var(--b3-theme-background);
        border: 1px dashed var(--b3-border-color);
        border-radius: 6px;
        color: var(--b3-theme-on-surface-light);
    }

    .unified-platform-manager {
        background: var(--b3-theme-surface);
        border-radius: 6px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    .manager-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;

        h5 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-surface);
        }
    }

    .add-platform-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background: var(--b3-theme-background);
        border-radius: 4px;
        margin-bottom: 16px;
    }

    .platform-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        overflow-y: auto;
        min-height: 0;
    }

    .platform-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px;
        background: var(--b3-theme-background);
        border-radius: 6px;
        border: 1px solid var(--b3-border-color);
        cursor: pointer;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-surface);
            border-color: var(--b3-theme-primary);
        }

        &.platform-item--selected {
            background: var(--b3-theme-primary-lightest);
            border-color: var(--b3-theme-primary);
        }
    }

    .platform-item__info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
    }

    .platform-item__name {
        font-size: 14px;
        font-weight: 500;
        color: var(--b3-theme-on-background);
    }

    .platform-item__type {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        padding: 2px 6px;
        background: var(--b3-theme-surface);
        border-radius: 10px;
        align-self: flex-start;
    }

    .empty-hint {
        padding: 20px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
    }

    .session-management-panel {
        display: flex;
        flex-direction: column;
        gap: 16px;
        flex: 1;
        overflow-y: auto;
    }

    .auto-rename-model-selector {
        padding: 16px;
        background: var(--b3-theme-surface);
        border-radius: 6px;
        margin-top: 8px;
    }

    .config__item {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .config__item-label {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .config__item-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--b3-theme-on-background);
    }

    .config__item-description {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.5;
    }

    .config__item-control {
        display: flex;
        gap: 8px;
        align-items: center;

        .b3-select {
            flex: 1;
            min-width: 0;
        }

        textarea.b3-text-field {
            width: 100%;
            min-height: 80px;
            padding: 8px 12px;
            font-size: 13px;
            line-height: 1.6;
            font-family: var(--b3-font-family);
            resize: vertical;

            &::placeholder {
                color: var(--b3-theme-on-surface-light);
                opacity: 0.6;
            }
        }
    }

    .codex-settings {
        padding: 12px;
        min-height: max-content;
    }
    .codex-settings__header h5 {
        margin: 0 0 12px 0;
    }
    .codex-settings__row {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid var(--b3-border-color);
    }
    .codex-settings__label {
        flex: 1;
        min-width: 260px;
    }
    .codex-settings__title {
        font-weight: 600;
        margin-bottom: 4px;
    }
    .codex-settings__desc {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.4;
    }
    .codex-settings__inline {
        display: flex;
        gap: 8px;
        align-items: center;
        flex: 1;
    }
    .codex-skill-item {
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        padding: 8px;
        background: var(--b3-theme-surface);
    }
    .codex-skill-item__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
        font-size: 13px;
        color: var(--b3-theme-on-surface);
    }
    .codex-skill-item__path {
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        word-break: break-all;
    }
    .codex-skill-item__controls {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 8px;
    }
    .codex-skill-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .codex-skill-field--full textarea {
        min-height: 78px;
        resize: vertical;
    }
    .codex-skill-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
    }
    .codex-settings__status {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
        color: var(--b3-theme-on-surface);
        white-space: nowrap;
    }
    .codex-settings__status--ready {
        color: var(--b3-theme-primary);
        border-color: var(--b3-theme-primary-light);
        background: var(--b3-theme-primary-lightest);
    }
    .codex-settings__status--missing {
        color: var(--b3-theme-on-surface-light);
    }
</style>
