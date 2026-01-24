# 备份/恢复 API 文档

## 概述

本模块提供了完整的数据库和文件系统备份/恢复功能，用于 SlothVault 项目的数据迁移和灾难恢复。

## API 端点

### 1. 数据库导出

**端点**: `GET /api/admin/mm/backup/database-export`

**描述**: 导出所有业务数据（排除 auth schema 的用户认证数据）

**认证**: 需要管理员会话

**响应**:
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "version": "1.0.0",
    "exportedAt": "2024-01-24T10:00:00.000Z",
    "data": {
      "projects": [...],
      "projectVersions": [...],
      "categories": [...],
      "projectMenus": [...],
      "projectHomes": [...],
      "noteInfos": [...],
      "noteContents": [...],
      "fileManagements": [...],
      "systemConfigs": [...],
      "merkleTrees": [...],
      "compressedNfts": [...]
    }
  }
}
```

**导出的数据表**:
- `collections` schema: Project, ProjectVersion, Category, ProjectMenu, ProjectHome
- `docs` schema: NoteInfo, NoteContent
- `public` schema: FileManagement, SystemConfig, MerkleTree, CompressedNft

**注意**:
- 只导出未软删除的数据（`isDeleted = false`）
- BigInt 类型字段会转换为字符串以支持 JSON 序列化

---

### 2. 数据库导入

**端点**: `POST /api/admin/mm/backup/database-import`

**描述**: 导入备份的数据库数据

**认证**: 需要管理员会话

**请求体**:
```json
{
  "data": {
    "projects": [...],
    "projectVersions": [...],
    // ... 其他表数据
  },
  "mode": "insert"  // "insert" 或 "overwrite"
}
```

**模式说明**:
- `insert`: 插入模式，保留现有数据，追加新数据
- `overwrite`: 覆盖模式，先清空所有业务数据，再导入

**响应**:
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "Database import completed successfully",
    "mode": "insert",
    "imported": {
      "projects": 5,
      "projectVersions": 10,
      "categories": 20,
      // ... 其他表的导入数量
    }
  }
}
```

**导入逻辑**:
1. 按依赖顺序导入数据（父表 -> 子表）
2. 自动处理 ID 映射（旧 ID -> 新 ID）
3. 处理外键关系和自引用关系（如 ProjectMenu 的父子关系）
4. 对于唯一约束字段（如 SystemConfig.configKey, MerkleTree.treeAddress），会检查是否已存在并更新或跳过

---

### 3. 文件导出

**端点**: `GET /api/admin/mm/backup/files-export`

**描述**: 导出 `public/uploads` 目录下的所有文件为 ZIP 压缩包

**认证**: 需要管理员会话

**响应**:
- Content-Type: `application/zip`
- Content-Disposition: `attachment; filename="uploads-backup-{timestamp}.zip"`
- 直接返回 ZIP 文件流

**导出内容**:
- `public/uploads/avatar/` - 用户头像
- `public/uploads/markdown/` - Markdown 图片
- `public/uploads/other/` - 其他文件
- `public/uploads/project-avatar/` - 项目头像

---

### 4. 文件导入

**端点**: `POST /api/admin/mm/backup/files-import`

**描述**: 导入 ZIP 压缩包到 `public/uploads` 目录

**认证**: 需要管理员会话

**请求**: `multipart/form-data`
- `file`: ZIP 文件
- `mode`: 导入模式（"insert" 或 "overwrite"）

**模式说明**:
- `insert`: 插入模式，保留现有文件，追加新文件（同名文件会被覆盖）
- `overwrite`: 覆盖模式，先清空 uploads 目录，再解压文件

**响应**:
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "Files import completed successfully",
    "mode": "insert",
    "filesImported": 150
  }
}
```

---

### 5. 系统初始化（重置）

**端点**: `POST /api/admin/mm/backup/system-reset`

**描述**: 清空所有业务数据和文件，将系统恢复到初始状态（保留 auth schema 的用户数据）

**认证**: 需要管理员会话

**请求体**:
```json
{
  "confirm": "RESET_ALL_DATA",
  "clearDatabase": true,
  "clearFiles": true
}
```

**参数说明**:
- `confirm`: 必须为 `"RESET_ALL_DATA"` 字符串，作为安全确认
- `clearDatabase`: 是否清空数据库（默认 true）
- `clearFiles`: 是否清空文件系统（默认 true）

**响应**:
```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "message": "System reset completed successfully",
    "database": {
      "success": true,
      "deleted": {
        "compressedNfts": 10,
        "merkleTrees": 2,
        "noteContents": 50,
        "noteInfos": 30,
        "categories": 15,
        "projectVersions": 8,
        "projectMenus": 20,
        "projectHomes": 5,
        "projects": 5,
        "fileManagements": 100,
        "systemConfigs": 10
      },
      "totalDeleted": 255
    },
    "files": {
      "success": true,
      "filesDeleted": 150,
      "dirsDeleted": 4,
      "standardDirsRecreated": ["avatar", "markdown", "other", "project-avatar"]
    }
  }
}
```

**操作内容**:
1. **数据库清空**:
   - 删除所有业务表的数据（按依赖顺序）
   - 保留 `auth` schema（User, Session）
   - 返回每个表的删除数量

2. **文件系统清空**:
   - 删除 `public/uploads` 下所有子目录和文件
   - 重新创建标准目录结构：`avatar`, `markdown`, `other`, `project-avatar`
   - 返回删除的文件和目录数量

**安全机制**:
- 必须提供正确的确认码 `"RESET_ALL_DATA"`
- 如果确认码错误，返回 400 错误
- 操作不可逆，请谨慎使用

**使用场景**:
- 开发/测试环境重置
- 清除所有测试数据
- 系统初始化准备

⚠️ **警告**: 此操作会永久删除所有业务数据和文件，且不可恢复！建议在执行前先进行完整备份。

---

## 使用示例

### 完整备份流程

```javascript
// 1. 导出数据库
const dbResponse = await fetch('/api/admin/mm/backup/database-export', {
  headers: {
    'Cookie': 'session=...'
  }
})
const dbBackup = await dbResponse.json()

// 保存到本地文件
const dbBlob = new Blob([JSON.stringify(dbBackup.data, null, 2)], {
  type: 'application/json'
})
const dbUrl = URL.createObjectURL(dbBlob)
const dbLink = document.createElement('a')
dbLink.href = dbUrl
dbLink.download = `database-backup-${Date.now()}.json`
dbLink.click()

// 2. 导出文件
const filesResponse = await fetch('/api/admin/mm/backup/files-export', {
  headers: {
    'Cookie': 'session=...'
  }
})
const filesBlob = await filesResponse.blob()
const filesUrl = URL.createObjectURL(filesBlob)
const filesLink = document.createElement('a')
filesLink.href = filesUrl
filesLink.download = `uploads-backup-${Date.now()}.zip`
filesLink.click()
```

### 完整恢复流程

```javascript
// 1. 导入数据库（覆盖模式）
const dbFile = // ... 从文件选择器获取 JSON 文件
const dbData = JSON.parse(await dbFile.text())

await fetch('/api/admin/mm/backup/database-import', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': 'session=...'
  },
  body: JSON.stringify({
    data: dbData.data,
    mode: 'overwrite'
  })
})

// 2. 导入文件（覆盖模式）
const zipFile = // ... 从文件选择器获取 ZIP 文件
const formData = new FormData()
formData.append('file', zipFile)
formData.append('mode', 'overwrite')

await fetch('/api/admin/mm/backup/files-import', {
  method: 'POST',
  headers: {
    'Cookie': 'session=...'
  },
  body: formData
})
```

### 系统初始化流程

```javascript
// 重置整个系统（数据库 + 文件）
const response = await fetch('/api/admin/mm/backup/system-reset', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': 'session=...'
  },
  body: JSON.stringify({
    confirm: 'RESET_ALL_DATA',
    clearDatabase: true,
    clearFiles: true
  })
})

const result = await response.json()
console.log('Reset result:', result.data)

// 只清空数据库，保留文件
await fetch('/api/admin/mm/backup/system-reset', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': 'session=...'
  },
  body: JSON.stringify({
    confirm: 'RESET_ALL_DATA',
    clearDatabase: true,
    clearFiles: false
  })
})

// 只清空文件，保留数据库
await fetch('/api/admin/mm/backup/system-reset', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': 'session=...'
  },
  body: JSON.stringify({
    confirm: 'RESET_ALL_DATA',
    clearDatabase: false,
    clearFiles: true
  })
})
```

---

## 注意事项

1. **认证要求**: 所有 API 都需要管理员会话认证
2. **数据一致性**: 建议先导入数据库，再导入文件，以确保 FileManagement 表与实际文件对应
3. **覆盖模式风险**: 使用 `overwrite` 模式会删除所有现有数据，请谨慎使用
4. **系统重置风险**: `system-reset` API 会永久删除所有业务数据，必须提供确认码 `"RESET_ALL_DATA"`
5. **大文件处理**: 文件导出使用流式传输，支持大文件压缩
6. **ID 映射**: 导入时会自动重新分配 ID，并维护所有外键关系
7. **唯一约束**: 对于有唯一约束的字段（如 configKey, treeAddress, assetId），导入时会检查并处理冲突
8. **软删除数据**: 导出时不包含已软删除的数据（`isDeleted = true`）
9. **用户数据**: 不包含 `auth` schema 的用户和会话数据，需要单独管理
10. **备份建议**: 在执行系统重置前，强烈建议先执行完整备份

---

## 依赖包

- `archiver`: ZIP 压缩
- `unzipper`: ZIP 解压

安装命令:
```bash
npm install archiver unzipper
npm install -D @types/archiver @types/unzipper

```
