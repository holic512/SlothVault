# 摘要

随着数字内容规模持续增长，传统文档管理平台在内容组织、版本维护和访问控制方面面临新的挑战。单纯依赖中心化账号体系虽然能够满足基础的身份认证需求，但在跨平台授权、数字资产确权和访问凭证流转等场景下，往往存在可信边界单一、权限凭证不可携带以及资产状态难以核验等问题。针对上述问题，本文结合实际项目 SlothVault 的开发成果，设计并实现了一套基于 Solana 压缩 NFT 的文档管理系统。系统以 Nuxt 4 为全栈开发框架，以 PostgreSQL 和 Prisma 为数据管理基础，以 Markdown 文档编排为核心内容载体，在后台实现项目、版本、分类、笔记、文件和系统配置等常规内容管理能力，在前台实现项目首页和文档阅读页面的统一展示，并通过压缩 NFT、Merkle Tree 和钱包地址校验机制实现项目级阅读权限控制。

在系统设计上，本文将平台划分为内容管理、前台展示、访问鉴权、区块链资产管理、文件处理和数据备份恢复六个核心模块，构建了“链下文档内容管理 + 链上访问凭证验证”的混合架构。数据库部分采用多 schema 组织方式，将认证、内容集合、文档正文和公共配置解耦，既保证了业务边界清晰，也便于后续扩展。为降低区块链接入成本，系统选择 Solana 压缩 NFT 技术，将链上资产记录与本地项目信息进行关联，在保证访问校验可验证性的同时控制链上存储成本。实现层面，系统完成了管理员初始化与登录、项目与版本管理、分类与笔记管理、Markdown 编辑预览、项目访问验证、Merkle Tree 管理、cNFT 铸造与状态回写、数据库与文件备份恢复等关键功能。

本文在需求分析、系统设计、关键实现和测试方案层面对该系统进行了系统整理。结果表明，该方案能够在保留传统文档管理可维护性的同时，引入基于区块链资产的访问控制机制，为面向知识付费、技术文档托管和链上数字内容分发的系统提供一种可实现的工程路径。

关键词：文档管理系统；Solana；压缩 NFT；访问控制；Nuxt

# Abstract

With the continuous growth of digital content, document platforms are required to provide stronger support for content organization, version maintenance, and access control. Conventional account-centered permission models can satisfy basic authentication, but they are less effective when the system needs portable access credentials, verifiable ownership, and low-cost asset distribution across different users and projects. To address these issues, this thesis designs and implements a document management system based on Solana compressed NFTs by using the actual project SlothVault as the engineering foundation.

The system adopts Nuxt 4 as the full-stack development framework, PostgreSQL with Prisma as the persistence layer, and Markdown as the core content carrier. It provides complete management capabilities for projects, project versions, categories, notes, note contents, files, and system configuration in the administrator backend. On the frontend, it supports project home pages, document reading pages, sidebar navigation, and catalog rendering. More importantly, the platform introduces project-level access verification based on compressed NFTs. By combining wallet address detection, local asset records, and on-chain verification logic, the system builds a hybrid architecture in which document content remains manageable off-chain while access credentials are verified through blockchain-related assets.

The implementation completes administrator initialization and login, project and version management, category and note management, Markdown editing and preview, project access verification, Merkle Tree management, compressed NFT mint submission, transaction confirmation feedback, and database backup and recovery. The resulting solution demonstrates that a document platform can preserve the usability of conventional content management while extending its permission model with blockchain-based verifiable credentials.

# 第1章 绪论

## 1.1 课题背景

随着软件产品形态从单机文档逐步转向在线知识库、课程内容平台和项目化文档站点，文档系统已经不再只是静态文件仓库，而是逐渐演变成兼具内容生产、版本组织、访问控制和资源分发能力的综合平台。对于技术团队、课程组织者和内容服务提供者而言，文档平台不仅需要支持文本编辑和多级目录管理，还需要解决版本演化、访问门槛和可信授权等问题。

传统文档管理系统多以账号、角色、数据库记录为核心完成权限控制，这种模式在面向链上用户、数字权益分发和跨平台访问验证场景时存在一定局限。区块链技术的发展为这类问题提供了新的工程路径。通过链上不可篡改记录、哈希摘要和可验证资产，系统能够在不暴露文档内容本身的前提下，对访问资格进行独立核验[1-6]。

## 1.2 研究目的与意义

本课题的目标是设计并实现一套可运行的文档管理系统，使其既具备传统内容平台需要的管理能力，又能够通过区块链资产完成项目级阅读权限控制。系统需要在内容管理效率、权限控制清晰性和区块链接入成本之间取得平衡。

## 1.3 国内外研究现状

现有研究主要集中在内容管理、访问控制、分布式存储和区块链可信校验等方向。已有工作表明，链上链下混合架构更适合处理容量较大的业务数据，而 Merkle Tree 与压缩 NFT 为低成本可验证凭证提供了现实基础[5][6][11-16]。

## 1.4 研究内容

本文主要完成系统需求分析、总体设计、数据库建模、关键实现与测试方案设计，并围绕访问鉴权与区块链资产管理展开重点说明。

## 1.5 论文结构安排

本文共分为五个主体章节，分别对应绪论、需求分析、系统设计、系统实现和系统测试，最后给出结论、致谢、参考文献和附录。

# 第2章 系统需求分析

## 2.1 系统建设目标

SlothVault 的建设目标是构建一个同时具备内容组织、版本管理、访问控制和资产凭证接入能力的综合平台。系统角色包括管理员、普通访客和持证访问用户。

[此处插入图2-1 系统用户角色与业务用例图]

图2-1 系统用户角色与业务用例图

## 2.2 功能需求分析

后台主要负责认证、项目与版本管理、分类和笔记管理、正文版本管理、文件与首页管理、区块链资产管理以及备份恢复。前台主要负责项目展示、文档阅读和访问验证。

[此处插入图2-2 文档内容发布活动图]

图2-2 文档内容发布活动图

[此处插入图2-3 项目访问验证活动图]

图2-3 项目访问验证活动图

[此处插入图2-4 系统功能结构图]

图2-4 系统功能结构图

## 2.3 非功能需求分析

系统需要满足安全性、可维护性、可扩展性和易用性要求，并通过角色权限与非功能需求表进行约束。

## 2.4 业务流程分析

[此处插入图2-5 管理员初始化与登录流程图]

图2-5 管理员初始化与登录流程图

[此处插入图2-6 数据备份恢复流程图]

图2-6 数据备份恢复流程图

## 2.5 本章小结

本章明确了系统角色、功能需求、非功能需求和关键流程，为后续系统设计提供依据。

# 第3章 系统设计

## 3.1 系统总体架构设计

![系统总体架构图](figures/images/fig3-1-system-architecture.png)

图3-1 系统总体架构图

![系统部署结构图](figures/images/fig3-2-system-deployment.png)

图3-2 系统部署结构图

## 3.2 功能模块设计

![项目访问验证时序图](figures/images/fig3-3-access-verification-sequence.png)

图3-3 项目访问验证时序图

## 3.3 数据库设计

![系统核心实体关系图](figures/images/fig3-4-core-er.png)

图3-4 系统核心实体关系图

[此处插入图3-5 用户实体结构图]

图3-5 用户实体结构图

[此处插入图3-6 会话实体结构图]

图3-6 会话实体结构图

[此处插入图3-7 项目实体结构图]

图3-7 项目实体结构图

[此处插入图3-8 项目版本实体结构图]

图3-8 项目版本实体结构图

[此处插入图3-9 分类实体结构图]

图3-9 分类实体结构图

[此处插入图3-10 笔记信息实体结构图]

图3-10 笔记信息实体结构图

[此处插入图3-11 笔记内容实体结构图]

图3-11 笔记内容实体结构图

[此处插入图3-12 文件管理实体结构图]

图3-12 文件管理实体结构图

[此处插入图3-13 系统配置实体结构图]

图3-13 系统配置实体结构图

[此处插入图3-14 系统首页实体结构图]

图3-14 系统首页实体结构图

[此处插入图3-15 Merkle Tree 实体结构图]

图3-15 Merkle Tree 实体结构图

[此处插入图3-16 压缩 NFT 实体结构图]

图3-16 压缩 NFT 实体结构图

## 3.4 接口与模块协同设计

系统接口按后台管理、前台访问和 Solana 管理三个方向组织，形成“页面交互 -> 服务接口 -> 数据与链上资产”的协作路径。

## 3.5 本章小结

本章完成了总体架构、模块设计、数据库设计与接口协同设计。

# 第4章 系统实现

## 4.1 开发环境与技术实现基础

系统使用 Nuxt 4、Vue 3、Element Plus、Pinia、Prisma、PostgreSQL 与 Solana 相关依赖实现前后端一体化开发。

## 4.2 后台管理功能实现

[此处插入图4-5 管理员登录页面截图]

图4-5 管理员登录页面截图

![管理后台项目新增时序图](figures/images/fig4-2-project-create-sequence.png)

图4-2 管理后台项目新增时序图

[此处插入图4-6 项目管理页面截图]

图4-6 项目管理页面截图

[此处插入图4-7 项目版本配置页面截图]

图4-7 项目版本配置页面截图

![Markdown 编辑与预览协同结构图](figures/images/fig4-4-md-editor-component.png)

图4-4 Markdown 编辑与预览协同结构图

[此处插入图4-8 分类与笔记管理页面截图]

图4-8 分类与笔记管理页面截图

[此处插入图4-9 Markdown 内容编辑页面截图]

图4-9 Markdown 内容编辑页面截图

## 4.3 前台展示与访问控制实现

![文档阅读页加载时序图](figures/images/fig4-3-doc-reader-sequence.png)

图4-3 文档阅读页加载时序图

[此处插入图4-10 前台项目首页截图]

图4-10 前台项目首页截图

[此处插入图4-11 前台文档阅读页面截图]

图4-11 前台文档阅读页面截图

## 4.4 区块链资产管理实现

[此处插入图4-12 Solana Merkle Tree 管理页面截图]

图4-12 Solana Merkle Tree 管理页面截图

![cNFT 铸造提交流程图](figures/images/fig4-1-cnft-submit-activity.png)

图4-1 cNFT 铸造提交流程图

[此处插入图4-13 cNFT 管理页面截图]

图4-13 cNFT 管理页面截图

## 4.5 备份恢复实现

[此处插入图4-14 数据备份页面截图]

图4-14 数据备份页面截图

## 4.6 本章小结

本章完成了后台管理、前台展示、访问鉴权、区块链资产处理和备份恢复的实现说明。

# 第5章 系统测试

## 5.1 测试目标与测试环境

系统测试重点验证后台认证、项目与文档管理、前台访问控制、区块链资产管理和备份恢复等关键功能。

[此处插入图5-1 系统测试实施流程图]

图5-1 系统测试实施流程图

## 5.2 测试方法

系统采用功能测试与异常处理测试相结合的方法，对页面流程、接口参数校验和错误分支进行验证。

## 5.3 功能测试用例设计

表5-1 登录与会话测试用例表、表5-2 项目与文档管理测试用例表、表5-3 前台鉴权访问测试用例表、表5-4 区块链资产管理测试用例表、表5-5 备份恢复测试用例表和表5-6 异常处理测试用例表共同构成测试主体。

## 5.4 测试结果分析

当前代码证据表明系统已建立较明确的参数校验、会话控制和异常处理逻辑，但真实运行截图和链上执行记录仍需后续补充。

## 5.5 本章小结

本章完成测试方案与测试用例设计，并明确了后续待补的实测材料。

# 结论

本文完成了基于 Solana 压缩 NFT 的文档管理系统的需求、设计、实现和测试方案整理。系统采用链下管理内容、链上校验凭证的混合架构，兼顾了文档平台的可维护性和访问控制的可验证性。

# 致谢

感谢指导教师、同学与开源社区在本课题中的帮助。

# 参考文献

[1] Nuxt Documentation. Introduction to Nuxt 4[EB/OL]. [2026-04-28]. https://nuxt.com/docs/4.x

[2] Prisma Documentation. PostgreSQL database connector[EB/OL]. [2026-04-28]. https://docs.prisma.io/docs/orm/core-concepts/supported-databases/postgresql

[3] PostgreSQL Global Development Group. PostgreSQL Documentation[EB/OL]. [2026-04-28]. https://www.postgresql.org/docs/

[4] Vue.js Documentation. Vue 3 Guide[EB/OL]. [2026-04-28]. https://vuejs.org/guide/introduction.html

[5] Solana. Compressed NFTs[EB/OL]. [2026-04-28]. https://solana.com/developers/courses/state-compression/compressed-nfts

[6] WONG J. How to use compressed NFTs on Solana, powered by state compression[EB/OL]. 2023-04-06[2026-04-28]. https://solana.com/en/news/how-to-use-compressed-nfts-on-solana

[7] Pinia Documentation. Introduction[EB/OL]. [2026-04-28]. https://pinia.vuejs.org/

[8] Element Plus Documentation[EB/OL]. [2026-04-28]. https://element-plus.org/

[9] MD Editor V3 Documentation[EB/OL]. [2026-04-28]. https://imzbf.github.io/md-editor-v3/en-US/

[10] Filebase Documentation[EB/OL]. [2026-04-28]. https://docs.filebase.com/

[11] ALMOGHIRI M, et al. A framework of blockchain-based secure and privacy-preserving E-government system[J]. Wireless Networks, 2019.

[12] WANG X, et al. A blockchain-based secure storage scheme for medical information[J]. Journal on Wireless Communications and Networking, 2022.

[13] ZHANG Y, et al. Blockchain enabled zero trust based authentication scheme for railway communication networks[J]. Journal of Cloud Computing, 2023.

[14] WU J, et al. Consensus algorithm for maintaining large-scale access-control views of education data[J]. The Journal of Supercomputing, 2024.

[15] LIU S, et al. Blockchain-based access control and privacy preservation in healthcare: a comprehensive survey[J]. Cluster Computing, 2025.

[16] YUAN C, et al. SSX-EHRs: secure and scalable cross-domain EHRs sharing with blockchain sharding and dynamic proxy re-encryption[J]. Journal on Information Security, 2025.

# 附录

附录部分预留 1 篇正文已引用英文文献原文及对应中文译文，待后续定稿时补齐。
