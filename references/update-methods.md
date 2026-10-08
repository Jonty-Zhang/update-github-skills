# 按安装方式更新

此文是供执行该 skill 的 agent 使用的操作说明。示例中的路径、remote 和分支都须从实际安装取值，不能直接把占位符当命令执行。用参数数组调用进程，或使用宿主 shell 的可靠转义。

## Git 仓库

1. 记录仓库根路径、`HEAD`、分支、upstream 和全部 GitHub remotes。检查 `git status --porcelain=v1 --untracked-files=all`，包括未跟踪文件、子模块、合并/rebase 中间状态。非干净仓库保留原状并记录。来源元数据优先于项目自己的 remote；项目内独立复制的 skill 不能靠更新整个项目来更新。
2. `git branch --show-current` 为空可能是固定 commit/tag；不能自动 checkout 默认分支。存在 upstream 时核对它的仓库来源。没有 upstream 时先确认安装时的分支策略；有多个可能上游且无明确证据时记录歧义。保持用户 fork，不直接切换到原作者仓库。
3. 核对后，对对应 remote 执行 `git fetch <remote>`。记录 fetch 后目标 commit，使用 `git merge-base --is-ancestor HEAD <目标>` 确认可以快进。等于当前 HEAD 为已最新；本地领先或分叉要单独报告。目标快进时执行 `git merge --ff-only <目标>`，不要使用 reset/rebase/force 或自动 stash。必要时加 `-c core.hooksPath=<本次创建的空目录>` 防止更新触发本地 hooks；使用现有 Git 认证。
4. 如仓库跟踪 GitHub 默认分支，以远端 HEAD 判断默认分支，不能猜 main/master。tag、commit 或明确版本约束保持固定；可报告有新版本但不能暗自解锁。仓库中有子模块时按其锁定 commit 处理并报告子模块失败，不把父仓库成功当成完整成功。
5. 记录更新前后的 commit 和原分支，检查所有受影响 skill 入口。如果更新使原子目录消失，报告上游删除/迁移，不删除其他安装或自动换成同名项目。

## 复制、ZIP 和无 .git 的安装

1. 从已确认的来源取得仓库快照。优先用 Git 在临时目录获取准确 ref，或使用 GitHub API/官方归档。无 ref 时从远端 HEAD 解析实际默认分支；有 ref 时区分 branch/tag/commit，记录最终 commit。归档解压必须拒绝绝对路径、`..` 越界路径和外部链接；Git 子模块/LFS 文件要识别，不能把占位指针当完整资产。私有仓库使用已有凭据，不在报告中打印 token。
2. 定位准确子目录并验证 `SKILL.md`。元数据的 `skillPath` 可能以 `/SKILL.md` 结尾，去掉文件名得到目录。若来源未记子目录，只在已确认仓库内按目录/skill 名查找；唯一匹配且内容/记录能相互印证时采用，否则列为歧义，不取第一个结果。
3. 比较当前目录、上次安装基线与新快照。优先使用已有安装 hash/commit 或本 skill 之前记录的文件清单。全局 `skillFolderHash` 通常是 Git tree SHA；项目 `computedHash` 是管理器定义的内容哈希，**不能**直接把它们当 SHA-256 文件摘要比较。用对应管理器算法或取回旧快照进行比较。
4. 已确认本地修改时跳过并报告，或按用户明确要求保存后合并。没有可验证的旧基线时不能保证区分定制与上游改动：先保存完整备份及差异，保留所有疑似本地定制；无法安全判定时列为“本地修改待核对”，继续其他项。没有基线本身不等于有修改，可在当前内容与已记录旧 commit 的快照一致后正常更新。
5. 在安装目标的同一文件系统暂存完整新目录，保留管理器专用来源文件，例如 `.openskills.json`。旧目录统一保存到同卷的 `.skill-updater-backups/<运行编号>/<安装标识>/`（例如安装目录父级下的该目录），具体备份路径写入报告；不要在其他可被正常扫描的位置保留带 `SKILL.md` 的备份副本。校验暂存内容后替换物理目录，不破坏指向它的符号链接/联接。Windows 递归删除/移动前校验绝对路径确实在明确目标及备份范围内，整个操作使用同一个 shell 的原生文件操作。替换失败时还原旧目录并报告；不把半更新目录留作成功结果。
6. 更新可信的来源记录和运行报告。由管理器维护的 lock 优先通过该管理器写入，保留未知字段、原 scope、ref 和 installedAt。无法正确写回时不要伪造 hash：优先原管理器重装准确 skill，或报告 lock 待同步。记录新的 commit 和完整文件摘要，供下次检测定制。

## 安装器、插件与系统内置项

先查看本机已安装命令的帮助及来源记录。CLI 参数随版本变化，不要盲目执行旧示例，也不要为了更新 skill 顺带升级工具本体。

- **Vercel skills CLI**：全局来源通常在 `~/.agents/.skill-lock.json`，也可能位于 `$XDG_STATE_HOME/skills/.skill-lock.json`；项目通常为 `skills-lock.json`。核对 `skills check` / `skills update` 的当前实际作用域与 GitHub 过滤能力。若原生命令会连带非 GitHub 项，用精准 source、skill、原 agent 集合与原 global/project scope 重装该已安装项。不要使用会安装额外 skill 或额外 agent 的 `--all`。更新后核对每个实际副本及 lock，而非只看 CLI 退出码。
- **OpenSkills**：每个 skill 的 `.openskills.json` 可记录 repoUrl、subpath、sourceType。使用当前版本 `openskills update` 的准确 skill 参数及原安装目录；混合来源时只选择已确认的 GitHub 项。不把 local 类型更新成 GitHub 搜索到的同名项。
- **Claude Code、Codex 或其他工具的插件包**：根据插件安装索引/manifest 追踪准确包来源和安装 scope。使用其原生更新操作；一个插件的多个 skill 只更新包一次。若管理器只允许更新到平台发布版本，报告“平台当前可用版本”，不能承诺等同 GitHub 默认分支。不直接改写版本化 cache、不擅自更新整个 marketplace 的所有无关插件。
- **内置/系统 skill**：确认是否存在独立的 GitHub 安装来源。仅随应用分发、无独立更新入口的内容列为内置管理项；报告须说明其状态，不能把它们悄悄过滤后宣称所有 GitHub 项已更新。

遇到未知管理器，读取它的来源清单并采用等价流程。来源是其他代码托管站或本地自建时标为范围外；用户要求的是 GitHub 来源，并不意味着忽略其他工具中的 GitHub skill。

## 来源格式参考

以下为盘点器所兼容的来源格式，实际安装的 schema 若变化，以当前文件和管理器实现为准：

- [跨工具目录定义](https://github.com/vercel-labs/skills/blob/main/src/agents.ts)
- [全局来源锁](https://github.com/vercel-labs/skills/blob/main/src/skill-lock.ts)
- [项目来源锁与内容哈希](https://github.com/vercel-labs/skills/blob/main/src/local-lock.ts)
- [OpenSkills 安装元数据](https://github.com/numman-ali/openskills/blob/main/src/utils/skill-metadata.ts)

## 盘点器参数与限制

`node scripts/inventory.mjs --help` 显示全部参数。不指定 `--report` 时输出完整 JSON 到标准输出；指定 `--report` 时将完整 JSON 写到 UTF-8 文件，终端只输出文件路径、skill/状态/告警计数等摘要。只有显式追加 `--json` 才在保存文件的同时打印完整 JSON。已有报告不覆盖，复扫请换文件名。盘点器不执行更新、不联网、不写入安装目录。完整报告包含 `sourceCandidates`、Git 根目录、管理器提示、全部入口别名及发现警告，最终来源决策由 agent 核对。

默认从常见目录以及用户隐藏工具目录搜索，所有根目录默认递归深度 16，可用 `--max-depth` 调整；最多读取 100000 个不同物理目录，可用 `--max-dirs` 调整。不同根的重叠目录复用读取结果，不重复消耗目录预算，仍保留不同的入口别名。一个物理子树已被其他根完整扫描时，较浅遍历产生的深度告警会移除；真正未覆盖的子树仍保留告警。命中上限会写警告并返回退出码 2。

目录排除项写入 `exclusions`。隐式工具发现跳过 `.cache/codex-runtimes`、`.vscode/extensions` 等运行时/依赖树，以及 `.codex/app-server-control`、`.codex/app-server-daemon` 中的运行时通信端点，不把它们的深层内容或 IPC socket 当成 skill 发现失败，也不会泛化跳过真正的 `plugins/cache` 或整个 `.cache`。显式 `--scan-root` 可补扫这些运行时/扩展树；对通用排除项（例如 `node_modules`）则用 `--root` 直接指定其中的安装目录。`.skill-updater-backups` 为保留备份目录，正常盘点不深入其内。入口符号链接和联接会跟随并去重，脚本本身也可通过联接安装路径调用。内部环路、断链和访问错误有警告。其他项目和磁盘须使用 `--scan-root` 补扫。使用 `--no-defaults` 时只扫描显式参数，适合隔离测试。

来源 manifest 的错误会中止盘点，损坏/未知锁文件则保留警告。插件 cache 的来源格式因管理器而异，脚本只作管理器提示；不把普通文件中的链接猜成来源。脚本不会报告 remote URL 中的凭据。
