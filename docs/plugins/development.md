# 插件源码包开发

## 包结构

```text
plugin.json
plugin.build.json
hashmanifest.json
src/server.ts
src/client.tsx
src/optional.css
```

`plugin.build.json` 为纯 JSON：`format: "source-v1"`、可选 server 源文件、client 按贡献 key 映射源码、可选 css 映射。Manifest 保留输出入口声明（server/*.mjs、client/*.js/css）；宿主根据源映射生成这些产物。旧预构建 ZIP 明确拒绝。

运行 `node plugins/sdk/cli.mjs pack <插件目录> <输出目录>` 只打源码包，不编译。包内只允许声明文件和 src 下的 ts/tsx/js/jsx/mjs/json/css，禁止环境文件、符号链接、node_modules、越界路径及预构建目录。外部校验和在 checksums.sha256；内部清单覆盖全部载荷文件但不包含自身。

## 宿主编译规则

插件源码仅通过包内相对路径引用自己的文件；服务端可引用 SDK server/protocol、宿主 zod/kysely 和 Node 内置模块。客户端仅引用宿主 React、JSX runtime 和 SDK client。禁止任意第三方包解析、跨目录源码、tsconfig hooks 或插件提供的构建代码。

类型与行为检查由独立 verify-plugins 工作流执行，应用镜像发布仍以三库检查为前置。插件 Release 工作流仅验证 Tag/版本并打源码 ZIP，不编译插件；SDK 自身发布才构建 SDK。

类型检查属于开发/CI；宿主安装执行语法编译、来源校验和运行健康检查，不执行插件 package.json scripts。生产包同样允许同版本新摘要手动重新安装，更新记录保留摘要；发布 Tag 仍要求递增版本，不覆盖已发布 Tag。

## 扩展规范

- 优先注册 page/menu，在后台、账户、公开 extensions 命名空间提供独立功能。
- 可选插槽保留 admin.dashboard.cards、admin.article.actions、account.points、public.home.before/after；不要求插件注入原页面。
- API 只传 JSON，权限由宿主会话绑定；写请求同源并限流。服务端不得信任浏览器提交的 actor。
- `ctx.table()` 取得普通自有表名；安装创建表，迁移仅处理已存在表变化。不要把业务表加回核心 Prisma schema。
- 在事务中执行积分 credit 或事件 emit 必须传入同一 tx。积分流水与幂等凭据属于宿主，不随插件清理删除。
- 任务至少一次投递，最多三次尝试；用 task.id 在自有表去重。禁用取消待办，成功/取消/最终失败记录保留七天。
- 生命周期工厂注册处理器，不在工厂阶段调用宿主 RPC；dispose 清理资源。长时计算不阻塞宿主。
- 共享 UI 门面提供 Drawer、表单、表格等组件。页面包装层维持布局，插槽不强占整页高度，effect 返回清理函数。

## 卡密插件

卡密 1.1.0 明文保存完整码，管理员批次明细可重复查看/复制。兑换在独立账户路由 `/account/extensions/slothvault.gift-cards/redeem`；积分中心只显示余额和流水。旧卡密不转换，新表不使用旧表名。

明文也会进入数据库备份；数据库或备份泄露可能暴露有效兑换码。客户端普通用户接口、公共元数据和日志不得包含完整码。一次性兑换、核心事务和幂等凭据仍强制保留。
