# 源码插件与应用发布

插件源码、SDK 和内置官方目录集中在本目录。插件不是 Next.js 路由文件，也不会随应用启动自动安装。

## 本地开发：不需要构建插件

1. 修改 `gift-cards/src` 或自己的插件目录。
2. 打包源码（不执行 TypeScript 编译）：

```sh
node plugins/sdk/cli.mjs pack plugins/gift-cards dist/plugins/gift-cards
```

3. 在后台“插件管理 → 安装插件 → 手动安装”上传生成的 ZIP，预览后确认信任并安装。
4. 首次安装默认禁用，手动启用。修改源码后重新打包、手动安装即可；允许同版本不同摘要重新安装，禁止直接降级。

不提供本地任意目录导入 API、文件监听、插件专用开发服务器或自动 npm install。`npm run plugins:pack` 可一次打包卡密与示例源码。

## 每个应用 Release 默认附带全部插件

普通插件不再依赖 `plugin-*` 标签发布。应用发布工作流从固定提交打包所有带 `plugin.json` 的目录（当前为卡密、SOL 收款和示例），不判断插件是否变更；SDK 没有插件 Manifest，不混入安装包。发布产物只包含源码，不先构建插件 bundle。

```sh
npm run plugins:pack
```

单插件产物保留在 `dist/plugins/{目录名}/`；应用 Release 附件集中在 `dist/application/plugins/`，包含所有源码 ZIP 和覆盖全部 ZIP 的 `checksums.sha256`。不会将各目录的同名校验文件直接合并覆盖。

| 内容 | 当前版本 | 发布方式 |
| --- | --- | --- |
| 卡密插件 | 1.1.1 | 应用 `vM.m.p` Release 中的 `slothvault-plugin-slothvault.gift-cards-1.1.1.zip` |
| 开发示例 | 1.0.1 | 应用 `vM.m.p` Release 中的 `slothvault-plugin-slothvault.example-1.0.1.zip` |
| SOL 购买积分 | 1.0.0 | 应用 Release 中的 `slothvault-plugin-slothvault.sol-payments-1.0.0.zip` |
| SDK / 打包 CLI | 1.1.0 | 使用 `plugin-sdk-v1.1.0` 独立发布 |

新提交通过根 `package.json` 中的 `slothvaultRelease.pluginAssets: true` 声明附件契约。每个新应用 Release 必须同时包含镜像清单、全部插件 ZIP 和统一校验文件，附件未齐全时不得公开 Release 或提升 Latest。草稿可以补传缺失附件；已发布附件、标签及历史版本不会被覆盖。历史提交没有该标记，重试时沿用旧契约。

插件自身版本显式维护：`package.json` 和 `plugin.json` 版本必须一致；源码未变可重复携带相同版本，已发布源码发生变化必须升级插件版本。插件源码、Manifest 或包版本单独变化也属于应用发布输入，提交前执行 `npm run version:prepare` 同步应用与锁文件版本。CI 只校验和发布，不自动回写版本提交。

发布步骤：更新插件源码及其显式版本（无变化则不改）→ `npm run plugins:pack` 与相关检查 → 提交前按仓库规则准备应用版本 → 由维护者提交并推送默认分支 → 查看应用发布工作流，确认 Release 包含所有插件 ZIP 和 `checksums.sha256` → 升级宿主后从后台官方目录选择版本安装。

`v2.6.14` 及以前的应用 Release 不补包、不改标签。旧宿主仍按旧目录查找独立插件标签，需要升级宿主，或下载可信源码 ZIP 后手动上传。GitHub 的 Source code ZIP/tar.gz 是整个仓库快照，不能作为插件包。官方 ID 只表示目录匹配，不证明手动上传文件的来源可信。

## 生产运行

宿主在管理员确认安装后，以受限并发的独立 Worker 编译源码；语法/依赖错误时不替换旧版本。仅允许包内相对源码、固定 SDK 和明确允许的宿主依赖。不会执行包内构建脚本。

所有插件本地持久文件位于 `APP_DATA_PATH/plugins/{pluginId}/`，包括 archives、packages、compiled、staging、snapshots。业务数据和状态在主数据库，SQLite 本身位于 `data/database`。插件 ID 用作目录名，不使用可变的展示名称。

详细说明见主仓库 `docs/plugins/`。

## SOL 购买积分

新增 `sol-payments` 插件使用宿主公共行情、Mainnet 交易校验及积分账本。配置与恢复规则见 [sol-payments/README.md](sol-payments/README.md)。SDK 1.1.0 新增对应受限接口；新插件要求宿主 >=2.7.7，默认关闭销售。
