# Implementation Plan: cNFT Merkle Tree 创建流程重构

## Overview

重构 cNFT Merkle Tree 创建流程，将交易构建逻辑移至后端，前端仅负责钱包签名。使用 TypeScript 实现，依赖 `@solana/spl-account-compression` 和 `@solana/web3.js`。

## Tasks

- [x] 1. 扩展后端 Solana 工具函数
  - [x] 1.1 实现 calculateTreeSpace 函数计算 Merkle Tree 账户空间
    - 根据 maxDepth、maxBufferSize、canopyDepth 计算所需字节数
    - 参考 SPL Account Compression 的空间计算公式
    - _Requirements: 3.3_
  - [ ]* 1.2 编写 calculateTreeSpace 属性测试
    - **Property 5: 空间计算公式正确性**
    - **Validates: Requirements 3.3**
  - [x] 1.3 实现 buildCreateTreeTransaction 函数构建创建树交易
    - 使用 createAllocTreeIx 分配账户空间
    - 使用 createInitEmptyMerkleTreeIx 初始化树
    - 返回交易和租金信息
    - _Requirements: 3.1, 3.4_

- [x] 2. 实现会话存储模块
  - [x] 2.1 创建 server/utils/treeSession.ts 会话管理模块
    - 使用内存 Map 存储会话
    - 实现 createSession、getSession、deleteSession 函数
    - 实现会话过期清理机制（5分钟过期）
    - _Requirements: 3.7_
  - [ ]* 2.2 编写会话管理单元测试
    - 测试会话创建、获取、删除
    - 测试过期清理逻辑

- [x] 3. 重构预估配置 API
  - [x] 3.1 更新 server/api/admin/solana/tree/estimate.post.ts
    - 使用新的 calculateTreeSpace 函数
    - 确保返回完整的预设配置信息
    - _Requirements: 1.1, 1.2, 1.4, 1.5_
  - [ ]* 3.2 编写预估 API 属性测试
    - **Property 4: 预设配置完整性**
    - **Validates: Requirements 1.1, 1.2**

- [x] 4. 实现准备交易 API
  - [x] 4.1 创建 server/api/admin/solana/tree/prepare.post.ts
    - 验证请求参数
    - 生成树 Keypair
    - 构建交易并部分签名
    - 加密私钥并创建会话
    - 返回序列化交易（不含私钥）
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  - [ ]* 4.2 编写 prepare API 属性测试
    - **Property 3: API 返回不包含私钥**
    - **Validates: Requirements 3.2, 3.6**

- [x] 5. 实现提交交易 API
  - [x] 5.1 创建 server/api/admin/solana/tree/submit.post.ts
    - 验证会话有效性
    - 反序列化并验证交易签名
    - 发送交易到链上
    - 等待确认并保存数据库记录
    - 清理会话
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [ ]* 5.2 编写 submit API 单元测试
    - 测试会话验证逻辑
    - 测试错误处理

- [x] 6. Checkpoint - 后端 API 完成
  - 确保所有后端 API 可用
  - 确保加密解密逻辑正确
  - 确保会话管理正常工作

- [x] 7. 实现数据持久化逻辑
  - [x] 7.1 更新数据库保存逻辑
    - 确保所有必要字段保存
    - 实现优先级递增逻辑
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [ ]* 7.2 编写数据持久化属性测试
    - **Property 1: 容量计算正确性**
    - **Property 6: 数据库记录完整性**
    - **Property 7: 优先级递增**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**

- [x] 8. 创建前端创建树弹窗组件
  - [x] 8.1 创建 app/components/admin/mm/solana/CreateTreeDialog.vue
    - 实现配置选择界面
    - 实现步骤指示器（config → signing → confirming → done）
    - 实现预设卡片选择
    - 实现错误显示
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 1.3_
  - [x] 8.2 实现钱包签名流程
    - 调用 prepare API 获取交易
    - 调用 Phantom signTransaction
    - 调用 submit API 提交交易
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 9. 重构主页面
  - [x] 9.1 更新 app/pages/admin/mm/solana/index.vue
    - 移除旧的创建逻辑
    - 引入 CreateTreeDialog 组件
    - 保留树列表和统计功能
    - _Requirements: 7.3, 9.1, 9.2_
  - [x] 9.2 实现条件渲染逻辑
    - 容量警告显示
    - 验证/删除按钮显示
    - _Requirements: 9.3, 9.5_

- [x] 10. Checkpoint - 前端组件完成
  - 确保弹窗组件正常工作
  - 确保与后端 API 正确交互
  - 确保错误处理正确

- [x] 11. 实现错误处理
  - [x] 11.1 完善后端错误处理
    - RPC 连接失败处理
    - 余额不足检测
    - 会话过期处理
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [x] 11.2 完善前端错误显示
    - 在弹窗中显示错误信息
    - 支持重试操作
    - _Requirements: 10.5_

- [x] 12. 清理旧代码
  - [x] 12.1 移除前端中的 Solana 指令构建代码
    - 删除 createBubblegumCreateTreeInstruction 函数
    - 删除 createInitEmptyMerkleTreeInstruction 函数
    - 删除 calculateMerkleTreeSpace 函数
    - 删除 createAllocTreeInstruction 函数
  - [x] 12.2 移除旧的 save.post.ts API（如果不再需要）

- [ ] 13. Final Checkpoint - 完整测试
  - 在 devnet 上测试完整创建流程
  - 验证数据库记录正确
  - 验证树状态验证功能
  - 确保所有测试通过

## Notes

- 任务标记 `*` 为可选测试任务，可跳过以加快 MVP 开发
- 每个任务引用具体需求以保证可追溯性
- Checkpoint 任务用于阶段性验证
- 属性测试验证通用正确性属性
- 单元测试验证具体示例和边界情况
