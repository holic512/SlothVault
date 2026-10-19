# @slothvault/plugin-sdk

SDK v1 提供经过校验的 Manifest、Kysely 跨 Worker 数据库驱动、积分与服务桥接、共享 React UI 类型，以及 源码 ZIP 打包 CLI。

```sh
npm install -D ./slothvault-plugin-sdk-1.0.0.tgz
npx slothvault-plugin pack . dist
```

要求 Node >=24.18.1；插件开发可使用严格 `tsconfig.json`；发布源码包包含同版本 `package.json` / `plugin.json` 和`format: source-v1` 的源入口 `plugin.build.json`。客户端只使用 `@slothvault/plugin-sdk/client` 门面；服务端通过 `definePlugin` 返回声明的处理器。不要把 SDK client 的占位实现当作独立网页运行库。

协议、生命周期、表/事务、安全边界、开发示例及运维说明见主仓库 `docs/plugins/`。该 SDK 使用 MIT License，不包含宿主的账户或数据库凭据。
