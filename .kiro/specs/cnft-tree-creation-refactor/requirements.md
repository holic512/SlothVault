# Requirements Document

## Introduction

重构 cNFT Merkle Tree 创建流程，将复杂的链上交易构建逻辑从前端移至后端，简化前端职责为配置选择和钱包支付。使用 `@solana/spl-account-compression` 和 `@solana/web3.js` 在后端构建和发送交易，前端仅负责签名授权。

**安全要求**：树的私钥从生成到存储全程在后端处理，使用 `.env` 中的 `ENCRYPTION_KEY` 进行 AES-256-GCM 加密，私钥永不暴露到前端。

**组件结构**：创建树弹窗组件放置在 `app/components/admin/mm/solana/` 目录下，便于管理。

## Glossary

- **Merkle_Tree**: Solana 上用于存储压缩 NFT 的数据结构，由 SPL Account Compression 程序管理
- **cNFT**: Compressed NFT，压缩 NFT，存储在 Merkle Tree 中的低成本 NFT
- **Tree_Config**: 树配置参数，包括 maxDepth、maxBufferSize、canopyDepth
- **RPC_Endpoint**: Solana 网络的 RPC 服务端点，用于与链上交互
- **Payer**: 支付交易费用和租金的钱包地址
- **Tree_Authority**: 树的管理权限地址，用于后续铸造 cNFT（私钥加密存储在后端）
- **Rent_Exemption**: Solana 账户免租金所需的最低 lamports 数量
- **Frontend**: Vue/Nuxt 前端应用
- **Backend**: Nuxt Server API 后端服务
- **ENCRYPTION_KEY**: `.env` 中配置的加密密钥，用于加密树私钥

## Requirements

### Requirement 1: 树配置预估

**User Story:** As a 管理员, I want to 查看不同树配置的容量和费用预估, so that I can 选择合适的配置创建 Merkle Tree。

#### Acceptance Criteria

1. WHEN 管理员打开创建树弹窗 THEN THE Backend SHALL 返回预设配置列表，包含容量、租金预估
2. THE Backend SHALL 提供小型(1K)、中型(16K)、大型(1M)、超大型(1B) 四种预设配置
3. WHEN 管理员选择预设配置 THEN THE Frontend SHALL 显示对应的 maxDepth、maxBufferSize、canopyDepth 参数
4. THE Backend SHALL 使用 RPC 获取精确租金，若 RPC 不可用则使用离线估算值
5. WHEN 返回估算值时 THEN THE Backend SHALL 标记 isEstimate=true 提示用户

### Requirement 2: 创建树请求发起

**User Story:** As a 管理员, I want to 发起创建树请求并使用钱包支付, so that I can 在链上创建 Merkle Tree。

#### Acceptance Criteria

1. WHEN 管理员点击创建按钮 THEN THE Frontend SHALL 验证钱包已连接且配置参数完整
2. WHEN 验证通过 THEN THE Frontend SHALL 调用后端 API 发起创建请求，传递树名称、配置参数、支付者地址、网络类型
3. IF 钱包未连接 THEN THE Frontend SHALL 提示用户先连接钱包
4. IF 配置参数不完整 THEN THE Frontend SHALL 阻止提交并提示缺少的参数

### Requirement 3: 后端构建交易

**User Story:** As a 系统, I want to 在后端构建 Merkle Tree 创建交易, so that 前端无需处理复杂的链上指令构建，且私钥安全不暴露。

#### Acceptance Criteria

1. WHEN Backend 收到创建请求 THEN THE Backend SHALL 使用 @solana/spl-account-compression 构建 createTree 指令
2. THE Backend SHALL 在服务端生成新的 Keypair 作为树账户，私钥不传输到前端
3. THE Backend SHALL 计算账户所需空间并获取租金
4. THE Backend SHALL 构建包含 createAccount 和 createTree 指令的交易
5. THE Backend SHALL 使用树 Keypair 对交易进行部分签名
6. THE Backend SHALL 返回序列化的交易（Base64）供前端钱包签名，不包含私钥信息
7. THE Backend SHALL 使用 ENCRYPTION_KEY 加密树私钥后临时存储，等待交易确认后持久化

### Requirement 4: 前端钱包签名

**User Story:** As a 管理员, I want to 使用钱包签名交易, so that I can 授权支付租金费用。

#### Acceptance Criteria

1. WHEN Frontend 收到序列化交易 THEN THE Frontend SHALL 调用 Phantom 钱包的 signTransaction 方法
2. WHEN 用户在钱包中确认 THEN THE Frontend SHALL 获取签名后的交易
3. THE Frontend SHALL 将签名后的交易发送回后端
4. IF 用户拒绝签名 THEN THE Frontend SHALL 显示取消提示并重置状态
5. WHILE 等待用户签名 THEN THE Frontend SHALL 显示"请在钱包中确认交易"提示

### Requirement 5: 后端发送交易

**User Story:** As a 系统, I want to 在后端发送已签名的交易到链上, so that 可以统一管理交易发送和确认。

#### Acceptance Criteria

1. WHEN Backend 收到签名后的交易 THEN THE Backend SHALL 反序列化并验证签名完整性
2. THE Backend SHALL 使用配置的 RPC 端点发送交易
3. THE Backend SHALL 等待交易确认（confirmed 级别）
4. WHEN 交易确认成功 THEN THE Backend SHALL 将树信息保存到数据库，状态设为正常(1)
5. IF 交易发送失败 THEN THE Backend SHALL 返回错误信息，不保存数据库记录
6. IF 交易确认超时 THEN THE Backend SHALL 保存记录，状态设为创建中(0)，支持后续验证

### Requirement 6: 树信息持久化

**User Story:** As a 系统, I want to 将创建成功的树信息保存到数据库, so that 可以管理和使用这些树。

#### Acceptance Criteria

1. THE Backend SHALL 保存树地址、树权限地址、加密私钥、创建者地址到 MerkleTree 表
2. THE Backend SHALL 保存配置参数 maxDepth、maxBufferSize、canopyDepth
3. THE Backend SHALL 计算并保存最大容量 maxCapacity = 2^maxDepth
4. THE Backend SHALL 保存交易签名 txSignature
5. THE Backend SHALL 设置优先级 priority 为当前最大值+1
6. THE Backend SHALL 使用 ENCRYPTION_KEY 通过 AES-256-GCM 加密树权限私钥后存储到 encryptedKey 字段
7. THE Backend SHALL 确保私钥加密存储后，原始私钥从内存中清除

### Requirement 7: 组件结构

**User Story:** As a 开发者, I want to 将创建树弹窗组件放在独立目录, so that 代码结构清晰便于维护。

#### Acceptance Criteria

1. THE Frontend SHALL 将创建树弹窗组件放置在 app/components/admin/mm/solana/ 目录下
2. THE Frontend SHALL 创建 CreateTreeDialog.vue 组件处理树创建流程
3. THE Frontend SHALL 在 index.vue 页面中引用该组件
4. THE Frontend SHALL 通过 v-model 控制弹窗显示状态
5. THE Frontend SHALL 通过 emit 事件通知父组件创建成功

### Requirement 8: 树状态验证

**User Story:** As a 管理员, I want to 验证创建中的树是否已成功上链, so that I can 确认树可用或处理失败情况。

#### Acceptance Criteria

1. WHEN 管理员点击验证按钮 THEN THE Backend SHALL 查询交易签名状态
2. IF 交易已确认且成功 THEN THE Backend SHALL 更新树状态为正常(1)
3. IF 交易已确认但失败 THEN THE Backend SHALL 更新树状态为失败(-1)
4. IF 交易未找到 THEN THE Backend SHALL 检查树账户是否存在
5. IF 树账户存在 THEN THE Backend SHALL 更新状态为正常(1)

### Requirement 9: 树列表管理

**User Story:** As a 管理员, I want to 查看和管理已创建的 Merkle Tree, so that I can 监控系统容量和状态。

#### Acceptance Criteria

1. THE Frontend SHALL 显示树列表，包含名称、容量使用、配置、状态、地址
2. THE Frontend SHALL 显示系统容量统计：可用树数量、总容量、已铸造、剩余容量、使用率
3. WHEN 剩余容量不足 THEN THE Frontend SHALL 显示警告提示创建新树
4. THE Frontend SHALL 支持按网络类型筛选树列表
5. WHEN 树状态为创建中或失败 THEN THE Frontend SHALL 显示验证和删除按钮

### Requirement 10: 错误处理

**User Story:** As a 管理员, I want to 在创建失败时获得清晰的错误提示, so that I can 了解问题并采取措施。

#### Acceptance Criteria

1. IF RPC 连接失败 THEN THE Backend SHALL 返回"网络连接失败，请稍后重试"
2. IF 余额不足 THEN THE Backend SHALL 返回"钱包余额不足，需要约 X SOL"
3. IF 交易构建失败 THEN THE Backend SHALL 返回具体错误原因
4. IF 签名验证失败 THEN THE Backend SHALL 返回"交易签名无效"
5. THE Frontend SHALL 在弹窗中显示错误信息，允许用户重试

### Requirement 11: 网络切换

**User Story:** As a 管理员, I want to 切换 Solana 网络（主网/测试网）, so that I can 在不同环境下管理树。

#### Acceptance Criteria

1. THE Frontend SHALL 提供主网/测试网切换按钮
2. WHEN 切换到主网 THEN THE Frontend SHALL 显示确认弹窗警告真实 SOL 消耗
3. THE Backend SHALL 根据网络类型使用对应的 RPC 端点
4. THE Backend SHALL 将网络配置保存到 SystemConfig 表
5. WHEN 网络切换后 THEN THE Frontend SHALL 刷新树列表显示对应网络的树
