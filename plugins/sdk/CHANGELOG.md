# Changelog

## 1.4.0

- 新增插件隔离的私有文件流式上传、下载、归档与备份恢复。
- 通过既有存证基础设施提供主网 Memo 准备、签名校验、广播和最终确认能力。
- 新增受限用户查询、RESTRICT 用户关系与持久化停用保护声明。
- 新增带权限、审计及只读／草稿策略的插件 MCP 贡献。
- 扩展共享步骤、时间轴、Markdown 和交互组件，继续复用宿主 React 与主题。

## 1.3.0

- 扩展固定付款协议，支持 Solana 主网 USDT 的原始整数金额，保留既有 SOL 订单与签名协议。
- USDT 由宿主固定代币、精度及关联账户，钱包一次签署转账与必要的账户创建费用；不托管私钥。
- 增加仅迁移阶段可用的声明列存在检查，支持跨数据库升级且不暴露数据库错误或未声明表结构。

## 1.2.0

- 增加随插件发布的中英文资源、配置展示元数据和统一导航图标。
- 扩展宿主账户卡片、配置展示和局部 i18n Provider，兼容原有插件接口。

## 1.1.0

- Add system-owned market quotes and fixed Mainnet SOL transfer services.
- Add explicit background point-credit permission for declared scheduler jobs.
- Share the host wallet hook with optional wallet-enabled plugin contributions.


## 1.0.1

- 将最低 Node.js 版本同步至 24.22.1，保持安全运行要求与宿主一致。

## 1.0.0

- 发布源码 ZIP 打包 CLI（pack），安装时由宿主编译；不再发布预构建插件 bundle。
- SDK 打包器只负责源码归档，不再携带宿主编译工具依赖。
- 删除 legacyName 特例，普通插件表与页面路由是默认扩展边界。

- 提供 Manifest 校验、共享 UI 门面、跨 Worker 事务与宿主服务协议。
- 拒绝重复的 API / UI / 任务 / 事件 / 服务声明；前端复用宿主 React。
- 提供严格类型检查、独立打包 CLI、SHA-256 清单与可移植数据结构描述。
