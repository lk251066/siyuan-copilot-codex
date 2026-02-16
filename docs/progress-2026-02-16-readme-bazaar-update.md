# 2026-02-16 进度：README 整合 + 插件商店更新检查

## 背景
- 仓库：`/mnt/d/SIYUAN/external/siyuan-plugin-copilot`
- 目标：
  1. 重写 README，去掉流水账式记录；
  2. 核对 SiYuan 插件商店（bazaar）PR 要求；
  3. 更新插件商店版本。

## 本次改动

### 1) README 文档整合
- 文件：
  - `README.md`
  - `README_en_US.md`
- 调整结果：
  - 从“按日期流水账”改为“功能导向结构”；
  - 保留并突出：概览、安装、使用、Git 同步、图片工作流、最近版本摘要、开发与打包；
  - 最近版本摘要只保留 3 条代表性版本（v1.6.37 / v1.6.36 / v1.6.34）。

### 2) bazaar PR 要求核对（官方来源）
- 来源 1（PR 模板）：
  - <https://raw.githubusercontent.com/siyuan-note/bazaar/main/.github/PULL_REQUEST_TEMPLATE.md>
  - 首次提交需要确认：仓库公开、包含 LICENSE、不含侵权内容；闭源需给审核者访问权限。
- 来源 2（bazaar README）：
  - <https://github.com/siyuan-note/bazaar/blob/main/README.md>
  - 说明合并后商店索引通常按小时自动更新。
- 来源 3（当前上架状态）：
  - `plugins.json` 已包含：`lk251066/siyuan-copilot-codex`
  - 链接：<https://raw.githubusercontent.com/siyuan-note/bazaar/main/plugins.json>

结论：**该插件已在 bazaar 列表中，后续版本更新不需要再提“新增插件 PR”，主要通过发布新 release 驱动商店更新。**

### 3) 插件商店版本更新动作
- 已发布新 release：
  - 标签：`v1.6.37`
  - 地址：<https://github.com/lk251066/siyuan-copilot-codex/releases/tag/v1.6.37>
  - 资产：`package.zip`（`sha256:6b3a0949543162cad56a165c61073dc553a16143f8cca0d7bb8dcfbf1af40c49`）
- 当前 bazaar `stage/plugins.json` 仍显示旧版本（`1.6.30`），属于索引同步延迟，等待下一轮自动更新。

## 关键命令（可复现）
```bash
# 1) 构建并生成 package.zip
cd /mnt/d/SIYUAN/external/siyuan-plugin-copilot
npm run build

# 2) 查看 bazaar PR 模板
curl -fsSL https://raw.githubusercontent.com/siyuan-note/bazaar/main/.github/PULL_REQUEST_TEMPLATE.md

# 3) 检查插件是否在 bazaar 列表
curl -fsSL https://raw.githubusercontent.com/siyuan-note/bazaar/main/plugins.json | rg "lk251066/siyuan-copilot-codex"

# 4) 发布 release 到 fork 仓库
gh release create v1.6.37 package.zip -R lk251066/siyuan-copilot-codex --target main --title "v1.6.37 / 20260216" --notes-file /tmp/release-v1.6.37-notes.md

# 5) 校验 release
gh release view v1.6.37 -R lk251066/siyuan-copilot-codex --json tagName,url,publishedAt,assets,targetCommitish,name
```

## 最小回归验证
1. 构建验证
   - 命令：`npm run build`
   - 结果：通过（exit code 0）

2. 发布验证
   - 命令：`gh release view v1.6.37 -R lk251066/siyuan-copilot-codex --json ...`
   - 结果：通过（release 存在，`package.zip` 已上传）

3. 商店状态验证
   - 命令：读取 `https://raw.githubusercontent.com/siyuan-note/bazaar/main/stage/plugins.json`
   - 结果：当前仍为 `1.6.30`，待自动任务同步

## 后续行动项
- [ ] 1 小时后复查 bazaar stage 版本是否切到 `1.6.37`
  - owner：lk251066
  - 状态：进行中
