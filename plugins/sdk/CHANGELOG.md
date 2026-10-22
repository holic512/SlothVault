# Changelog

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
