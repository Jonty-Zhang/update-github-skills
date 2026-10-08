# update-github-skills

一个跨工具的 Agent Skill：**盘点并更新本机所有从 GitHub 安装的 skill**，覆盖 Claude Code、Codex、Cursor、Gemini CLI、OpenCode、Copilot 等工具，包括用户级、项目级、共享目录、自定义目录和插件内的安装。

## 特性

- **只读盘点**：`scripts/inventory.mjs` 只读取 `SKILL.md`、来源元数据和 Git 信息，不联网、不修改任何已安装内容
- **来源识别**：通过安装元数据（`.skill-lock.json`、`skills-lock.json`、`.openskills.json`）、Git remote 与用户 manifest 交叉确认 GitHub 来源；报告自动剥离 remote URL 中的凭据
- **安全更新**：按安装方式分别处理
  - Git 克隆：只做可快进更新（`merge --ff-only`），不使用 reset / stash
  - 复制 / ZIP 安装：备份、暂存、校验后替换，失败自动还原
  - 插件 / 包管理器：通过原管理器更新，不直接覆盖版本化缓存
- **诚实报告**：每个安装都有明确状态（已更新 / 已是最新 / 本地修改阻塞 / 来源待确认 / 管理器待处理等）；固定版本、本地修改和来源歧义不会被擅自处理

## 安装

将本目录复制（或链接）到目标工具的 skills 目录：

| 工具 | 安装位置 |
|---|---|
| Claude Code | `~/.claude/skills/update-github-skills/` |
| Codex | `~/.codex/skills/update-github-skills/` |

## 使用

对 agent 说「更新所有从 GitHub 安装的 skill」即可触发；也可以直接运行盘点脚本：

```sh
node scripts/inventory.mjs --report before.json
```

要求：Node.js 18+；识别 Git 来源需要 Git。

## 目录结构

| 文件 | 说明 |
|---|---|
| `SKILL.md` | skill 入口：发现范围、更新执行、校验交付的完整流程 |
| `agents/openai.yaml` | Codex 界面配置（显示名称与默认提示词） |
| `references/update-methods.md` | 按安装方式的更新操作参考 |
| `scripts/inventory.mjs` | 只读盘点脚本 |
| `scripts/inventory.test.mjs` | 行为测试（`node scripts/inventory.test.mjs`） |
