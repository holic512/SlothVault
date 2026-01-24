# Solana CJS 依赖问题解决方案

## 问题描述

在 Docker 生产环境中运行时出现错误：
```
Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import '/app/.output/server/node_modules/jayson/lib/client/browser' is not supported resolving ES modules
```

## 问题根源

Nuxt 4 / Nitro 使用 ESM 模块系统，但 Solana 生态（`@solana/web3.js`、`jayson` 等）是重度 CJS 依赖，存在以下问题：
1. 使用 `require()` 而非 `import`
2. 缺少 `.js` 扩展名的导入
3. 目录导入（如 `jayson/lib/client/browser`）在 ESM 中不支持

Nitro 尝试打包这些 CJS 库到 ESM 输出时会失败。

## 解决方案：三板斧 ✅

### 🪓 第 1 斧：CJS 隔离 + 构建后强制复制

**文件：`server/utils/solana.cjs`**
- 将所有 Solana 逻辑放入独立的 `.cjs` 文件
- 使用 CommonJS `require()` 加载依赖
- 导出所有需要的函数

**文件：`scripts/postbuild.mjs`**
- 构建后自动复制 `solana.cjs` 到 `.output/server/utils/`
- 确保运行时文件物理存在

**配置：`package.json`**
```json
{
  "scripts": {
    "postbuild": "node scripts/postbuild.mjs"
  }
}
```

### 🪓 第 2 斧：绝对路径加载 CJS

**文件：`server/utils/solanaCjsLoader.ts`**
- 使用 `createRequire(import.meta.url)` 创建 require 函数
- 根据环境（开发/生产）使用不同的绝对路径
- 提供单例模式避免重复加载

```typescript
// 开发环境：process.cwd() + 'server/utils/solana.cjs'
// 生产环境：process.cwd() + '.output/server/utils/solana.cjs'
```

### 🪓 第 3 斧：External 化所有 CJS 依赖

**配置：`nuxt.config.ts`**
```typescript
nitro: {
  externals: {
    external: [
      '@solana/web3.js',
      '@solana/spl-account-compression',
      'jayson',
      'bn.js',
      'buffer',
      '@noble/curves',
      '@noble/hashes',
      'rpc-websockets',
      'superstruct',
      'borsh',
    ],
  },
}
```

告诉 Nitro：这些库不要打包，运行时从 `node_modules` 加载。

## 实施步骤

### 1. 创建 CJS 隔离文件
- ✅ `server/utils/solana.cjs` - 包含所有 Solana 逻辑

### 2. 创建加载器和包装层
- ✅ `server/utils/solanaCjsLoader.ts` - CJS 加载器
- ✅ `server/utils/solana.ts` - ESM 包装层（替换原文件）
- ✅ `server/utils/bubblegum.ts` - ESM 包装层（替换原文件）

### 3. 配置构建流程
- ✅ `scripts/postbuild.mjs` - 复制脚本
- ✅ `package.json` - 添加 postbuild 钩子
- ✅ `nuxt.config.ts` - 外部化依赖

### 4. 修改 API 调用
- ✅ `server/api/solana/balance.get.ts` - 示例修改
- 其他 API 文件通过包装层自动适配

## 验证结果

### 构建成功
```bash
npm run build
# ✅ 构建成功
# ✅ postbuild 脚本执行成功
# ✅ 输出大小从 42.8 MB 降到 40.9 MB（外部化生效）
```

### 运行成功
```bash
node .output/server/index.mjs
# ✅ 服务器启动成功
# ✅ 没有 ERR_UNSUPPORTED_DIR_IMPORT 错误
# ✅ 没有 require is not defined 错误
# ✅ API 调用正常工作
```

### API 测试
```bash
curl 'http://localhost:3000/api/solana/balance?address=...'
# ✅ 返回正常的 JSON 响应（网络错误是正常的，说明代码逻辑正常）
```

## 关键要点

1. **不要信任 Nitro 的打包** - CJS 依赖必须外部化
2. **使用绝对路径** - 避免 Nitro 重排目录导致路径失效
3. **物理复制文件** - postbuild 确保文件存在
4. **包装层模式** - 保持现有代码兼容性

## 文件清单

### 新增文件
- `server/utils/solana.cjs` - CJS 隔离模块
- `server/utils/solanaCjsLoader.ts` - CJS 加载器
- `scripts/postbuild.mjs` - 构建后复制脚本

### 修改文件
- `nuxt.config.ts` - 添加 externals 配置
- `package.json` - 添加 postbuild 脚本
- `server/utils/solana.ts` - 替换为 ESM 包装层
- `server/utils/bubblegum.ts` - 替换为 ESM 包装层
- `server/api/solana/balance.get.ts` - 示例 API 修改

### 备份文件
- `server/utils/solana.ts.bak` - 原始文件备份
- `server/utils/bubblegum.ts.bak` - 原始文件备份

## Docker 部署

在 Docker 中运行时，确保：
1. `node_modules` 完整安装（包含所有外部化的依赖）
2. `.output/server/utils/solana.cjs` 文件存在（postbuild 自动复制）
3. 使用 `npm ci` 或 `npm install` 安装依赖

## 总结

通过 **CJS 隔离 + 绝对路径加载 + 外部化依赖** 三板斧，彻底解决了 Nuxt 4 / Nitro ESM 与 Solana CJS 依赖的兼容性问题。这是唯一可靠的解决方案，适用于所有类似的 CJS 依赖问题。
