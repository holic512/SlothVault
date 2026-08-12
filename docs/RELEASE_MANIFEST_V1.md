# SlothVault Release Manifest v1

项目版本发布哈希是 canonical manifest UTF-8 原始字节的 SHA-256 小写十六进制摘要。它用于复算版本身份和逻辑文档完整性，不是数字签名，也不证明发布者身份或外部时间。

字段顺序固定为 `schema`、`releaseId`、`version`、`categories`。对象内字段沿用该规范给出的顺序；使用 `JSON.stringify`，不缩进、不追加换行，显式保留 `null`，不归一化 Unicode、空白或 CRLF。

排序先按 `weight` 降序，再按名称或标题的 UTF-8 字节升序，再按节点 canonical bytes 的 SHA-256 与原始 canonical bytes 升序。数据库 ID 不参与 manifest。

## 公开测试向量

以下 JSON 是单行 canonical bytes 的可读展示（字符串中的 `\r\n`、引号转义均属于 JSON 字节）。为便于人类阅读，下方 Markdown 代码块在 JSON 后带有一个展示换行；该换行不参与摘要：

```json
{"schema":1,"releaseId":"550e8400-e29b-41d4-a716-446655440000","version":{"label":"版本 \"一\"","description":null,"weight":12},"categories":[{"name":"相同","weight":7,"status":1,"notes":[{"title":"文档","weight":5,"status":1,"content":{"versionNote":"v2","status":1,"markdown":"不同正文"}}]},{"name":"相同","weight":7,"status":1,"notes":[{"title":"文档","weight":5,"status":1,"content":{"versionNote":null,"status":1,"markdown":"第一行\r\n第二行 \"值\""}}]}]}
```

SHA-256：`95a06a80cb76af8e3cb0206718b133d1496300b3feb78434fb195bff9a1aacd6`。仓库中的 `project-version-release.test.ts` 会固定复算该值，以避免实现漂移。向量同时覆盖中文、引号、空值、CRLF、同权重和重复名称节点。

未删除且启用的分类、文档以及每篇文档唯一的未删除主正文参与摘要。项目名称、作者、数据库 ID、时间戳、项目版本运营可见状态、禁用/删除节点和附件二进制不参与；Markdown 内的附件 URL 仍作为正文原文参与。
