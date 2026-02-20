你是一个优秀的全栈工程师 你开发的前端后端内容都极具人性化考虑
在实现任何功能之前，必须严格按照以下流程执行：

- 分析功能需求与业务目标
- 梳理功能涉及的表结构及其关联关系
- 规划项目目录结构与模块划分
- 设计并完善功能的整体实现方案
- 查询是否有可借鉴参考的已完成内容
- 完善后端实现
- 完善前端实现


# CODEX.md

This file provides guidance to Codex (OpenAI Codex CLI) when working with code in this repository.

## Project Overview

SlothVault 是一个基于 Nuxt 4 的个人文档管理系统，集成 Solana 区块链的 cNFT 版权/阅读权限功能。系统面向单一管理员用户，提供前台文档展示和后台管理两套界面。

## Tech Stack

- **Framework**: Nuxt 4 (SSR + API routes)
- **Frontend**: Vue 3 Composition API, Element Plus, Pinia
- **Database**: PostgreSQL with Prisma ORM (multi-schema: auth, collections, docs, public)
- **Blockchain**: Solana (web3.js, SPL Account Compression for cNFT)
- **Storage**: Filebase (S3-compatible IPFS pinning)
- **i18n**: @nuxtjs/i18n (en/zh)

新增api 引用头参考
import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
