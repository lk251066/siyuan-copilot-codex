<script lang="ts">
    import { createEventDispatcher, tick, onMount } from 'svelte';
    import { t } from '../utils/i18n';
    import { pushMsg } from '@/api';
    import { confirm } from 'siyuan';
    import MultiModelSelector from './MultiModelSelector.svelte';

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

    // 预设列表弹窗
    let isPresetListOpen = false;
    let presetListTop = 0;
    let presetListLeft = 0;
    let buttonElement: HTMLButtonElement;
    let presetListElement: HTMLDivElement;

    // 设置面板弹窗
    let isSettingsOpen = false;
    let settingsTop = 0;
    let settingsLeft = 0;
    let settingsElement: HTMLDivElement;

    // 模型设置（临时值，用于编辑）
    let tempContextCount = 10;
    let tempTemperature = 0.7;
    let tempTemperatureEnabled = false;
    let tempSystemPrompt = '';
    let tempModelSelectionEnabled = false;
    let tempSelectedModels: Array<{ provider: string; modelId: string }> = [];
    let tempEnableMultiModel = false;
    let tempChatMode: 'ask' | 'edit' | 'agent' = 'ask';
    let tempModelThinkingSettings: Record<string, boolean> = {};

    // 当前正在编辑的预设ID（空字符串表示新建/默认）
    let editingPresetId = '';

    // 预设管理
    interface Preset {
        id: string;
        name: string;
        contextCount: number;
        temperature: number;
        temperatureEnabled: boolean;
        systemPrompt: string;
        modelSelectionEnabled: boolean;
        selectedModels: Array<{ provider: string; modelId: string }>;
        enableMultiModel: boolean;
        chatMode: 'ask' | 'edit' | 'agent';
        modelThinkingSettings?: Record<string, boolean>;
        createdAt: number;
    }

    let presets: Preset[] = [];
    let selectedPresetId: string = '';
    let newPresetName = '';

    // 拖拽排序相关（预设列表）
    let dragSrcIndex: number | null = null;
    let dragOverIndex: number | null = null;
    let dragDirection: 'above' | 'below' | null = null;

    // MultiModelSelector 打开状态
    let isModelSelectorOpen = false;

    // 预设搜索筛选
    let presetSearchQuery = '';

    // 保存初始状态，用于检测是否有未保存的更改
    let initialState = {
        presetName: '',
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

    // 处理MultiModelSelector的选择事件（单模型模式）
    function handleModelSelect(event: CustomEvent<{ provider: string; modelId: string }>) {
        const { provider, modelId } = event.detail;
        tempSelectedModels = [{ provider, modelId }];
        applySettings();
        isModelSelectorOpen = false;
    }

    // 处理MultiModelSelector的变化事件（多模型模式）
    function handleModelsChange(event: CustomEvent<Array<{ provider: string; modelId: string }>>) {
        tempSelectedModels = event.detail;
        applySettings();
    }

    // 处理MultiModelSelector的多模型开关事件
    function handleToggleMultiModel(event: CustomEvent<boolean>) {
        tempEnableMultiModel = event.detail;
        if (!tempEnableMultiModel && tempSelectedModels.length > 1) {
            tempSelectedModels = [];
        }
        applySettings();
    }

    // 处理MultiModelSelector的思考模式切换
    function handleToggleThinking(
        event: CustomEvent<{ provider: string; modelId: string; enabled: boolean }>
    ) {
        const { provider, modelId, enabled } = event.detail;
        const key = `${provider}:${modelId}`;
        tempModelThinkingSettings = {
            ...tempModelThinkingSettings,
            [key]: enabled,
        };
        applySettings();

        // 同步到 providers 配置
        dispatch('toggleThinking', { provider, modelId, enabled });
    }

    // 响应式过滤后的预设列表（支持空格分隔的 AND 搜索）
    $: filteredPresets = ((): Preset[] => {
        const q = presetSearchQuery.trim().toLowerCase();
        if (!q) return presets;
        const terms = q.split(/\s+/).filter(Boolean);
        return presets.filter(preset => {
            const hay = (
                (preset.name || '') +
                ' ' +
                (preset.systemPrompt || '') +
                ' ' +
                (preset.chatMode || '') +
                ' ' +
                (preset.selectedModels || [])
                    .map(m => getModelDisplayName(m.provider, m.modelId))
                    .join(' ') +
                ' ' +
                (preset.selectedModels || []).map(m => m.provider).join(' ') +
                ' ' +
                (preset.selectedModels || []).map(m => m.modelId).join(' ')
            ).toLowerCase();
            return terms.every(term => hay.includes(term));
        });
    })();

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

    // 获取模型显示名称
    function getModelDisplayName(provider: string, modelId: string): string {
        let providerConfig: any = null;

        // 查找内置平台
        if (providers[provider] && !Array.isArray(providers[provider])) {
            providerConfig = providers[provider];
        } else if (providers.customProviders && Array.isArray(providers.customProviders)) {
            // 查找自定义平台
            providerConfig = providers.customProviders.find((p: any) => p.id === provider);
        }

        if (providerConfig && providerConfig.models) {
            const model = providerConfig.models.find((m: any) => m.id === modelId);
            return model ? model.name : modelId;
        }

        return modelId;
    }

    // 获取当前模型提供商和模型ID的helper函数（单模型模式使用）
    function getCurrentModelSelection(): { provider: string; modelId: string } {
        if (tempSelectedModels.length > 0) {
            return {
                provider: tempSelectedModels[0].provider,
                modelId: tempSelectedModels[0].modelId,
            };
        }
        return { provider: currentProvider, modelId: currentModelId };
    }

    // 格式化预设的模型列表显示
    function formatPresetModels(
        selectedModels: Array<{ provider: string; modelId: string }>
    ): string {
        const modelCounts: Record<string, number> = {};
        selectedModels.forEach(m => {
            const provider =
                providers[m.provider] ||
                providers.customProviders?.find(p => p.id === m.provider);
            const model = provider?.models?.find(model => model.id === m.modelId);
            const modelName = model?.name || m.modelId;
            modelCounts[modelName] = (modelCounts[modelName] || 0) + 1;
        });

        // 格式化显示：模型名 × 次数
        return Object.entries(modelCounts)
            .map(([name, count]) => (count > 1 ? `${name} × ${count}` : name))
            .join(', ');
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

        // 自动选择新建的预设
        selectedPresetId = preset.id;
        await saveSelectedPresetId(preset.id);

        pushMsg(t('aiSidebar.modelSettings.presetSaved'));

        // 关闭设置面板
        isSettingsOpen = false;
        openPresetList();
    }

    // 选择预设（直接应用，不打开设置面板）
    async function selectPreset(presetId: string) {
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
            selectedPresetId = presetId;
            await saveSelectedPresetId(presetId);

            // 应用预设设置
            dispatch('apply', {
                contextCount: preset.contextCount,
                temperature: preset.temperature,
                temperatureEnabled: preset.temperatureEnabled ?? true,
                systemPrompt: preset.systemPrompt,
                modelSelectionEnabled: preset.modelSelectionEnabled ?? false,
                selectedModels: preset.selectedModels || [],
                enableMultiModel: preset.enableMultiModel ?? false,
                chatMode: preset.chatMode || 'ask',
                modelThinkingSettings: preset.modelThinkingSettings || {},
            });

            pushMsg(`已应用预设: ${preset.name}`);
        }
    }

    // 编辑预设（打开设置面板）
    function editPreset(presetId: string) {
        const preset = presets.find(p => p.id === presetId);
        if (!preset) return;

        editingPresetId = presetId;
        newPresetName = preset.name; // 加载预设名称
        tempContextCount = preset.contextCount;
        tempTemperature = preset.temperature;
        tempTemperatureEnabled = preset.temperatureEnabled ?? true;
        tempSystemPrompt = preset.systemPrompt;
        tempModelSelectionEnabled = preset.modelSelectionEnabled ?? false;
        tempSelectedModels = [...(preset.selectedModels || [])];
        tempEnableMultiModel = preset.enableMultiModel ?? false;
        tempChatMode = preset.chatMode || 'ask';
        tempModelThinkingSettings = { ...(preset.modelThinkingSettings || {}) };

        // 保存初始状态
        saveInitialState();

        // 关闭预设列表，打开设置面板
        isPresetListOpen = false;
        openSettings();
    }

    // 删除预设
    function deletePreset(presetId: string) {
        // 临时移除外部点击监听器
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
                    if (isPresetListOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            },
            () => {
                // 用户取消删除，重新添加外部点击监听器
                setTimeout(() => {
                    if (isPresetListOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            }
        );
    }

    // 拖拽开始
    function handleDragStart(e: DragEvent, index: number) {
        dragSrcIndex = index;
        dragDirection = null;
        try {
            e.dataTransfer?.setData('text/plain', String(index));
            e.dataTransfer!.effectAllowed = 'move';
        } catch (err) {
            // ignore
        }
        const el = e.currentTarget as HTMLElement | null;
        if (el) el.classList.add('dragging');
    }

    function handleDragOver(e: DragEvent, index: number) {
        e.preventDefault();
        dragOverIndex = index;
        if (dragSrcIndex !== null) {
            if (index < dragSrcIndex) {
                dragDirection = 'above';
            } else if (index > dragSrcIndex) {
                dragDirection = 'below';
            } else {
                dragDirection = null;
            }
        }
    }

    async function handleDrop(e: DragEvent, index: number) {
        e.preventDefault();
        if (dragSrcIndex === null) return;
        const src = dragSrcIndex;
        let dest = index;
        if (src === dest) {
            cleanupDrag();
            return;
        }

        // 根据拖拽方向调整目标位置
        if (dragDirection === 'below') {
            dest = index + 1;
        }

        const item = presets[src];
        presets.splice(src, 1);
        const adjustedDest = src < dest ? dest - 1 : dest;
        presets.splice(adjustedDest, 0, item);
        presets = [...presets];
        await savePresetsToStorage();
        cleanupDrag();
    }

    function handleDragEnd() {
        cleanupDrag();
    }

    function cleanupDrag() {
        dragSrcIndex = null;
        dragOverIndex = null;
        dragDirection = null;
        const els = document.querySelectorAll('.model-settings-preset-list-item.dragging');
        els.forEach(el => el.classList.remove('dragging'));
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

        // 注意：编辑预设时不自动保存，只有点击保存按钮才保存
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

    // 更新预设
    async function updatePreset(presetId: string) {
        const preset = presets.find(p => p.id === presetId);
        if (preset) {
            // 如果名称有变更且不为空，则更新名称
            if (newPresetName.trim() && newPresetName.trim() !== preset.name) {
                preset.name = newPresetName.trim();
            }
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

            // 关闭设置面板
            isSettingsOpen = false;
            openPresetList();
        }
    }

    // 重置临时值为当前应用的设置
    async function resetToAppliedSettings() {
        tempContextCount = appliedSettings.contextCount;
        tempTemperature = appliedSettings.temperature;
        tempTemperatureEnabled = appliedSettings.temperatureEnabled ?? true;
        tempSystemPrompt = appliedSettings.systemPrompt;
        tempModelSelectionEnabled = appliedSettings.modelSelectionEnabled ?? false;
        tempSelectedModels = [...(appliedSettings.selectedModels || [])];
        tempEnableMultiModel = appliedSettings.enableMultiModel ?? false;
        tempChatMode = appliedSettings.chatMode ?? 'ask';
        tempModelThinkingSettings = { ...(appliedSettings.modelThinkingSettings || {}) };

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
                selectedPresetId = savedPresetId;
            } else {
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
        editingPresetId = '';
        selectedPresetId = '';
        newPresetName = ''; // 重置预设名称为空
        await saveSelectedPresetId('');
        // 保存初始状态
        saveInitialState();
    }

    // 打开预设列表
    async function openPresetList() {
        await loadPresets();
        await resetToAppliedSettings();
        isPresetListOpen = true;
        updatePresetListPosition();
        setTimeout(() => {
            document.addEventListener('click', closeOnOutsideClick);
        }, 0);
    }

    // 打开设置面板
    function openSettings() {
        isSettingsOpen = true;
        updateSettingsPosition();
    }

    // 保存初始状态
    function saveInitialState() {
        initialState = {
            presetName: newPresetName,
            contextCount: tempContextCount,
            temperature: tempTemperature,
            temperatureEnabled: tempTemperatureEnabled,
            systemPrompt: tempSystemPrompt,
            modelSelectionEnabled: tempModelSelectionEnabled,
            selectedModels: [...tempSelectedModels],
            enableMultiModel: tempEnableMultiModel,
            chatMode: tempChatMode,
            modelThinkingSettings: { ...tempModelThinkingSettings },
        };
    }

    // 检查是否有未保存的更改
    function hasUnsavedChanges(): boolean {
        if (newPresetName !== initialState.presetName) return true;
        if (tempContextCount !== initialState.contextCount) return true;
        if (tempTemperature !== initialState.temperature) return true;
        if (tempTemperatureEnabled !== initialState.temperatureEnabled) return true;
        if (tempSystemPrompt !== initialState.systemPrompt) return true;
        if (tempModelSelectionEnabled !== initialState.modelSelectionEnabled) return true;
        if (tempEnableMultiModel !== initialState.enableMultiModel) return true;
        if (tempChatMode !== initialState.chatMode) return true;
        if (!areModelsEqual(tempSelectedModels, initialState.selectedModels)) return true;
        if (!areThinkingSettingsEqual(tempModelThinkingSettings, initialState.modelThinkingSettings))
            return true;
        return false;
    }

    // 安全关闭设置面板（带未保存更改确认）
    async function safeCloseSettings() {
        if (!hasUnsavedChanges()) {
            isSettingsOpen = false;
            openPresetList();
            return;
        }

        // 临时移除外部点击监听器
        document.removeEventListener('click', closeOnOutsideClick);

        confirm(
            t('aiSidebar.modelSettings.unsavedChanges') || '未保存的更改',
            t('aiSidebar.modelSettings.confirmClose') ||
                '您有未保存的更改，是否保存预设？',
            async () => {
                // 用户选择保存
                if (editingPresetId) {
                    await updatePreset(editingPresetId);
                } else {
                    await saveAsPreset();
                }
                // 重新添加外部点击监听器
                setTimeout(() => {
                    if (isPresetListOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            },
            () => {
                // 用户选择不保存，直接关闭
                isSettingsOpen = false;
                openPresetList();
                // 重新添加外部点击监听器
                setTimeout(() => {
                    if (isPresetListOpen) {
                        document.addEventListener('click', closeOnOutsideClick);
                    }
                }, 0);
            }
        );
    }

    // 关闭所有弹窗
    function closeAll() {
        isPresetListOpen = false;
        isSettingsOpen = false;
        document.removeEventListener('click', closeOnOutsideClick);
    }

    // 计算预设列表位置
    async function updatePresetListPosition() {
        if (!buttonElement || !isPresetListOpen) return;

        await tick();

        const rect = buttonElement.getBoundingClientRect();
        const dropdownWidth = presetListElement?.offsetWidth || 320;
        const dropdownHeight = presetListElement?.offsetHeight || 400;

        // 计算垂直位置
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        if (spaceAbove >= dropdownHeight || spaceAbove >= spaceBelow) {
            presetListTop = rect.top - dropdownHeight - 4;
        } else {
            presetListTop = rect.bottom + 4;
        }

        // 计算水平位置
        // 如果按钮右侧空间不足以放下弹窗，则右对齐；否则左对齐
        if (rect.left + dropdownWidth > window.innerWidth - 8) {
            // 右对齐：弹窗右边缘与按钮右边缘对齐
            presetListLeft = rect.right - dropdownWidth;
        } else {
            // 左对齐：弹窗左边缘与按钮左边缘对齐
            presetListLeft = rect.left;
        }

        // 确保不超出视口右边界
        if (presetListLeft + dropdownWidth > window.innerWidth - 8) {
            presetListLeft = window.innerWidth - dropdownWidth - 8;
        }

        // 确保不超出视口左边界
        if (presetListLeft < 8) {
            presetListLeft = 8;
        }
    }

    // 计算设置面板位置
    async function updateSettingsPosition() {
        if (!buttonElement || !isSettingsOpen) return;

        await tick();

        const rect = buttonElement.getBoundingClientRect();
        const dropdownWidth = settingsElement?.offsetWidth || 360;
        const dropdownHeight = settingsElement?.offsetHeight || 500;

        // 计算垂直位置
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        if (spaceAbove >= dropdownHeight || spaceAbove >= spaceBelow) {
            settingsTop = rect.top - dropdownHeight - 4;
        } else {
            settingsTop = rect.bottom + 4;
        }

        // 计算水平位置
        // 如果按钮右侧空间不足以放下弹窗，则右对齐；否则左对齐
        if (rect.left + dropdownWidth > window.innerWidth - 8) {
            // 右对齐：弹窗右边缘与按钮右边缘对齐
            settingsLeft = rect.right - dropdownWidth;
        } else {
            // 左对齐：弹窗左边缘与按钮左边缘对齐
            settingsLeft = rect.left;
        }

        // 确保不超出视口右边界
        if (settingsLeft + dropdownWidth > window.innerWidth - 8) {
            settingsLeft = window.innerWidth - dropdownWidth - 8;
        }

        // 确保不超出视口左边界
        if (settingsLeft < 8) {
            settingsLeft = 8;
        }
    }

    // 关闭下拉菜单
    async function closeOnOutsideClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        if (!target.closest('.model-settings-button')) {
            // 如果设置面板打开，检查未保存的更改
            if (isSettingsOpen && hasUnsavedChanges()) {
                event.preventDefault();
                event.stopPropagation();
                await safeCloseSettings();
                return;
            }
            isPresetListOpen = false;
            isSettingsOpen = false;
            document.removeEventListener('click', closeOnOutsideClick);
        }
    }

    // 处理设置面板内的点击，关闭模型选择器（如果点击的不是选择器区域）
    function handleSettingsPanelClick(event: MouseEvent) {
        const target = event.target as HTMLElement;
        // 如果点击的不是 MultiModelSelector 区域，则关闭选择器
        if (isModelSelectorOpen && !target.closest('.multi-model-selector')) {
            isModelSelectorOpen = false;
        }
    }

    // 打开/关闭弹窗
    function toggleDropdown() {
        if (!isPresetListOpen && !isSettingsOpen) {
            openPresetList();
        } else {
            closeAll();
        }
    }

    $: if (isPresetListOpen) {
        updatePresetListPosition();
    }

    $: if (isSettingsOpen) {
        updateSettingsPosition();
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
                    dispatch('apply', {
                        contextCount: preset.contextCount,
                        temperature: preset.temperature,
                        temperatureEnabled: preset.temperatureEnabled ?? true,
                        systemPrompt: preset.systemPrompt,
                        modelSelectionEnabled: preset.modelSelectionEnabled ?? false,
                        selectedModels: [...(preset.selectedModels || [])],
                        enableMultiModel: preset.enableMultiModel ?? false,
                        chatMode: preset.chatMode || 'ask',
                        modelThinkingSettings: { ...(preset.modelThinkingSettings || {}) },
                    });
                    selectedPresetId = savedPresetId;
                } else {
                    // 预设已被删除，清除保存的ID
                    await saveSelectedPresetId('');
                }
            }
        })();
    });

    // 计算当前按钮上要显示的预设名称
    $: currentPresetName = (() => {
        if (selectedPresetId) {
            const preset = presets.find(p => p.id === selectedPresetId);
            if (preset) return preset.name;
        }
        return '';
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

    <!-- 预设列表弹窗 -->
    {#if isPresetListOpen}
        <div
            bind:this={presetListElement}
            class="model-settings-preset-list-popup"
            style="top: {presetListTop}px; left: {presetListLeft}px;"
            on:click|stopPropagation
        >
            <div class="model-settings-preset-list-header">
                <h4>{t('aiSidebar.modelSettings.title')}</h4>
                <div class="model-settings-preset-list-actions">
                    <button
                        class="b3-button b3-button--text"
                        on:click={() => (isPresetListOpen = false)}
                        title={t('common.close')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
            </div>

            <div class="model-settings-preset-list-content">
                <!-- 新建预设按钮 -->
                <div class="model-settings-preset-list-new">
                    <button
                        class="b3-button b3-button--primary"
                        on:click={async () => {
                            editingPresetId = '';
                            await resetToDefaults();
                            isPresetListOpen = false;
                            openSettings();
                        }}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconAdd"></use></svg>
                        {t('aiSidebar.modelSettings.createNewPreset') || '新建预设'}
                    </button>
                </div>

                <!-- 预设搜索框 -->
                {#if presets.length > 0}
                    <div class="model-settings-preset-search">
                        <input
                            type="text"
                            class="b3-text-field"
                            placeholder={t('aiSidebar.modelSettings.searchPresets') || '搜索预设'}
                            bind:value={presetSearchQuery}
                        />
                    </div>
                {/if}

                <!-- 预设列表 -->
                {#if presets.length > 0}
                    {#if filteredPresets.length > 0}
                        <div class="model-settings-preset-list-items">
                            {#each filteredPresets as preset, index}
                                <div
                                    class="model-settings-preset-list-item"
                                    class:selected={selectedPresetId === preset.id}
                                    draggable="true"
                                    on:dragstart|stopPropagation={e => handleDragStart(e, index)}
                                    on:dragover|preventDefault|stopPropagation={e =>
                                        handleDragOver(e, index)}
                                    on:drop|stopPropagation={e => handleDrop(e, index)}
                                    on:dragend={handleDragEnd}
                                    class:drag-over={dragOverIndex === index}
                                    class:drag-over-above={dragOverIndex === index &&
                                        dragDirection === 'above'}
                                    class:drag-over-below={dragOverIndex === index &&
                                        dragDirection === 'below'}
                                >
                                    <div
                                        class="model-settings-preset-list-item-info"
                                        on:click={() => selectPreset(preset.id)}
                                        role="button"
                                        tabindex="0"
                                        on:keydown={e =>
                                            e.key === 'Enter' && selectPreset(preset.id)}
                                    >
                                        {#if selectedPresetId === preset.id}
                                            <svg class="model-settings-preset-selected-icon">
                                                <use xlink:href="#iconCheck"></use>
                                            </svg>
                                        {:else}
                                            <div class="model-settings-preset-empty-icon"></div>
                                        {/if}
                                        <div class="model-settings-preset-list-item-content">
                                            <span class="preset-name">{preset.name}</span>
                                            <div class="model-settings-preset-details">
                                                {t('aiSidebar.modelSettings.contextCount')}: {preset.contextCount}
                                                {#if preset.temperatureEnabled ?? true}
                                                    | {t('aiSidebar.modelSettings.temperature')}: {preset.temperature.toFixed(
                                                        2
                                                    )}
                                                {/if}
                                                {#if preset.chatMode}
                                                    | {t('aiSidebar.modelSettings.chatMode')}: {t(
                                                        `aiSidebar.mode.${preset.chatMode}`
                                                    ) || preset.chatMode}
                                                {/if}
                                                {#if preset.modelSelectionEnabled && preset.selectedModels && preset.selectedModels.length > 0}
                                                    <br />
                                                    <span class="model-settings-preset-models">
                                                        {#if preset.enableMultiModel}
                                                            {t(
                                                                'aiSidebar.modelSettings.multiModel'
                                                            ) || '多模型'}:
                                                        {:else}
                                                            {t('aiSidebar.modelSettings.model') ||
                                                                '模型'}:
                                                        {/if}
                                                        {formatPresetModels(preset.selectedModels)}
                                                    </span>
                                                {/if}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="model-settings-preset-list-item-actions">
                                        <button
                                            class="b3-button b3-button--text"
                                            on:click|stopPropagation={() => editPreset(preset.id)}
                                            title={t('aiSidebar.modelSettings.editPreset') ||
                                                '编辑预设'}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconEdit"></use>
                                            </svg>
                                        </button>
                                        <button
                                            class="b3-button b3-button--text"
                                            on:click|stopPropagation={() => deletePreset(preset.id)}
                                            title={t('aiSidebar.modelSettings.deletePreset')}
                                        >
                                            <svg class="b3-button__icon">
                                                <use xlink:href="#iconTrashcan"></use>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            {/each}
                        </div>
                    {:else if presetSearchQuery.trim()}
                        <div class="model-settings-preset-list-empty">
                            {t('aiSidebar.modelSettings.noResults') || '无匹配结果'}
                        </div>
                    {:else}
                        <div class="model-settings-preset-list-empty">
                            {t('aiSidebar.modelSettings.noPresets')}
                        </div>
                    {/if}
                {:else}
                    <div class="model-settings-preset-list-empty">
                        {t('aiSidebar.modelSettings.noPresets')}
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    <!-- 设置面板弹窗 -->
    {#if isSettingsOpen}
        <div
            bind:this={settingsElement}
            class="model-settings-dropdown"
            style="top: {settingsTop}px; left: {settingsLeft}px;"
            on:click|stopPropagation={handleSettingsPanelClick}
        >
            <div class="model-settings-header">
                <div class="model-settings-header-left">
                    {#if editingPresetId}
                        <button
                            class="b3-button b3-button--primary"
                            on:click={() => updatePreset(editingPresetId)}
                        >
                            {t('aiSidebar.modelSettings.savePreset') || '保存预设'}
                        </button>
                    {:else}
                        <button class="b3-button b3-button--primary" on:click={saveAsPreset}>
                            {t('aiSidebar.modelSettings.savePreset') || '保存预设'}
                        </button>
                    {/if}
                </div>
                <h4>
                    {editingPresetId
                        ? t('aiSidebar.modelSettings.editPreset') || '编辑预设'
                        : t('aiSidebar.modelSettings.createNewPreset') || '新建预设'}
                </h4>
                <div class="model-settings-header-actions">
                    <button
                        class="b3-button b3-button--text"
                        on:click={safeCloseSettings}
                        title={t('common.back') || '返回'}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconBack"></use></svg>
                    </button>
                    <button
                        class="b3-button b3-button--text"
                        on:click={safeCloseSettings}
                        title={t('common.close')}
                    >
                        <svg class="b3-button__icon"><use xlink:href="#iconClose"></use></svg>
                    </button>
                </div>
            </div>

            <div class="model-settings-content">
                <!-- 预设名称 -->
                <div class="model-settings-item">
                    <label class="model-settings-label">
                        {t('aiSidebar.modelSettings.presetName')}
                    </label>
                    <div class="model-settings-preset-new">
                        <input
                            type="text"
                            bind:value={newPresetName}
                            on:input={applySettings}
                            class="b3-text-field"
                            placeholder={t('aiSidebar.modelSettings.enterPresetName')}
                        />
                    </div>
                </div>

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
                        on:change={applySettings}
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
                            on:change={applySettings}
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
                        on:change={applySettings}
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
                        on:change={applySettings}
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
                            if (tempChatMode !== 'ask' && tempEnableMultiModel) {
                                tempEnableMultiModel = false;
                            }
                            applySettings();
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
                            on:change={applySettings}
                            class="b3-switch"
                        />
                        <label for="model-selection-enabled">
                            {t('aiSidebar.modelSettings.enableModelSelection') || '启用模型选择'}
                        </label>
                    </div>

                    {#if tempModelSelectionEnabled}
                        <div class="model-settings-model-selector">
                            <!-- 使用 MultiModelSelector 组件 -->
                            <MultiModelSelector
                                {providers}
                                selectedModels={tempSelectedModels}
                                bind:isOpen={isModelSelectorOpen}
                                enableMultiModel={tempEnableMultiModel}
                                currentProvider={getCurrentModelSelection().provider}
                                currentModelId={getCurrentModelSelection().modelId}
                                chatMode={tempChatMode}
                                on:select={handleModelSelect}
                                on:change={handleModelsChange}
                                on:toggleEnable={handleToggleMultiModel}
                                on:toggleThinking={handleToggleThinking}
                            />
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
    }

    // 预设列表弹窗
    .model-settings-preset-list-popup {
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

    .model-settings-preset-list-header {
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

    .model-settings-preset-list-actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .model-settings-preset-list-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .model-settings-preset-list-new {
        display: flex;
        justify-content: center;

        button {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        }
    }

    .model-settings-preset-list-items {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .model-settings-preset-list-item {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        background: var(--b3-theme-surface);
        border: 1px solid var(--b3-border-color);
        border-radius: 6px;
        cursor: grab;
        transition: all 0.2s;

        &:hover {
            background: var(--b3-theme-background);
            border-color: var(--b3-theme-primary-light);
        }

        &:active {
            cursor: grabbing;
        }

        &.selected {
            background: var(--b3-theme-primary-lightest);
            border-color: var(--b3-theme-primary);

            .preset-name {
                color: var(--b3-theme-primary);
                font-weight: 600;
            }
        }

        &.dragging {
            opacity: 0.5;
        }

        &.drag-over {
            border: 1px dashed var(--b3-theme-primary);
            background: var(--b3-theme-surface);
        }

        &.drag-over-above {
            border-top: 2px solid var(--b3-theme-primary);
        }

        &.drag-over-below {
            border-bottom: 2px solid var(--b3-theme-primary);
        }
    }

    .model-settings-preset-list-item-info {
        flex: 1;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        cursor: pointer;
        min-width: 0;
    }

    .model-settings-preset-empty-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        margin-top: 2px;
    }

    .model-settings-preset-list-item-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }

    .preset-name {
        font-size: 13px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .model-settings-preset-details {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        line-height: 1.5;
    }

    .model-settings-preset-models {
        color: var(--b3-theme-on-surface);
        font-weight: 500;
    }

    .model-settings-preset-list-item-actions {
        display: flex;
        gap: 2px;
        flex-shrink: 0;
    }

    .model-settings-preset-list-empty {
        padding: 24px;
        text-align: center;
        color: var(--b3-theme-on-surface-light);
        font-size: 13px;
    }

    // 设置面板
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

    .model-settings-header-left {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .model-settings-header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
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

            &.disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }
        }
    }

    .model-settings-textarea {
        resize: vertical;
        min-height: 60px;
        font-family: var(--b3-font-family);
        font-size: 12px;
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
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .model-settings-preset-search {
        display: flex;
        padding: 6px 0;
    }

    .model-settings-preset-search .b3-text-field {
        width: 100%;
        padding: 6px 8px;
        font-size: 12px;
    }

    .model-settings-disabled-hint {
        font-size: 11px;
        color: var(--b3-theme-on-surface-light);
        font-weight: normal;
    }

    .model-settings-preset-selected-icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        color: var(--b3-theme-primary);
        margin-top: 2px;
    }
</style>
