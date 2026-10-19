# 独立源码插件

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

## 文件与版本

| 内容 | 路径 | 版本 / Tag |
| --- | --- | --- |
| 官方清单 | `catalog.json` | 随主应用发布；安装和检查更新仍查询 GitHub Release |
| 卡密插件 | `gift-cards/` | 1.1.0 / `plugin-gift-cards-v1.1.0` |
| 开发示例 | `example/` | 1.0.0 / `plugin-example-v1.0.0` |
| SDK / 打包 CLI | `sdk/` | 1.0.0 / `plugin-sdk-v1.0.0` |

标签是发布约定，不表示已创建远程 Release。官方 ID 可以由手动包使用；这只表示目录匹配，不证明上传文件的来源可信。

插件 Release 上传源码 ZIP 与 `checksums.sha256`，不发布前后端 bundle。独立校验 workflow 负责类型/行为测试；发布流程只校验版本和包结构并归档源码，不编译插件、不回写 Git 历史。发布前应确认对应提交的独立验证已通过。普通插件源码独立发版；SDK 和目录也是宿主输入，修改它们需要准备应用版本。

## 生产运行

宿主在管理员确认安装后，以受限并发的独立 Worker 编译源码；语法/依赖错误时不替换旧版本。仅允许包内相对源码、固定 SDK 和明确允许的宿主依赖。不会执行包内构建脚本。

所有插件本地持久文件位于 `APP_DATA_PATH/plugins/{pluginId}/`，包括 archives、packages、compiled、staging、snapshots。业务数据和状态在主数据库，SQLite 本身位于 `data/database`。插件 ID 用作目录名，不使用可变的展示名称。

详细说明见主仓库 `docs/plugins/`。
