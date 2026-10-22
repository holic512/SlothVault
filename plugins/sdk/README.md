# @slothvault/plugin-sdk

SDK v1 提供经过校验的 Manifest、Kysely 跨 Worker 数据库驱动、积分与服务桥接、共享 React UI 类型，以及 源码 ZIP 打包 CLI。

```sh
npm install -D ./slothvault-plugin-sdk-1.0.1.tgz
npx slothvault-plugin pack . dist
```

要求 Node >=24.22.1；插件开发可使用严格 `tsconfig.json`；发布源码包包含同版本 `package.json` / `plugin.json` 和`format: source-v1` 的源入口 `plugin.build.json`。客户端只使用 `@slothvault/plugin-sdk/client` 门面；服务端通过 `definePlugin` 返回声明的处理器。不要把 SDK client 的占位实现当作独立网页运行库。

协议、生命周期、表/事务、安全边界、开发示例及运维说明见主仓库 `docs/plugins/`。该 SDK 使用 MIT License，不包含宿主的账户或数据库凭据。

## Market data and SOL payments (SDK 1.1)

Declare `market.read` for `context.marketData.quote()`. The host owns public price-source settings; quotes contain explicit SOL/USDT units, provider and timestamps and are not persisted by the SDK.

Declare `solana.transfer` for `context.solana.validateIntent`, `prepare`, `validateSigned`, `broadcast` and `observe`. These accept only Mainnet native SOL with a plugin-scoped order Memo. Save the signed transaction and signature before calling `broadcast`, and use `observe` to verify finalized chain facts. Host networking must occur outside a plugin database transaction.

`points.credit.background` additionally permits `points.credit` from an actual host-scheduled declared job without a user actor. Both permissions must be declared. Foreground calls retain the user/administrator ownership restriction. Settlement must pass its Kysely transaction to `points.credit` and use a stable source key.

An account UI contribution can declare `wallet: true` and call `usePluginWallet()` from the client facade. The host supplies its existing WalletRuntime; do not create or bundle another wallet provider. Old manifests remain compatible.
