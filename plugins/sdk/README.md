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

Declare `solana.transfer` for `context.solana.validateIntent`, `prepare`, `validateSigned`, `broadcast` and `observe`. These accept Mainnet native SOL and, since SDK 1.3, fixed Mainnet USDT with a plugin-scoped order Memo. Save the signed transaction and signature before calling `broadcast`, and use `observe` to verify finalized chain facts. Host networking must occur outside a plugin database transaction.

`points.credit.background` additionally permits `points.credit` from an actual host-scheduled declared job without a user actor. Both permissions must be declared. Foreground calls retain the user/administrator ownership restriction. Settlement must pass its Kysely transaction to `points.credit` and use a stable source key.

An account UI contribution can declare `wallet: true` and call `usePluginWallet()` from the client facade. The host supplies its existing WalletRuntime; do not create or bundle another wallet provider. Old manifests remain compatible.


### Localized configuration and account UI (SDK 1.2)

Packages may provide `display.name`, `display.description`, and `display.config[field]`
with `{ zh, en }` text. Each configuration field supports `label`, `description`, and
`placeholder`; configuration values remain governed by `configSchema`. Missing
metadata falls back to the original manifest text and field key. Simple scalar
schemas render as fields; complex schemas retain the lossless JSON editor.

Wrap a contribution with `PluginI18nProvider messages={{ zh, en }}` to ship its
own dictionaries. The provider inherits the host locale and merges local namespaces
with host messages, so existing `useTranslations` calls remain supported.
`PluginAccountCard` shares account surface appearance; `PluginToolbar` shares the
administrator filter surface. UI contributions accept optional `icon` values
`blocks`, `coins`, `ticket`, `wallet`, or `settings`.

Updates use the installed source and exact plugin identity. Packages without a
recorded source require explicit ZIP upload. Updating requires package preview and
code trust, preserves configuration and enabled state, and uses the existing
transactional upgrade and recovery mechanism. Publish SDK 1.2 packages with
`engines.sdk: "^1.2.0"` and a host minimum supporting these additions.

### Mainnet USDT payments (SDK 1.3)

Native SOL intents retain `{ orderId, payer, recipient, lamports, network: 'mainnet' }`.
USDT intents instead use `{ orderId, payer, recipient, asset: 'USDT', tokenAmount, network: 'mainnet' }`,
where `tokenAmount` is a positive integer string of six-decimal raw units. The host fixes
the official USDT mint and classic Token Program, derives both ATAs, and includes
idempotent creation of the recipient ATA. It checks USDT balance, account ownership,
network fees and any required rent before signing. Wallets still need SOL for fees.

The returned prepared message is immutable. Observation requires finalized success,
the exact signed message and matching token balance changes; RPC submission alone
does not settle an order. Legacy SOL prepared payloads without `asset` stay valid.

Managed migrations can call `context.schema.hasColumn(logicalTable, column)` before
adding declared columns. The host limits inspection to the plugin's own manifest
tables and columns during migration; it does not expose database errors or arbitrary metadata.


### SDK 1.4: private files, Mainnet evidence and safe contributions

- Declare `files.private` and an API `transport` of `upload` (POST), `download` or `archive` (GET). Upload raw bytes with `Content-Type: application/octet-stream`, percent-encoded `X-File-Name` and decimal `X-File-Size`. The host invokes the endpoint with `input.phase = authorize` before consuming the stream and `complete` with `input.upload` afterwards. Both phases must enforce record ownership. Downloads return `{ fileId, name? }`; archives return `{ name, entries: [{ path, fileId? , text? }] }` with exactly one content source per entry.
- `ctx.files.inspect(id)` / `ensure(ids)` validate immutable bytes inside the caller's private namespace. Plugins persist references and control sharing; the host transfers files without buffering them in the worker. Private files are retained on data-preserving uninstall and included in complete backups.
- Declare `evidence.memo` for `ctx.evidence.prepare`, `validateSigned`, `broadcast`, and `observe`. The JSON Memo's `protocol` must equal the plugin ID. Only active administrators prepare/sign/broadcast; declared jobs may rebroadcast existing signed bytes. The host requires Mainnet genesis and exact signed messages. Persist signed bytes and their signature **before** broadcast; only `FINALIZED` may release a business gate. The API does not hold keys or ask customers to sign.
- `ctx.users.find({ query?, userId? })` returns a limited account projection. Searches require an administrator; ordinary users can query only themselves. A declared core-user reference with `onDelete: RESTRICT` prevents deletion even while the plugin is inactive.
- `lifecycleGuards: [{ table, column, values, message }]` prevents disabling/uninstalling while matching rows exist. Guards use declared plugin-owned textual columns and are checked without executing plugin code.
- `mcp` contributions declare `key`, namespaced `name`, `title`, `description`, bounded `inputSchema`, `access`, `readOnly`, and `operation: read | draft`. Implement handlers in `PluginServer.mcp`; expose only queries and draft changes. Formal submissions, signatures and payments must remain web-only. The host binds the authenticated actor and rechecks activation at invocation.
