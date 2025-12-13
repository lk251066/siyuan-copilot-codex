<script lang="ts">
    import { createEventDispatcher, tick, onMount } from 'svelte';
    import { t } from '../utils/i18n';
    import { pushMsg } from '@/api';
    import { confirm } from 'siyuan';

    export let providers: Record<string, any> = {};
    export let currentProvider = '';
    export let currentModelId = '';
    export let appliedSettings = {
        contextCount: 10,
        temperature: 0.7,
        temperatureEnabled: true,
        systemPrompt: '',
        modelSelectionEnabled: false,
        selectedModels: [] as Array<{ provider: string; modelId: string }>,
        enableMultiModel: false,
        chatMode: 'ask' as 'ask' | 'edit' | 'agent',
        modelThinkingSettings: {} as Record<string, boolean>,
    };
    export let plugin: any;

    const dispatch = createEventDispatcher();

    let isOpen = false;
    let dropdownTop = 0;
    let dropdownLeft = 0;
    let buttonElement: HTMLButtonElement;
    let dropdownElement: HTMLDivElement;

    // 模型设置（临时值，用于编辑）
    let tempContextCount = 10;
    let tempTemperature = 0.7;
    let tempTemperatureEnabled = false; // 是否启用temperature调整
    let tempSystemPrompt = '';
    let tempModelSelectionEnabled = false; // 是否启用模型选择
    let tempSelectedModels: Array<{ provider: string; modelId: string }> = []; // 选中的模型列表
    let tempEnableMultiModel = false; // 是否启用多模型模式
    let tempChatMode: 'ask' | 'edit' | 'agent' = 'ask'; // 聊天模式
    let tempModelThinkingSettings: Record<string, boolean> = {}; // 每个模型的thinking设置 {provider:modelId: boolean}

    // 预设管理
    interface Preset {
        id: string;
        name: string;
        contextCount: number;
        temperature: number;
        temperatureEnabled: boolean; // 是否启用temperature调整
        systemPrompt: string;
        modelSelectionEnabled: boolean; // 是否启用模型选择
        selectedModels: Array<{ provider: string; modelId: string }>; // 选中的模型列表
        enableMultiModel: boolean; // 是否启用多模型模式
        chatMode: 'ask' | 'edit' | 'agent'; // 聊天模式
        modelThinkingSettings?: Record<string, boolean>; // 每个模型的thinking设置
        createdAt: number;
    }

    let presets: Preset[] = [];
    let selectedPresetId: string = '';
    let newPresetName = '';
    let isPresetMenuOpen = false; // 预设菜单是否打开
    let presetMenuButtonElement: HTMLElement; // 预设菜单按钮元素
    let presetMenuElement: HTMLElement; // 预设菜单元素

    // 获取当前模型配置
    function getCurrentModelConfig() {
        if (!currentProvider || !currentModelId) return null;

        let providerConfig: any = null;
        if (providers[currentProvider] && !Array.isArray(providers[currentProvider])) {
            providerConfig = providers[currentProvider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            providerConfig = providers.customProviders.find((p: any) => p.id === currentProvider);
        }

        if (!providerConfig) return null;
        return providerConfig.models.find((m: any) => m.id === currentModelId);
    }

    // 获取所有可用模型
    function getAllAvailableModels(): Array<{
        provider: string;
        modelId: string;
        modelName: string;
        providerName: string;
        supportsThinking: boolean;
    }> {
        const models: Array<{
            provider: string;
            modelId: string;
            modelName: string;
            providerName: string;
            supportsThinking: boolean;
        }> = [];

        // 遍历内置提供商
        for (const [providerId, providerConfig] of Object.entries(providers)) {
            if (
                providerId === 'customProviders' ||
                !providerConfig ||
                Array.isArray(providerConfig)
            )
                continue;

            const providerName = providerId;
            if (providerConfig.models && Array.isArray(providerConfig.models)) {
                for (const model of providerConfig.models) {
                    models.push({
                        provider: providerId,
                        modelId: model.id,
                        modelName: model.name || model.id,
                        providerName: providerName,
                        supportsThinking: model.capabilities?.thinking || false,
                    });
                }
            }
        }

        // 遍历自定义提供商
        if (providers.customProviders && Array.isArray(providers.customProviders)) {
            for (const provider of providers.customProviders) {
                if (provider.models && Array.isArray(provider.models)) {
                    for (const model of provider.models) {
                        models.push({
                            provider: provider.id,
                            modelId: model.id,
                            modelName: model.name || model.id,
                            providerName: provider.name,
                            supportsThinking: model.capabilities?.thinking || false,
                        });
                    }
                }
            }
        }

        return models;
    }

    // 加载预设
    async function loadPresets() {
        const settings = await plugin.loadSettings();
        presets = settings.modelPresets || [];
        selectedPresetId = settings.selectedModelPresetId || '';
    }

    // 保存预设到设置
    async function savePresetsToStorage() {
        const settings = await plugin.loadSettings();
        settings.modelPresets = presets;
        await plugin.saveSettings(settings);
    }

    // 保存选中的预设ID
    async function saveSelectedPresetId(presetId: string) {
        const settings = await plugin.loadSettings();
        settings.selectedModelPresetId = presetId;
        await plugin.saveSettings(settings);
    }

    // 加载选中的预设ID
    async function loadSelectedPresetId(): Promise<string> {
        const settings = await plugin.loadSettings();
        return settings.selectedModelPresetId || '';
    }

    // 保存当前设置为预设
    async function saveAsPreset() {
        if (!newPresetName.trim()) {
            pushMsg(t('aiSidebar.modelSettings.enterPresetName'));
            return;
        }

        const preset: Preset = {
            id: Date.now().toString(),
            name: newPresetName.trim(),
            contextCount: tempContextCount,
            temperature: tempTemperature,
            temperatureEnabled: tempTemperatureEnabled,
            systemPrompt: tempSystemPrompt,
            modelSelectionEnabled: tempModelSelectionEnabled,
            selectedModels: tempSelectedModels,
            enableMultiModel: tempEnableMultiModel,
            chatMode: tempChatMode,
            modelThinkingSettings: tempModelThinkingSettings,
            createdAt: Date.now(),
        };

        presets = [...presets, preset];
        await savePresetsToStorage();
        newPresetName = '';
        // 不关闭预设管理器
        // showPresetManager = false;

        // 自动选择新建的预设
        selectedPresetId = preset.id;
        await saveSelectedPresetId(preset.id);

        pushMsg(t('aiSidebar.modelSettings.presetSaved'));
    }

    // 加载预设
    async function loadPreset(presetId: string) {
        // 如果点击的是已选择的预设，则取消选择
        if (selectedPresetId === presetId) {
            selectedPresetId = '';
            await saveSelectedPresetId('');
            // 重置为当前应用的设置
            await resetToAppliedSettings();
            return;
        }

        const preset = presets.find(p => p.id === presetId);
        if (preset) {
            tempContextCount = preset.contextCount;
            tempTemperature = preset.temperature;
            tempTemperatureEnabled = preset.temperatureEnabled ?? true; // 兼容旧预设
            tempSystemPrompt = preset.systemPrompt;
            tempModelSelectionEnabled = preset.modelSelectionEnabled ?? false; // 兼容旧预设
            tempSelectedModels = [...(preset.selectedModels || [])]; // 创建新数组引用
            tempEnableMultiModel = preset.enableMultiModel ?? false;
            tempChatMode = preset.chatMode || 'ask'; // 兼容旧预设
            tempModelThinkingSettings = { ...(preset.modelThinkingSettings || {}) }; // 创建新对象引用
            selectedPresetId = presetId;
            // 保存选中的预设ID
            await saveSelectedPresetId(presetId);

            // 立即应用设置，确保UI更新
            applySettings();
        }
    }

    // 删除预设
    function deletePreset(presetId: string) {
        // 临时移除外部点击监听器，防止确认对话框关闭dropdown
        document.removeEventListener('click', closeOnOutsideClick);

        confirm(
            t('aiSidebar.modelSettings.deletePreset'),
            t('aiSidebar.modelSettings.confirmDelete'),
            async () => {
                presets = presets.filter(p => p.id !== presetId);
                await savePresetsToStorage();
                if (selectedPresetId === presetId) {
                    selectedPresetId = '';
                    await saveSelectedPresetId('');
                }
                pushMsg(t('aiSidebar.modelSettings.presetDeleted'));

                // 重新添加外部点击监听器
                setTimeout(() => {
                    if (isOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            },
            () => {
                // 用户取消删除，重新添加外部点击监听器
                setTimeout(() => {
                    if (isOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            }
        );
    }

    // 更新预设
    async function updatePreset(presetId: string) {
        const preset = presets.find(p => p.id === presetId);
        if (preset) {
            preset.contextCount = tempContextCount;
            preset.temperature = tempTemperature;
            preset.temperatureEnabled = tempTemperatureEnabled;
            preset.systemPrompt = tempSystemPrompt;
            preset.modelSelectionEnabled = tempModelSelectionEnabled;
            preset.selectedModels = tempSelectedModels;
            preset.enableMultiModel = tempEnableMultiModel;
            preset.chatMode = tempChatMode;
            preset.modelThinkingSettings = tempModelThinkingSettings;
            await savePresetsToStorage();
            // 触发响应式更新
            presets = [...presets];
            pushMsg(t('aiSidebar.modelSettings.presetUpdated'));
        }
    }

    // 实时应用设置
    function applySettings() {
        dispatch('apply', {
            contextCount: tempContextCount,
            temperature: tempTemperature,
            temperatureEnabled: tempTemperatureEnabled,
            systemPrompt: tempSystemPrompt,
            modelSelectionEnabled: tempModelSelectionEnabled,
            selectedModels: tempSelectedModels,
            enableMultiModel: tempEnableMultiModel,
            chatMode: tempChatMode,
            modelThinkingSettings: tempModelThinkingSettings,
        });
    }

    // 比较两个模型数组是否相等
    function areModelsEqual(
        models1: Array<{ provider: string; modelId: string }>,
        models2: Array<{ provider: string; modelId: string }>
    ): boolean {
        if (models1.length !== models2.length) return false;
        return models1.every((m1, index) => {
            const m2 = models2[index];
            return m1.provider === m2.provider && m1.modelId === m2.modelId;
        });
    }

    // 比较两个thinking settings对象是否相等
    function areThinkingSettingsEqual(
        settings1: Record<string, boolean>,
        settings2: Record<string, boolean>
    ): boolean {
        const keys1 = Object.keys(settings1);
        const keys2 = Object.keys(settings2);
        if (keys1.length !== keys2.length) return false;
        return keys1.every(key => settings1[key] === settings2[key]);
    }

    // 监听设置值的变化，自动应用
    $: if (
        isOpen &&
        (tempContextCount !== appliedSettings.contextCount ||
            tempTemperature !== appliedSettings.temperature ||
            tempTemperatureEnabled !== appliedSettings.temperatureEnabled ||
            tempSystemPrompt !== appliedSettings.systemPrompt ||
            tempModelSelectionEnabled !== (appliedSettings.modelSelectionEnabled ?? false) ||
            !areModelsEqual(tempSelectedModels, appliedSettings.selectedModels || []) ||
            tempEnableMultiModel !== (appliedSettings.enableMultiModel ?? false) ||
            tempChatMode !== (appliedSettings.chatMode ?? 'ask') ||
            !areThinkingSettingsEqual(
                tempModelThinkingSettings,
                appliedSettings.modelThinkingSettings || {}
            ))
    ) {
        applySettings();

        // 如果有选中的预设，检查当前值是否与预设匹配
        if (selectedPresetId) {
            const selectedPreset = presets.find(p => p.id === selectedPresetId);
            if (selectedPreset) {
                // 如果当前值与预设不匹配，取消选择
                if (
                    selectedPreset.contextCount !== tempContextCount ||
                    selectedPreset.temperature !== tempTemperature ||
                    (selectedPreset.temperatureEnabled ?? true) !== tempTemperatureEnabled ||
                    selectedPreset.systemPrompt !== tempSystemPrompt ||
                    (selectedPreset.modelSelectionEnabled ?? false) !== tempModelSelectionEnabled ||
                    !areModelsEqual(selectedPreset.selectedModels || [], tempSelectedModels) ||
                    (selectedPreset.enableMultiModel ?? false) !== tempEnableMultiModel ||
                    (selectedPreset.chatMode || 'ask') !== tempChatMode ||
                    !areThinkingSettingsEqual(
                        selectedPreset.modelThinkingSettings || {},
                        tempModelThinkingSettings
                    )
                ) {
                    selectedPresetId = '';
                    saveSelectedPresetId('');
                }
            }
        }
    }

    // 重置临时值为当前应用的设置
    async function resetToAppliedSettings() {
        tempContextCount = appliedSettings.contextCount;
        tempTemperature = appliedSettings.temperature;
        tempTemperatureEnabled = appliedSettings.temperatureEnabled ?? true;
        tempSystemPrompt = appliedSettings.systemPrompt;
        tempModelSelectionEnabled = appliedSettings.modelSelectionEnabled ?? false;
        tempSelectedModels = [...(appliedSettings.selectedModels || [])]; // 创建新数组引用
        tempEnableMultiModel = appliedSettings.enableMultiModel ?? false;
        tempChatMode = appliedSettings.chatMode ?? 'ask';
        tempModelThinkingSettings = { ...(appliedSettings.modelThinkingSettings || {}) }; // 创建新对象引用

        // 检查当前应用的设置是否与某个预设匹配
        const savedPresetId = await loadSelectedPresetId();
        if (savedPresetId) {
            const preset = presets.find(p => p.id === savedPresetId);
            if (
                preset &&
                preset.contextCount === appliedSettings.contextCount &&
                preset.temperature === appliedSettings.temperature &&
                (preset.temperatureEnabled ?? true) ===
                    (appliedSettings.temperatureEnabled ?? true) &&
                preset.systemPrompt === appliedSettings.systemPrompt &&
                (preset.modelSelectionEnabled ?? false) ===
                    (appliedSettings.modelSelectionEnabled ?? false) &&
                areModelsEqual(preset.selectedModels || [], appliedSettings.selectedModels || []) &&
                (preset.enableMultiModel ?? false) ===
                    (appliedSettings.enableMultiModel ?? false) &&
                (preset.chatMode || 'ask') === (appliedSettings.chatMode ?? 'ask') &&
                areThinkingSettingsEqual(
                    preset.modelThinkingSettings || {},
                    appliedSettings.modelThinkingSettings || {}
                )
            ) {
                // 设置匹配，保持预设选择
                selectedPresetId = savedPresetId;
            } else {
                // 设置不匹配，清空预设选择
                selectedPresetId = '';
            }
        } else {
            selectedPresetId = '';
        }
    }

    // 重置为默认值
    async function resetToDefaults() {
        const modelConfig = getCurrentModelConfig();
        tempContextCount = 10;
        tempTemperature = modelConfig?.temperature ?? 0.7;
        tempTemperatureEnabled = true;
        tempSystemPrompt = '';
        tempModelSelectionEnabled = false;
        tempSelectedModels = [];
        tempEnableMultiModel = false;
        tempChatMode = 'ask';
        tempModelThinkingSettings = {};
        selectedPresetId = '';
        // 清除保存的预设ID
        await saveSelectedPresetId('');
    }

    // 打开面板时，重置临时值为当前应用的设置
    async function openDropdown() {
        await resetToAppliedSettings();
        isOpen = true;
        await loadPresets();
        updateDropdownPosition();
        setTimeout(() => {
            document.addEventListener('click', closeOnOutsideClick);
        }, 0);
    }

    // 关闭下拉菜单
    function closeOnOutsideClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest('.model-settings-button')) {
            isOpen = false;
        }
    }

    // 打开/关闭下拉菜单
    function toggleDropdown() {
        if (!isOpen) {
            openDropdown();
        } else {
            isOpen = false;
            document.removeEventListener('click', closeOnOutsideClick);
        }
    }

    // 计算下拉菜单位置
    async function updateDropdownPosition() {
        if (!buttonElement || !isOpen) return;

        await tick();

        const rect = buttonElement.getBoundingClientRect();
        const dropdownWidth = dropdownElement?.offsetWidth || 360;
        const dropdownHeight = dropdownElement?.offsetHeight || 400;

        // 计算垂直位置
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        if (spaceAbove >= dropdownHeight || spaceAbove >= spaceBelow) {
            // 显示在按钮上方
            dropdownTop = rect.top - dropdownHeight - 4;
        } else {
            // 显示在按钮下方
            dropdownTop = rect.bottom + 4;
        }

        // 计算水平位置（左对齐按钮）
        dropdownLeft = rect.left;

        // 确保下拉菜单不会超出视口右边界
        if (dropdownLeft + dropdownWidth > window.innerWidth - 8) {
            dropdownLeft = window.innerWidth - dropdownWidth - 8;
        }

        // 确保下拉菜单不会超出视口左边界
        if (dropdownLeft < 8) {
            dropdownLeft = 8;
        }
    }

    $: if (isOpen) {
        updateDropdownPosition();
    }

    // 组件挂载时，自动加载上次选择的预设
    onMount(() => {
        (async () => {
            await loadPresets();
            const savedPresetId = await loadSelectedPresetId();
            if (savedPresetId) {
                const preset = presets.find(p => p.id === savedPresetId);
                if (preset) {
                    // 自动应用保存的预设
                    tempContextCount = preset.contextCount;
                    tempTemperature = preset.temperature;
                    tempTemperatureEnabled = preset.temperatureEnabled ?? true;
                    tempSystemPrompt = preset.systemPrompt;
                    tempModelSelectionEnabled = preset.modelSelectionEnabled ?? false;
                    tempSelectedModels = [...(preset.selectedModels || [])]; // 创建新数组引用
                    tempEnableMultiModel = preset.enableMultiModel ?? false;
                    tempChatMode = preset.chatMode || 'ask';
                    tempModelThinkingSettings = { ...(preset.modelThinkingSettings || {}) }; // 创建新对象引用
                    selectedPresetId = savedPresetId;
                    // 触发应用
                    applySettings();
                } else {
                    // 预设已被删除，清除保存的ID
                    await saveSelectedPresetId('');
                }
            }
        })();

        // 点击外部关闭预设菜单
        const handleClickOutside = (e: MouseEvent) => {
            if (isPresetMenuOpen && presetMenuElement && presetMenuButtonElement) {
                const target = e.target as Node;
                if (
                    !presetMenuElement.contains(target) &&
                    !presetMenuButtonElement.contains(target)
                ) {
                    isPresetMenuOpen = false;
                }
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => {
            document.removeEventListener('click', handleClickOutside);
        };
    });

    // 计算当前按钮上要显示的预设名称
    // 仅在显式选中某个预设（`selectedPresetId`）时显示其名称
    $: currentPresetName = (() => {
        if (selectedPresetId) {
            const preset = presets.find(p => p.id === selectedPresetId);
            if (preset) return preset.name;
        }
        return '预设';
    })();
</script>

<div class="model-settings-button">
    <button
        bind:this={buttonElement}
        class="b3-button b3-button--text model-settings-button__trigger"
        on:click|stopPropagation={toggleDropdown}
        title={currentPresetName || t('aiSidebar.modelSettings.title')}
    >
        <svg class="b3-button__icon"><use xlink:href="#iconModelSetting"></use></svg>
        {#if currentPresetName}
            <span class="model-settings-button__label">
                {currentPresetName}
            </span>
        {/if}
    </button>

    {#if isOpen}
        <div
            bind:this={dropdownElement}
            class="model-settings-dropdown"
            style="top: {dropdownTop}px; left: {dropdownLeft}px;"
        >
            <div class="model-settings-header">
                <h4>{t('aiSidebar.modelSettings.title')}</h4>
                <div class="model-settings-header-actions">
                    <!-- 预设管理按钮 -->
                    <div class="model-settings-preset-menu-wrapper">
                        <button
                            bind:this={presetMenuButtonElement}
                            class="b3-button b3-button--text"
                            on:click|stopPropagation={() => (isPresetMenuOpen = !isPresetMenuOpen)}
                            title={t('aiSidebar.modelSettings.presetMenu') || '预设管理'}
                        >
                            <svg class="b3-button__icon"><use xlink:href="#iconList"></use></svg>
                        </button>

                        <!-- 预设菜单下拉 -->
                        {#if isPresetMenuOpen}
                            <div
                                bind:this={presetMenuElement}
                                class="model-settings-preset-menu"
                                on:click|stopPropagation
                            >
                                <!-- 保存新预设 -->
                                <div class="model-settings-preset-menu-item">
                                    <input
                                        type="text"
                                        bind:value={newPresetName}
                                        class="b3-text-field"
                                        placeholder={t('aiSidebar.modelSettings.presetName')}
                                        on:keydown={e => e.key === 'Enter' && saveAsPreset()}
                                    />
                                    <button
                                        class="b3-button b3-button--primary"
                                        on:click={saveAsPreset}
                                        style="margin-left: 8px;"
                                    >
                                        {t('aiSidebar.modelSettings.savePreset')}
                                    </button>
                                </div>

                                <div class="model-settings-preset-menu-divider"></div>

                                <!-- 预设列表 -->
                                {#if presets.length > 0}
                                    {#each presets as preset}
                                        <div class="model-settings-preset-menu-preset">
                                            <div class="model-settings-preset-menu-preset-main">
                                                <div
                                                    class="model-settings-preset-menu-preset-info"
                                                    class:selected={selectedPresetId === preset.id}
                                                    on:click={() => loadPreset(preset.id)}
                                                    role="button"
                                                    tabindex="0"
                                                    on:keydown={e =>
                                                        e.key === 'Enter' && loadPreset(preset.id)}
                                                >
                                                    {#if selectedPresetId === preset.id}
                                                        <svg
                                                            class="model-settings-preset-selected-icon"
                                                        >
                                                            <use xlink:href="#iconCheck"></use>
                                                        </svg>
                                                    {/if}
                                                    <div
                                                        class="model-settings-preset-menu-preset-content"
                                                    >
                                                        <span class="preset-name">
                                                            {preset.name}
                                                        </span>
                                                        <div class="model-settings-preset-details">
                                                            {t(
                                                                'aiSidebar.modelSettings.contextCount'
                                                            )}: {preset.contextCount}
                                                            {#if preset.temperatureEnabled ?? true}
                                                                | {t(
                                                                    'aiSidebar.modelSettings.temperature'
                                                                )}: {preset.temperature.toFixed(2)}
                                                            {/if}
                                                            {#if preset.chatMode}
                                                                | {t(
                                                                    'aiSidebar.modelSettings.chatMode'
                                                                )}: {t(
                                                                    `aiSidebar.mode.${preset.chatMode}`
                                                                ) || preset.chatMode}
                                                            {/if}
                                                            {#if preset.modelSelectionEnabled && preset.selectedModels && preset.selectedModels.length > 0}
                                                                <br />
                                                                <span
                                                                    class="model-settings-preset-models"
                                                                >
                                                                    {#if preset.enableMultiModel}
                                                                        {t(
                                                                            'aiSidebar.modelSettings.multiModel'
                                                                        ) || '多模型'}:
                                                                    {:else}
                                                                        {t(
                                                                            'aiSidebar.modelSettings.model'
                                                                        ) || '模型'}:
                                                                    {/if}
                                                                    {preset.selectedModels
                                                                        .map(m => {
                                                                            const provider =
                                                                                providers[
                                                                                    m.provider
                                                                                ] ||
                                                                                providers.customProviders?.find(
                                                                                    p =>
                                                                                        p.id ===
                                                                                        m.provider
                                                                                );
                                                                            const model =
                                                                                provider?.models?.find(
                                                                                    model =>
                                                                                        model.id ===
                                                                                        m.modelId
                                                                                );
                                                                            return (
                                                                                model?.name ||
                                                                                m.modelId
                                                                            );
                                                                        })
                                                                        .join(', ')}
                                                                </span>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div
                                                    class="model-settings-preset-menu-preset-actions"
                                                >
                                                    <button
                                                        class="b3-button b3-button--text"
                                                        on:click|stopPropagation={() =>
                                                            updatePreset(preset.id)}
                                                        title={t(
                                                            'aiSidebar.modelSettings.updatePreset'
                                                        )}
                                                    >
                                                        <svg class="b3-button__icon">
                                                            <use xlink:href="#iconRefresh"></use>
                                                        </svg>
                                                    </button>
                                                    <button
                                                        class="b3-button b3-button--text"
                                                        on:click|stopPropagation={() =>
                                                            deletePreset(preset.id)}
                                                        title={t(
                                                            'aiSidebar.modelSettings.deletePreset'
                                                        )}
                                                    >
                                                        <svg class="b3-button__icon">
                                                            <use xlink:href="#iconTrashcan"></use>
                                                        </svg>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    {/each}
                                {:else}
                                    <div class="model-settings-preset-menu-empty">
                                        {t('aiSidebar.modelSettings.noPresets')}
                                    </div>
                                {/if}
                            </div>
                        {/if}
                    </div>

                    <button
                        class="b3-button b3-button--text"
                        on:click={() => (isOpen = false)}
                        title={t('common.close')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
            </div>

            <div class="model-settings-content">
                <!-- 上下文数设置 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {t('aiSidebar.modelSettings.contextCount')}
                        <span class="model-settings-value">{tempContextCount}</span>
                    </label>
                    <input
                        type="range"
                        min="1"
                        max="50"
                        step="1"
                        bind:value={tempContextCount}
                        class="b3-slider"
                    />
                    <div class="model-settings-hint">
                        {t('aiSidebar.modelSettings.contextCountHint')}
                    </div>
                </div>

                <!-- Temperature设置 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {t('aiSidebar.modelSettings.temperature')}
                        <span class="model-settings-value">{tempTemperature.toFixed(2)}</span>
                    </label>
                    <div class="model-settings-checkbox">
                        <input
                            type="checkbox"
                            id="temperature-enabled"
                            bind:checked={tempTemperatureEnabled}
                            class="b3-switch"
                        />
                        <label for="temperature-enabled">
                            {t('aiSidebar.modelSettings.enableTemperature') ||
                                '启用Temperature调整'}
                        </label>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        bind:value={tempTemperature}
                        class="b3-slider"
                        disabled={!tempTemperatureEnabled}
                    />
                    <div class="model-settings-hint">
                        {t('aiSidebar.modelSettings.temperatureHint')}
                    </div>
                </div>

                <!-- 系统提示词设置 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {t('aiSidebar.modelSettings.systemPrompt')}
                    </label>
                    <textarea
                        bind:value={tempSystemPrompt}
                        class="b3-text-field model-settings-textarea"
                        placeholder={t('aiSidebar.modelSettings.systemPromptPlaceholder')}
                        rows="4"
                    ></textarea>
                    <div class="model-settings-hint">
                        {t('aiSidebar.modelSettings.systemPromptHint')}
                    </div>
                </div>

                <!-- 聊天模式设置 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {t('aiSidebar.modelSettings.chatMode') || '聊天模式'}
                    </label>
                    <select
                        bind:value={tempChatMode}
                        class="b3-select"
                        on:change={() => {
                            // 如果切换到非ask模式，自动禁用多模型
                            if (tempChatMode !== 'ask' && tempEnableMultiModel) {
                                tempEnableMultiModel = false;
                            }
                        }}
                    >
                        <option value="ask">{t('aiSidebar.mode.ask') || '问答模式'}</option>
                        <option value="edit">{t('aiSidebar.mode.edit') || '编辑模式'}</option>
                        <option value="agent">{t('aiSidebar.mode.agent') || 'Agent模式'}</option>
                    </select>
                    <div class="model-settings-hint">
                        {t('aiSidebar.modelSettings.chatModeHint') ||
                            '选择聊天模式，只有问答模式支持多模型'}
                    </div>
                </div>

                <!-- 模型选择设置 -->
                <div class="model-settings-item">
                    <div class="model-settings-checkbox">
                        <input
                            type="checkbox"
                            id="model-selection-enabled"
                            bind:checked={tempModelSelectionEnabled}
                            class="b3-switch"
                        />
                        <label for="model-selection-enabled">
                            {t('aiSidebar.modelSettings.enableModelSelection') || '启用模型选择'}
                        </label>
                    </div>

                    {#if tempModelSelectionEnabled}
                        <div class="model-settings-model-selector">
                            <!-- 多模型模式开关 -->
                            <div class="model-settings-checkbox">
                                <input
                                    type="checkbox"
                                    id="enable-multi-model"
                                    bind:checked={tempEnableMultiModel}
                                    class="b3-switch"
                                    disabled={tempChatMode !== 'ask'}
                                />
                                <label
                                    for="enable-multi-model"
                                    class:disabled={tempChatMode !== 'ask'}
                                >
                                    {t('aiSidebar.modelSettings.enableMultiModel') || '多模型模式'}
                                    {#if tempChatMode !== 'ask'}
                                        <span class="model-settings-disabled-hint">
                                            ({t('aiSidebar.modelSettings.onlyAskMode') ||
                                                '仅问答模式可用'})
                                        </span>
                                    {/if}
                                </label>
                            </div>

                            <!-- 模型选择下拉框 -->
                            <div class="model-settings-model-list">
                                {#each getAllAvailableModels() as model}
                                    <div class="model-settings-model-item">
                                        <div class="model-settings-model-item-main">
                                            <input
                                                type={tempEnableMultiModel ? 'checkbox' : 'radio'}
                                                id="model-{model.provider}-{model.modelId}"
                                                name="preset-model-selection"
                                                checked={tempSelectedModels.some(
                                                    m =>
                                                        m.provider === model.provider &&
                                                        m.modelId === model.modelId
                                                )}
                                                on:change={e => {
                                                    if (tempEnableMultiModel) {
                                                        // 多模型模式：checkbox
                                                        if (e.currentTarget.checked) {
                                                            tempSelectedModels = [
                                                                ...tempSelectedModels,
                                                                {
                                                                    provider: model.provider,
                                                                    modelId: model.modelId,
                                                                },
                                                            ];
                                                        } else {
                                                            tempSelectedModels =
                                                                tempSelectedModels.filter(
                                                                    m =>
                                                                        !(
                                                                            m.provider ===
                                                                                model.provider &&
                                                                            m.modelId ===
                                                                                model.modelId
                                                                        )
                                                                );
                                                        }
                                                    } else {
                                                        // 单模型模式：radio
                                                        tempSelectedModels = [
                                                            {
                                                                provider: model.provider,
                                                                modelId: model.modelId,
                                                            },
                                                        ];
                                                    }
                                                }}
                                            />
                                            <label for="model-{model.provider}-{model.modelId}">
                                                <span class="model-provider-name">
                                                    {model.providerName}
                                                </span>
                                                <span class="model-name">{model.modelName}</span>
                                            </label>
                                        </div>

                                        <!-- Thinking checkbox -->
                                        {#if model.supportsThinking}
                                            <div class="model-settings-thinking-checkbox">
                                                <input
                                                    type="checkbox"
                                                    id="thinking-{model.provider}-{model.modelId}"
                                                    class="b3-switch b3-switch--small"
                                                    checked={tempModelThinkingSettings[
                                                        `${model.provider}:${model.modelId}`
                                                    ] ?? false}
                                                    on:change={e => {
                                                        const key = `${model.provider}:${model.modelId}`;
                                                        tempModelThinkingSettings = {
                                                            ...tempModelThinkingSettings,
                                                            [key]: e.currentTarget.checked,
                                                        };
                                                    }}
                                                />
                                                <label
                                                    for="thinking-{model.provider}-{model.modelId}"
                                                    class="thinking-label"
                                                >
                                                    {t('aiSidebar.modelSettings.enableThinking') ||
                                                        '思考'}
                                                </label>
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        </div>
                    {/if}

                    <div class="model-settings-hint">
                        {t('aiSidebar.modelSettings.modelSelectionHint') ||
                            '启用后，应用预设时会自动切换到选择的模型'}
                    </div>
                </div>
            </div>

            <div class="model-settings-footer">
                <button class="b3-button b3-button--text" on:click={resetToDefaults}>
                    {t('aiSidebar.modelSettings.reset')}
                </button>
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
    .model-settings-button {
        position: relative;
    }

    .model-settings-button__trigger {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: 200px;
        padding-inline: 6px 8px;
    }

    .model-settings-button__label {
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        /* 不强制设置颜色，继承父级按钮的文本颜色 */
    }

    .model-settings-dropdown {
        position: fixed;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 8px;
        box-shadow: var(--b3-dialog-shadow);
        width: 360px;
        max-height: 70vh;
        display: flex;
        flex-direction: column;
        z-index: 1000;
    }

    .model-settings-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--b3-border-color);

        h4 {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            color: var(--b3-theme-on-background);
        }
    }

    .model-settings-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .model-settings-preset-menu-wrapper {
        position: relative;
    }

    .model-settings-preset-menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        min-width: 280px;
        max-width: 400px;
        max-height: 400px;
        overflow-y: auto;
        background: var(--b3-theme-background);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        box-shadow: var(--b3-dialog-shadow);
        z-index: 1000;
        padding: 8px;
    }

    .model-settings-preset-menu-item {
        display: flex;
        align-items: center;
        padding: 8px;
        gap: 8px;

        input {
            flex: 1;
        }
    }

    .model-settings-preset-menu-divider {
        height: 1px;
        background: var(--b3-border-color);
        margin: 8px 0;
    }

    .model-settings-preset-menu-preset {
        display: flex;
        flex-direction: column;
        padding: 8px;
        border-radius: 4px;
        transition: background 0.2s;

        &:hover {
            background: var(--b3-theme-surface);
        }
    }

    .model-settings-preset-menu-preset-main {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
    }

    .model-settings-preset-menu-preset-info {
        flex: 1;
        display: flex;
        align-items: flex-start;
        gap: 6px;
        cursor: pointer;
        font-size: 13px;
        color: var(--b3-theme-on-surface);

        &.selected {
            color: var(--b3-theme-primary);

            .preset-name {
                font-weight: 600;
            }
        }

        svg {
            width: 14px;
            height: 14px;
            flex-shrink: 0;
            margin-top: 2px;
        }
    }

    .model-settings-preset-menu-preset-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .preset-name {
        font-size: 13px;
        font-weight: 500;
    }

    .model-settings-preset-menu-preset-actions {
        display: flex;
        gap: 2px;
        flex-shrink: 0;
    }

    .model-settings-preset-menu-empty {
        padding: 16px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 12px;
    }

    .model-settings-content {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    .model-settings-item {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .model-settings-label {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
    }

    .model-settings-value {
        font-size: 12px;
        color: var(--b3-theme-primary);
        font-weight: 600;
    }

    .model-settings-hint {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        margin-top: -4px;
    }

    .model-settings-checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;

        label {
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            cursor: pointer;
        }
    }

    .model-settings-textarea {
        resize: vertical;
        min-height: 60px;
        font-family: var(--b3-font-family);
        font-size: 12px;
    }

    .model-settings-preset-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
    }

    .model-settings-empty {
        text-align: center;
        padding: 12px;
        font-size: 12px;
        color: var(--b3-theme-on-surface-light);
        background: var(--b3-theme-surface);
        border-radius: 4px;
    }

    .model-settings-preset-manager {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--b3-border-color);
    }

    .model-settings-preset-new {
        display: flex;
        gap: 8px;

        input {
            flex: 1;
        }

        button {
            white-space: nowrap;
            font-size: 12px;
        }
    }

    .model-settings-preset-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .model-settings-preset-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px;
        background: var(--b3-theme-surface);
        border-radius: 4px;
        border: 1px solid var(--b3-border-color);
        cursor: pointer;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-background);
            border-color: var(--b3-theme-primary-light);
        }

        &--selected {
            background: var(--b3-theme-primary-lightest);
            border-color: var(--b3-theme-primary);

            .model-settings-preset-name {
                color: var(--b3-theme-primary);
                font-weight: 600;
            }
        }
    }

    .model-settings-preset-info {
        flex: 1;
        min-width: 0;
        pointer-events: none; // 防止子元素拦截点击事件
    }

    .model-settings-preset-actions {
        display: flex;
        gap: 4px;
        flex-shrink: 0;
    }

    .model-settings-preset-name {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        color: var(--b3-theme-on-surface);
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .model-settings-preset-selected-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--b3-theme-primary);
    }

    .model-settings-preset-details {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.6;
    }

    .model-settings-preset-models {
        color: var(--b3-theme-on-surface);
        font-weight: 500;
    }

    .model-settings-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 12px 16px;
        border-top: 1px solid var(--b3-border-color);
        background: var(--b3-theme-surface);
    }

    .b3-slider {
        width: 100%;
    }

    .model-settings-model-selector {
        margin-top: 12px;
        padding: 12px;
        background: var(--b3-theme-surface);
        border-radius: 4px;
        border: 1px solid var(--b3-border-color);
    }

    .model-settings-model-list {
        margin-top: 12px;
        max-height: 200px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .model-settings-model-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 8px;
        background: var(--b3-theme-background);
        border-radius: 4px;
        border: 1px solid var(--b3-border-color);
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-surface);
            border-color: var(--b3-theme-primary-light);
        }

        input[type='checkbox'],
        input[type='radio'] {
            flex-shrink: 0;
        }

        label {
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            font-size: 12px;
            margin: 0;
        }

        .model-provider-name {
            color: var(--b3-theme-on-surface-light);
            font-size: 11px;
            padding: 2px 6px;
            background: var(--b3-theme-surface);
            border-radius: 3px;
        }

        .model-name {
            color: var(--b3-theme-on-surface);
            font-weight: 500;
        }
    }

    .model-settings-model-item-main {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .model-settings-thinking-checkbox {
        display: flex;
        align-items: center;
        gap: 4px;
        padding-left: 8px;
        border-left: 1px solid var(--b3-border-color);

        input[type='checkbox'] {
            flex-shrink: 0;
        }

        .thinking-label {
            font-size: 11px;
            color: var(--b3-theme-on-surface-light);
            cursor: pointer;
            margin: 0;
            white-space: nowrap;
        }
    }

    .model-settings-checkbox {
        label.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    }

    .model-settings-disabled-hint {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        font-weight: normal;
    }
</style>
