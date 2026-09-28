/**
 * @file content-manifest-upgrade.ts
 * @project SlothVault
 * @module Database Content Upgrade
 * @description Rehashes unsigned legacy releases before marking the database ready for manifest v2.
 * @logic Reject submitted evidence, validate every legacy tree, then atomically update digests and expire unsigned preparations without changing publication identity or dates.
 * @dependencies AppPrismaClient, release-manifest
 * @index_tags migration,manifest,sha256,evidence
 * @author holic512
 */
import type { AppPrismaClient } from './client'
import { buildNoteMarkdownManifest, buildReleaseManifest, RELEASE_MANIFEST_VERSION } from '../services/release-manifest'

export async function upgradeContentManifests(client: AppPrismaClient) {
  return client.$transaction(async (tx) => {
    const versions = await tx.projectVersion.findMany({
      where: { publishedAt: { not: null }, OR: [{ manifestVersion: null }, { manifestVersion: { not: RELEASE_MANIFEST_VERSION } }] },
      include: { project: true, categories: { include: { noteInfos: { include: { contents: true } } } } },
    })
    if (!versions.length) return { updated: 0 }
    const ids = versions.map((version) => version.id)
    const signed = await tx.releaseCredential.findFirst({
      where: { projectVersionId: { in: ids }, OR: [
        { transactionSignature: { not: null } },
        { attempts: { some: { OR: [{ transactionSignature: { not: null } }, { submittedAt: { not: null } }] } } },
      ] }, select: { id: true },
    })
    if (signed) throw new Error(`CONTENT_MANIFEST_UPGRADE_SIGNED_EVIDENCE: credential ${signed.id}`)
    const prepared = versions.map((version) => {
      const built = buildReleaseManifest(version)
      if (!version.releaseId || !built.hash) throw new Error(`CONTENT_MANIFEST_UPGRADE_INVALID_TREE: version ${version.id}; ${built.issues.map((issue) => issue.code).join(',')}`)
      return { id: version.id, hash: built.hash }
    })
    const hashes = new Map(prepared.map(item => [item.id, item.hash]))
    const credentials = await tx.releaseCredential.findMany({
      where: { projectVersionId: { in: ids } }, include: { noteContent: { select: { content: true } } },
    })
    for (const credential of credentials) {
      const hash = credential.subjectType === 'NOTE_CONTENT'
        ? credential.noteContent && buildNoteMarkdownManifest(credential.noteContent.content).hash
        : hashes.get(credential.projectVersionId)
      if (!hash) throw new Error(`CONTENT_MANIFEST_UPGRADE_INVALID_CREDENTIAL: credential ${credential.id}`)
      const memo = JSON.parse(credential.memo) as Record<string, unknown>
      memo.manifestVersion = RELEASE_MANIFEST_VERSION
      memo[credential.subjectType === 'NOTE_CONTENT' ? 'contentHash' : 'releaseHash'] = hash
      await tx.releaseCredential.update({
        where: { id: credential.id },
        data: { subjectHash: hash, subjectManifestVersion: RELEASE_MANIFEST_VERSION, memo: JSON.stringify(memo) },
      })
    }
    // Old unsigned preparations cannot be signed after the content protocol changes.
    await tx.releaseCredentialAttempt.updateMany({
      where: { credential: { projectVersionId: { in: ids } } },
      data: { expiresAt: new Date(0), failureCode: 'MANIFEST_UPGRADED', failureMessage: 'Prepare evidence again using content manifest v2.' },
    })
    for (const item of prepared) {
      await tx.projectVersion.update({ where: { id: item.id }, data: { releaseHash: item.hash, manifestVersion: RELEASE_MANIFEST_VERSION } })
    }
    return { updated: prepared.length }
  }, { timeout: 120_000 })
}
