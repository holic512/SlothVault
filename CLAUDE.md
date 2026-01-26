# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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