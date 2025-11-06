<script lang="ts">
    import { onMount } from 'svelte';
    import SettingPanel from '@/libs/components/setting-panel.svelte';
    import { t } from './utils/i18n';
    import { getDefaultSettings } from './defaultSettings';
    import { pushMsg, pushErrMsg } from './api';
    import { confirm } from 'siyuan';
    import ProviderConfigPanel from './components/ProviderConfigPanel.svelte';
    import type { CustomProviderConfig } from './defaultSettings';
    export let plugin;

    // 使用动态默认设置
    let settings = { ...getDefaultSettings() };

    interface ISettingGroup {
        name: string;
        items: ISettingItem[];
        //  Type："checkbox" | "select" | "textinput" | "textarea" | "number" | "slider" | "button" | "hint" | "custom";
    }

    const builtInProviderNames: Record<string, string> = {
        gemini: t('platform.builtIn.gemini'),
        deepseek: t('platform.builtIn.deepseek'),
        openai: t('platform.builtIn.openai'),
        volcano: t('platform.builtIn.volcano'),
    };

    // 内置平台的默认 API 地址
    const builtInProviderDefaultUrls: Record<string, string> = {
        gemini: 'https://generativelanguage.googleapis.com',
        deepseek: 'https://api.deepseek.com',
        openai: 'https://api.openai.com',
        volcano: 'https://ark.cn-beijing.volces.com',
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
        {
            name: t('settings.settingsGroup.platformManagement'),
            items: [],
        },
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
        const setting = settings[detail.key];
        if (setting !== undefined) {
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
        settings = { ...loadedSettings };

        // 确保 aiProviders 存在
        if (!settings.aiProviders) {
            settings.aiProviders = {
                gemini: { apiKey: '', customApiUrl: '', models: [] },
                deepseek: { apiKey: '', customApiUrl: '', models: [] },
                openai: { apiKey: '', customApiUrl: '', models: [] },
                volcano: { apiKey: '', customApiUrl: '', models: [] },
                customProviders: [],
            };
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

        updateGroupItems();
        // 确保设置已保存（可能包含新的默认值）
        await saveSettings();

        console.debug(t('common.configComplete'));
    }

    function updateGroupItems() {
        groups = groups.map(group => ({
            ...group,
            items: group.items.map(item => ({
                ...item,
                value: settings[item.key] ?? item.value,
            })),
        }));
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
            <SettingPanel
                group={currentGroup?.name || ''}
                settingItems={currentGroup?.items || []}
                display={true}
                on:changed={onChanged}
            />
        {:else if focusGroup === t('settings.settingsGroup.platformManagement')}
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
                                        title="删除平台"
                                    >
                                        <svg class="b3-button__icon">
                                            <use xlink:href="#iconTrashcan"></use>
                                        </svg>
                                    </button>
                                </div>
                            {/each}
                            {#if allProviderOptions.length === 0}
                                <div class="empty-hint">暂无可用平台</div>
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
        overflow: hidden;
        padding: 2px;
        display: flex;
        flex-direction: column;
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
</style>
