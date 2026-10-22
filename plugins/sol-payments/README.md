# Solana 购买积分

官方源码插件 `slothvault.sol-payments`，要求 SlothVault >= 2.7.9、Plugin SDK ^1.3.0。默认使用 Solana Mainnet USDT 购买积分，也可选择原生 SOL；USDT 不等同于美元或人民币。

USDT 固定为 [Tether 官方 Solana 代币](https://tether.to/en/supported-protocols/) `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`，使用经典 Token Program 和 6 位小数。收款配置填写钱包地址，系统推导其 USDT 关联代币账户（ATA）。交易会按需创建收款 ATA，付款钱包需持有足够 USDT，并预留 SOL 支付网络手续费及可能的账户创建费用。

## 配置与启用

1. 在系统设置 → RPC 节点中配置 Mainnet 主、备用节点。交易会校验 Mainnet genesis，付款流程不使用存证的默认网络。
2. 如果同时提供 SOL 支付，在系统设置 → 价格源中选择主备适配器和 HTTPS 地址，保存后分别检测或同时检测。USDT 直接按积分比例计价，不依赖 SOL 行情。默认接口：
   - OKX：`https://www.okx.com/api/v5/market/ticker?instId=SOL-USDT`
   - Bitget：`https://api.bitget.com/api/v2/spot/market/tickers?symbol=SOLUSDT`
   两者为免 Key 公共行情接口，国内服务器可达性必须实际检测；双源失效时不会使用旧行情创建 SOL 订单，USDT 订单可继续创建。
3. 从官方目录或应用 Release 的源码 ZIP 安装插件。安装默认禁用。后台“插件管理 → 详情”编辑配置：

```json
{
  "salesEnabled": false,
  "recipient": "填写实际的 Solana 收款公钥",
  "pointsPerUsdt": "100",
  "minPoints": 1,
  "maxPoints": 1000000
}
```

这里的 `100` 仅为配置示例，表示 1 USDT 可购买 100 积分；选择 SOL 时按当时 SOL/USDT 行情换算。默认比例为 `0`，必须明确设置正数比例。系统不保存收款私钥。确认收款地址和比例后启用插件，再将 `salesEnabled` 设为 `true` 开放新订单。

账户 → 购买积分，连接钱包，确认币种（首选 USDT）、输入整数积分，获取有效期 5 分钟的订单，再核对币种、金额、收款地址及 Mainnet 并签名。金额按对应最小单位向上取整，不经过浮点数。网络费用额外支付。只接受本站构建的订单交易，不提供外部转账认领或自动退款。

## 收款与恢复

- 订单保存币种、比例、地址、积分数及最小单位金额；SOL 订单还保存行情快照。修改配置不修改已有订单。
- 升级通过可恢复的插件迁移增加可空币种与代币金额列；旧订单及无币种标签的交易仍按原生 SOL 处理，保留既有签名、金额与核验。
- 服务端在广播前保存签名交易。广播失败或超时不撤回已接受的付款，不让用户重新付款。
- 只有成功 finalized 且消息完全匹配的转账才可入账。USDT 还核对固定 mint、程序、精度、账户所有者及双方最小单位余额变化。订单结算、余额、积分流水及幂等凭证使用同一事务。
- 每个订单只有一个未确定结果的支付尝试。签名交易的查询暂时为空始终视为待核验，不能据此生成另一笔付款。
- 后台每 60 秒最多并发核验 3 个到期尝试；每个尝试有 60 秒数据库租约，超过 30 次待确认后进入需要处理状态并每 5 分钟继续补查。低流量部署无需外部 cron，但宿主进程必须持续运行。
- 用户退出页面、服务重启、暂停销售不丢失已接受的付款。积分超限、账户不可用等情况保留链上凭证并进入需要处理状态，修复账户问题后重试核验。
- 暂停销售应设 `salesEnabled=false`，已有有效报价及付款仍处理。完整禁用插件将暂停全部后台补查，重新启用后继续。默认卸载保留数据；不要删除未结清订单的数据。
- 源码插件需明确授予 `market.read`、`solana.transfer`、`points.credit`、`points.credit.background`、`database`、`users.read` 权限。后台积分权限只对宿主调度的已声明 job 生效，不能通过普通匿名 API 获得。

## 验证边界

自动化集成测试使用临时 SQLite 和模拟的链上查询结果，覆盖真实插件编译、Worker、数据库事务、重启恢复及积分账本。不会自动执行主网付款。真实钱包与节点的端到端付款需要在独立测试部署进行；本插件生产交易边界固定为 Mainnet，不允许测试币进入正式积分账本。
