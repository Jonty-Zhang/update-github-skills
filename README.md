# update-github-skills

一个跨工具的 Agent Skill：**盘点并更新本机所有从 GitHub 安装的 skill**，覆盖 Claude Code、Codex、Cursor、Gemini CLI、OpenCode、Copilot 等工具，包括用户级、项目级、共享目录、自定义目录和插件内的安装。

盘点由随附脚本完成；更新操作由加载此 skill 的 agent 按流程执行。

## 特性

- **只读盘点**：`scripts/inventory.mjs` 只读取 `SKILL.md`、来源元数据和 Git 信息，不联网、不修改任何已安装内容
- **来源识别**：通过安装元数据（`.skill-lock.json`、`skills-lock.json`、`.openskills.json`）、Git remote 与用户 manifest 交叉确认 GitHub 来源；报告自动剥离 remote URL 中的凭据
- **安全更新流程**：agent 按安装方式分别处理
  - Git 克隆：只做可快进更新（`merge --ff-only`），不使用 reset / stash
  - 复制 / ZIP 安装：备份、暂存、校验后替换，失败时还原；备份统一放在同卷的 `.skill-updater-backups/` 中
  - 插件 / 包管理器：通过原管理器更新，不直接覆盖版本化缓存
- **诚实报告**：每个安装都有明确状态（已更新 / 已是最新 / 本地修改阻塞 / 来源待确认 / 管理器待处理等）；固定版本、本地修改和来源歧义不会被擅自处理
- **发现范围**：常见工具与其他隐藏工具目录默认搜索 16 层，支持符号链接/联接和深层插件布局；额外项目、磁盘与自定义位置可显式补扫，扫描缺口会写入报告

## 安装

将本目录复制（或链接）到目标工具的 skills 目录：

| 工具 | 安装位置 |
|---|---|
| Claude Code | `~/.claude/skills/update-github-skills/` |
| Codex | `~/.codex/skills/update-github-skills/` |

## 使用

安装后对支持 Agent Skills 的 agent 说「更新所有从 GitHub 安装的 skill」；也可以直接运行盘点脚本。在 skill 安装目录之外的工作目录执行（将示例中的脚本路径改成实际路径）：

```sh
node "<skill目录>/scripts/inventory.mjs" --report .skill-update-reports/run-001/before.json
```

要求：Node.js 18+；识别 Git 来源需要 Git。

使用 `--report` 时完整清单保存到文件，终端只显示计数摘要。追加 `--json` 可同时打印完整 JSON。已有报告不会覆盖，再次运行请更换文件名。退出码 `0` 表示本次声明范围内没有发现告警，`2` 表示存在扫描缺口，`1` 表示运行失败；`0` 不保证未知位置都已覆盖，也不代表任何 skill 已更新。

补扫其他项目或自定义位置：

```sh
node "<skill目录>/scripts/inventory.mjs" --scan-root "<项目父目录>" --scan-root "<自定义安装目录>" --report .skill-update-reports/run-001/expanded.json
```

运行行为测试：

```sh
node scripts/inventory.test.mjs
```

测试在临时目录中构造安装和 Git 来源，不读取或更新真实安装。运行报告包含本机绝对路径，应保存在本地；默认报告目录、备份目录、临时测试目录和 `acceptance/` 已加入 `.gitignore`。仓库只提交 skill、脚本、测试及说明。

## 目录结构

| 文件 | 说明 |
|---|---|
| `SKILL.md` | skill 入口：发现范围、更新执行、校验交付的完整流程 |
| `agents/openai.yaml` | Codex 界面配置（显示名称与默认提示词） |
| `references/update-methods.md` | 按安装方式的更新操作参考 |
| `scripts/inventory.mjs` | 只读盘点脚本 |
| `scripts/inventory.test.mjs` | 行为测试（`node scripts/inventory.test.mjs`） |
