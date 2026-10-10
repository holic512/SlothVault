# SlothVault 项目版本 Manifest v3

每个发布版本在同一事务中保存 releaseId、publishedAt、releaseManifestJson、releaseHash 和 manifestVersion=3。下载文件和链上 Memo 使用同一份快照；JSON 字段顺序固定为：

```json
{"schema":3,"projectName":"发布时项目名称","version":"1.0.0","contentHash":"64位小写十六进制 SHA-256"}
```

每篇主正文按 Markdown 原文 UTF-8 字节计算 SHA-256，不 trim，不转换换行，不归一化 Unicode。图片地址、附件链接属于 Markdown；文件字节不额外参与。启用且未删除的分类、笔记形成内部清单 `{"schema":3,"categories":[{"name":"分类名称","notes":[{"title":"笔记名称","hash":"正文 SHA-256"}]}]}`。笔记依次按标题和正文哈希的 UTF-8 字节排序，分类依次按名称和规范笔记清单 JSON 字节排序。保留重复项，数据库 ID、权重和查询顺序不参与。内部清单的紧凑 UTF-8 JSON 摘要为 contentHash。

releaseHash 为紧凑 Manifest 的 SHA-256。发布名称和版本号影响凭证哈希；名称及正文树影响内容哈希。发布后冻结版本号、分类名称、笔记标题、正文、节点状态和归属结构。项目名称可以改，核验使用发布快照中的名称；描述、版本说明、权重和版本可见性仍可编辑。

准备接口接收 `subject: {type: "projectVersion", projectVersionId}`，同一发布 ID、同一网络使用一份当前凭证，可以保留失败或取消的尝试。Memo 协议为 `slothvault.project-version`，包含协议版本 1、installationId、releaseId、紧凑 manifest、releaseHash、network 和 signer。签名前检查实际交易序列化后的 1232 字节限制；超限明确报错，不截断、不拆分。提交先持久化签名再广播，仅匹配的 finalized 交易可确认为已上链。

公共版本凭证摘要 API 按需读取快照、Mainnet/Devnet 状态和请求用户下载能力，不加载正文或调用 RPC。顶部版本菜单只有“查看凭证”和“下载 Manifest”；抽屉刷新读取已存状态，实时链上核验由交易回执页面的显式操作发起。链上交易匹配与站内内容完整性分别显示。所有下载路径在处理 ETag 前检查下载权限和内容完整性，摘要响应头为 releaseHash。

三种数据库 schema revision 14 新增 release_manifest_json 并删除旧内容凭证与尝试；合同及委托存证不受影响。启动、安装及生产升级不重新计算旧发布快照，旧版本不会进入 v3 公共列表。当前备份格式为 2.13.0，保存并校验 v3 快照，恢复后从文档树重算核验；旧内容凭证退出恢复流程。
