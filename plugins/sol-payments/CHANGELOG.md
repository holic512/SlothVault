# Changelog

## 1.2.1

- 分隔订单明细、报价倒计时与手续费提示，统一付款和次要操作的间距。
- 桌面端主次按钮同行排列，窄屏下付款按钮独占一行，重新购买和刷新均分下一行。

## 1.2.0

- 默认使用 Solana 主网 USDT 购买积分，保留原生 SOL 支付及旧订单恢复。
- USDT 使用固定官方代币和 6 位整数金额，核对账户、费用及最终到账后幂等入账。
- 新增币种选择、订单金额展示和中英文费用提示；可兼容升级已有订单表。

## 1.1.0

- 增加随插件发布的中英文资源、配置展示元数据和统一导航图标。
- 优化配置与页面交互，适配宿主分组导航和独立更新流程。

## 1.0.0

- Add native SOL point purchases with five-minute immutable SOL/USDT quotes.
- Persist signed payments before broadcast and reconcile finalized transactions through the host ledger.
- Add user purchase/history pages, administrator order inspection and account points entry.
- Retain payment evidence across pauses, restarts, ordinary uninstall and portable backups.
