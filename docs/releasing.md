# 发布与失败恢复

## 三个独立发布单元

| 单元 | 版本来源 | Tag | 产物 |
| --- | --- | --- | --- |
| 应用 | 根 package.json | `vX.Y.Z` | amd64/arm64 Docker 镜像、GitHub 源码归档、`slothvault-image-manifest.json` |
| Skill | integrations/skill/module.json | `skill-vX.Y.Z` | `slothvault-skill-X.Y.Z.tgz`、`slothvault-skill-manifest.json` |
| Deployment | integrations/deployment/module.json | `deployment-vX.Y.Z` | `slothvault-deployment-X.Y.Z.tgz`、`slothvault-deployment-manifest.json` |

默认分支自动发布相应单元，PR 只验证。三个单元各自排队，不取消正在运行的正式发布；连续推送时只保留最新待执行任务。被合并的中间提交会出现在下一份正式 Release 的相关提交范围中。只更新模块文档和测试时，已有模块包经过核验后跳过重复发布。

GitHub Latest 和 Docker `latest` 仅属于最新成功发布的应用；模块 Release 明确不成为 Latest。应用版本镜像用于固定部署目标，Docker 自动选择 `linux/amd64` 或 `linux/arm64`。本次提供 64 位 ARM 镜像。

## 提交前准备

先暂存本次新增文件，再执行：

```bash
npm run version:prepare
```

应用保留默认分支 first-parent 提交计数：同一 major 内 patch 从 0 到 20，随后 minor 加 1，patch 回到 0。准备命令同步根 package.json 以及 package-lock.json 的两个根版本字段。Skill、Deployment 根据实际打包内容自动准备补丁版本，同步模块元数据和本版 CHANGELOG；Skill 同步入口版本。显式设置更高版本会保留，版本回退会失败。重复准备相同未提交内容不重复递增。

README、CHANGELOG、模块 tests 和缓存不进入运行归档，不单独触发模块版本更新。CHANGELOG 需要包含当前版本的实际变更记录；自动生成的改动文件列表应在提交前补充成行为说明。CI 不修改版本文件，不创建版本提交，不回写分支历史。

Release 正文直接采用上一份已正式发布的同类 Release 以来的相关 first-parent 提交消息，按时间顺序保留标题、完整正文、换行与编号项，只添加提交链接和分隔。跨模块提交保留全文。草稿、孤立 Tag、其他发布单元的标签不会截断范围。没有上一份正式 Release 时收集该单元的相关历史提交。构建指标、校验结果和安装命令放在 Actions Summary。

## 应用发布阶段

1. 固定源码 SHA，校验应用版本、锁文件和生成的 MCP 文档；检查是否已有一致的双架构版本镜像。
2. amd64 在 `ubuntu-24.04` 构建，arm64 在 `ubuntu-24.04-arm` 构建。缓存按架构隔离，保留缓存超时及导出失败容错。PR 加载本地单架构镜像；正式构建只按 digest 推送，不提前写版本 Tag 或 `latest`。
3. 两个 runner 分别验证 SQLite 内存读写、Argon2 哈希及校验、Sharp 图像处理、Prisma CLI 加载、内嵌版本和源码 SHA，并启动临时容器检查 `/api/install/status`。检查结束清理本任务容器。
4. 两个架构都成功后校验 digest 与身份，创建或复用完整的多架构版本镜像，生成镜像发布清单。清单 schema 1 包含 `version`、`tag`、`commit`、`image`、总 `digest`，以及以平台为键的 `platforms`；每个平台记录 digest、压缩层 bytes 与 layers。
5. 创建或恢复同一提交的 Release 草稿，上传并核验镜像发布清单，再转为正式 Release。
6. 再次检查是否已有更高的正式应用版本；只有当前版本仍是最新成功版本时，更新 Docker `latest` 与 GitHub Latest。历史 amd64 镜像可用作体积基线，arm64 首次发布不计算旧版本差值。

## 模块发布阶段

固定模块版本所属 SHA 后，分别执行协议校验、打包回归测试及 Deployment 相关测试。当前打包器可从固定源码目录生成归档；归档保持 `package/` 根目录、manifest schema 1、桥主版本 1 和原有附件名。归档与逐文件 SHA-256 自检通过后，才进入独立 Release 的草稿上传与正式发布。

现有正式版本只核验对应提交和预期附件字节，不替换正文、附件或 Tag。已有附件与重新生成的确定性归档不一致时失败，不使用 `--clobber`。

## 失败恢复

在 GitHub Actions 中选择对应的 Docker、Skill 或 Deployment workflow，使用默认分支运行 `workflow_dispatch`；`ref` 填写原完整 commit SHA 或该单元的版本 Tag。空值使用当前提交。只接受默认分支 first-parent 历史中的提交，拒绝分支名与未合并目标。

| 失败位置 | 重跑行为 |
| --- | --- |
| 版本或协议校验失败 | 修正问题并准备新提交；不会发布不合格产物。 |
| 一个架构构建或运行检查失败 | 下次重新完成两架构验证；该次不会创建版本镜像 Tag、正式 Release 或更新 Latest。 |
| 完整版本镜像已生成，Release 尚未完成 | 核验并复用已有镜像，再次在两个原生 runner 上运行检查；不重建覆盖版本镜像。 |
| Release 草稿部分附件上传完成 | 核验原提交、原正文和已有附件哈希，只上传缺失附件，齐全后发布。 |
| Release 已正式发布，Latest 更新失败 | 核验已有 Release 与版本镜像，仅在仍是最新有效应用版本且指针需要修复时恢复 Latest。 |
| 同 Tag 指向其他提交，或已有附件/镜像不同 | 明确失败；准备新版本，不覆盖现有发布。 |

本流程作用于新发布。早期应用 Release 没有新的镜像清单，旧镜像也可能只有 amd64；它们保持原样。手动重跑旧版本如果不满足新交付契约会失败，不补写旧附件或覆盖旧镜像，应通过新版本发布双架构产物。

## 验证

```bash
npx vitest run scripts/release-version.test.mjs scripts/release-delivery.test.mjs scripts/docker-image-size.test.mjs scripts/standalone-optimization.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s integrations/scripts/tests
PYTHONDONTWRITEBYTECODE=1 python3 integrations/scripts/validate_protocol.py
PYTHONDONTWRITEBYTECODE=1 python3 integrations/deployment/tests/deploy_installer_test.py
git diff --check
```

workflow 改动同时使用 actionlint 检查。首次正式发布需从 Actions 确认两个原生运行检查通过，并检查版本镜像清单、Release 附件、提交正文和 Latest 指针。发布仍使用现有 `DOCKER_USERNAME`、`DOCKER_PASSWORD`，可选仓库变量 `DOCKER_IMAGE_NAME`；GitHub 发布使用 job 级 `contents: write` 的 GITHUB_TOKEN。

## 草稿没有 Git 标签时恢复

GitHub 草稿可能不会创建 Git 标签，按标签的 Release API 也可能返回 404。交付脚本通过有权限的列表定位同标签草稿，并按 Release ID 上传附件和发布。没有标签的草稿只接受与固定目标一致的完整 `target_commitish` SHA；正式 Release 仍必须有一致的 Git 标签。正文与附件哈希核验后才创建缺失标签，已有标签不能移动。测试夹具覆盖标签不可见、无标签草稿及上传中断恢复。

历史恢复必须运行修复后的交付工具，同时通过 `--root` 指向原 SHA 的干净源码目录；不能重跑旧工作流就假定能使用新交付逻辑。2.6.2 的目标为 `695ea6ff91e501f70e94f06e7291dfb2c6d2be24`，恢复前验证两平台镜像及发布标识，完成 Release 后才推进 latest。
