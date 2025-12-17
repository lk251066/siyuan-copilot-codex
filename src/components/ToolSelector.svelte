<script context="module" lang="ts">
    export interface ToolConfig {
        name: string;
        autoApprove: boolean;
    }
</script>

<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { AVAILABLE_TOOLS, type Tool } from '../tools';
    import { t } from '../utils/i18n';

    export let selectedTools: ToolConfig[] = [];

    const dispatch = createEventDispatcher();

    // 使用本地状态管理选中工具，避免双向绑定的问题
    let localSelectedTools: ToolConfig[] = [...selectedTools];

    // 当外部 selectedTools 改变时，同步到本地状态
    $: if (selectedTools) {
        localSelectedTools = [...selectedTools];
    }

    function close() {
        dispatch('close');
    }
    const toolCategories = {
        siyuan: {
            name: t('tools.category.siyuan'),
            tools: [
                'siyuan_sql_query',
                'siyuan_get_block_content',
                'siyuan_get_block_attrs',
                'siyuan_set_block_attrs',
                'siyuan_insert_block',
                'siyuan_update_block',
                'siyuan_create_document',
                'siyuan_list_notebooks',
                'siyuan_create_notebook',
                'siyuan_rename_document',
                'siyuan_move_documents',
            ],
        },
    };

    // 按类别组织工具
    const categorizedTools: Record<string, Tool[]> = {};
    for (const [category, config] of Object.entries(toolCategories)) {
        categorizedTools[category] = AVAILABLE_TOOLS.filter(tool =>
            config.tools.includes(tool.function.name)
        );
    }

    // 切换工具选择
    function toggleTool(toolName: string) {
        const index = localSelectedTools.findIndex(t => t.name === toolName);
        if (index >= 0) {
            // 移除工具
            localSelectedTools = localSelectedTools.filter(t => t.name !== toolName);
        } else {
            // 添加工具
            localSelectedTools = [...localSelectedTools, { name: toolName, autoApprove: false }];
        }
        // 通知父组件更新
        selectedTools = [...localSelectedTools];
        dispatch('update', localSelectedTools);
    }

    // 切换工具的自动批准状态
    function toggleToolAutoApprove(toolName: string) {
        const index = localSelectedTools.findIndex(t => t.name === toolName);
        if (index >= 0) {
            // 工具已选中,更新其自动批准状态
            // 创建新数组以触发响应式更新
            localSelectedTools = localSelectedTools.map((tool, i) =>
                i === index ? { ...tool, autoApprove: !tool.autoApprove } : tool
            );
        } else {
            // 工具未选中,添加工具并设置自动批准为 true
            localSelectedTools = [...localSelectedTools, { name: toolName, autoApprove: true }];
        }
        // 同步到导出 prop 以支持 bind:selectedTools
        selectedTools = [...localSelectedTools];
        // 通知父组件更新
        dispatch('update', localSelectedTools);
    }

    // 全选/取消全选
    function toggleAll() {
        if (localSelectedTools.length === AVAILABLE_TOOLS.length) {
            // 取消全选
            localSelectedTools = [];
        } else {
            // 全选
            localSelectedTools = AVAILABLE_TOOLS.map(tool => ({
                name: tool.function.name,
                autoApprove: false,
            }));
        }
        // 同步到导出 prop 以支持 bind:selectedTools
        selectedTools = [...localSelectedTools];
        // 通知父组件更新
        dispatch('update', localSelectedTools);
    }

    // 检查工具是否被选中
    function isToolSelected(toolName: string): boolean {
        return localSelectedTools.some(t => t.name === toolName);
    }

    // 获取工具的自动批准状态
    function getToolAutoApprove(toolName: string): boolean {
        const tool = localSelectedTools.find(t => t.name === toolName);
        return tool?.autoApprove || false;
    }

    // 为了让模板能可靠地响应选中状态变化，维护两个响应式集合
    $: selectedSet = new Set(localSelectedTools.map(t => t.name));
    $: autoApproveMap = new Map(localSelectedTools.map(t => [t.name, t.autoApprove]));

    // 获取工具的友好名称
    function getToolDisplayName(toolName: string): string {
        const key = `tools.${toolName}.name`;
        const name = t(key);
        return name === key ? toolName : name;
    }

    // 获取工具的简短描述
    function getToolShortDescription(tool: Tool): string {
        const description = tool.function.description;
        const firstLine = description.split('\n')[0];
        return firstLine || description.substring(0, 50) + '...';
    }

    // 展开/折叠详情
    let expandedTools: Set<string> = new Set();
    function toggleExpand(toolName: string) {
        if (expandedTools.has(toolName)) {
            expandedTools.delete(toolName);
        } else {
            expandedTools.add(toolName);
        }
        expandedTools = expandedTools;
    }
</script>

<div class="tool-selector__overlay" on:click={close}></div>
<div class="tool-selector">
    <div class="tool-selector__header">
        <h3>{t('tools.selector.title')}</h3>
        <div class="tool-selector__actions">
            <button class="b3-button b3-button--text" on:click={toggleAll}>
                {localSelectedTools.length === AVAILABLE_TOOLS.length
                    ? t('tools.selector.deselectAll')
                    : t('tools.selector.selectAll')}
            </button>
            <button class="b3-button b3-button--cancel" on:click={close}>
                {t('common.close')}
            </button>
        </div>
    </div>

    <div class="tool-selector__content">
        <div class="tool-selector__info">
            <svg class="svg"><use xlink:href="#iconInfo"></use></svg>
            <span>{t('tools.selector.info')}</span>
        </div>

        {#each Object.entries(categorizedTools) as [category, tools] (category)}
            <div class="tool-category">
                <h4 class="tool-category__title">{toolCategories[category].name}</h4>
                <div class="tool-list">
                    {#each tools as tool (tool.function.name)}
                        {@const toolName = tool.function.name}
                        {@const isExpanded = expandedTools.has(toolName)}

                        <div
                            class="tool-item"
                            class:tool-item--selected={selectedSet.has(toolName)}
                        >
                            <div class="tool-item__header">
                                <label class="tool-item__checkbox">
                                    <input
                                        type="checkbox"
                                        checked={selectedSet.has(toolName)}
                                        on:change={() => toggleTool(toolName)}
                                    />
                                    <span class="tool-item__name">
                                        {getToolDisplayName(toolName)}
                                    </span>
                                </label>
                                <div class="tool-item__header-right">
                                    <label
                                        class="tool-item__auto-approve"
                                        title={t('tools.autoApprove.tooltip')}
                                    >
                                        <input
                                            type="checkbox"
                                            class="b3-switch"
                                            checked={autoApproveMap.get(toolName) || false}
                                            on:change={() => toggleToolAutoApprove(toolName)}
                                        />
                                        <span class="tool-item__auto-approve-text">
                                            {t('tools.autoApprove.label')}
                                        </span>
                                    </label>
                                    <button
                                        class="tool-item__expand b3-button b3-button--text"
                                        on:click={() => toggleExpand(toolName)}
                                        title={isExpanded
                                            ? t('common.collapse')
                                            : t('common.expand')}
                                    >
                                        <svg
                                            class="svg"
                                            class:tool-item__expand--rotated={isExpanded}
                                        >
                                            <use xlink:href="#iconRight"></use>
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <div class="tool-item__description">
                                {getToolShortDescription(tool)}
                            </div>

                            {#if isExpanded}
                                <div class="tool-item__details">
                                    <pre class="tool-item__full-description">{tool.function
                                            .description}</pre>

                                    <div class="tool-item__parameters">
                                        <strong>{t('tools.selector.parameters')}:</strong>
                                        <ul>
                                            {#each Object.entries(tool.function.parameters.properties) as [paramName, param]}
                                                <li>
                                                    <code>{paramName}</code>
                                                    {#if tool.function.parameters.required.includes(paramName)}
                                                        <span class="tool-item__required">
                                                            ({t('common.required')})
                                                        </span>
                                                    {/if}
                                                    : {param.description}
                                                </li>
                                            {/each}
                                        </ul>
                                    </div>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    </div>

    <div class="tool-selector__footer">
        <div class="tool-selector__footer-left">
            <div class="tool-selector__footer-info">
                <svg class="svg"><use xlink:href="#iconInfo"></use></svg>
                <span>{t('tools.autoApprove.footerInfo')}</span>
            </div>
        </div>
        <span class="tool-selector__count">
            {t('tools.selector.selected')}: {localSelectedTools.length}/{AVAILABLE_TOOLS.length}
        </span>
    </div>
</div>

<style lang="scss">
    .tool-selector__overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 999;
    }

    .tool-selector {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        flex-direction: column;
        width: 90%;
        max-width: 700px;
        max-height: 80vh;
        background: var(--b3-theme-background);
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;

        &__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px;
            border-bottom: 1px solid var(--b3-theme-surface-lighter);

            h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 500;
            }
        }

        &__actions {
            display: flex;
            gap: 8px;
        }

        &__content {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }

        &__info {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px;
            margin-bottom: 16px;
            background: var(--b3-theme-primary-lightest);
            border-radius: 4px;
            font-size: 13px;
            color: var(--b3-theme-on-surface);

            .svg {
                width: 16px;
                height: 16px;
                flex-shrink: 0;
            }
        }

        &__footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            border-top: 1px solid var(--b3-theme-surface-lighter);
            font-size: 13px;
            color: var(--b3-theme-on-surface-light);
        }

        &__footer-left {
            display: flex;
            align-items: center;
        }

        &__footer-info {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--b3-theme-on-surface-light);

            .svg {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
            }
        }

        &__count {
            font-weight: 500;
        }
    }

    .tool-category {
        margin-bottom: 24px;

        &:last-child {
            margin-bottom: 0;
        }

        &__title {
            margin: 0 0 12px 0;
            font-size: 14px;
            font-weight: 500;
            color: var(--b3-theme-primary);
        }
    }

    .tool-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .tool-item {
        padding: 12px;
        border: 1px solid var(--b3-theme-surface-lighter);
        border-radius: 4px;
        transition: all 0.2s;

        &:hover {
            border-color: var(--b3-theme-primary-light);
            background: var(--b3-theme-primary-lightest);
        }

        &--selected {
            border-color: var(--b3-theme-primary);
            background: var(--b3-theme-primary-lightest);
        }

        &__header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }

        &__header-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        &__checkbox {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;

            input[type='checkbox'] {
                cursor: pointer;
            }
        }

        &__name {
            font-weight: 500;
            font-size: 14px;
        }

        &__auto-approve {
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
            user-select: none;
            font-size: 12px;
            color: var(--b3-theme-on-surface);
            padding: 2px 8px;
            border-radius: 3px;
            white-space: nowrap;

            &:hover {
                background: var(--b3-theme-primary-lighter);
            }
        }

        &__auto-approve-text {
            font-size: 11px;
        }

        &__expand {
            padding: 4px;
            min-width: unset;

            .svg {
                width: 14px;
                height: 14px;
                transition: transform 0.2s;
            }

            &--rotated {
                transform: rotate(90deg);
            }
        }

        &__description {
            font-size: 13px;
            color: var(--b3-theme-on-surface-light);
            margin-left: 28px;
        }

        &__details {
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px solid var(--b3-theme-surface-lighter);
        }

        &__full-description {
            font-size: 12px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
            background: var(--b3-theme-surface);
            padding: 8px;
            border-radius: 4px;
            margin: 0 0 12px 0;
        }

        &__parameters {
            font-size: 12px;

            strong {
                display: block;
                margin-bottom: 8px;
            }

            ul {
                margin: 0;
                padding-left: 20px;
                list-style: disc;
            }

            li {
                margin: 4px 0;
                line-height: 1.5;
            }

            code {
                background: var(--b3-theme-surface);
                padding: 2px 6px;
                border-radius: 3px;
                font-family: var(--b3-font-family-code);
            }
        }

        &__required {
            color: var(--b3-theme-error);
            font-size: 11px;
        }
    }
</style>
