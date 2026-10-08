/**
 * @file content-access.ts
 * @project SlothVault
 * @module Content Access Contracts
 * @description Shares independent membership and project capability contracts between readers and administration.
 * @logic Represent each capability by a mode and an explicit list of membership identities.
 * @dependencies none
 * @index_tags permissions,membership,project,read,download,contracts
 * @author holic512
 */
export type ReadAccessMode = 'PUBLIC' | 'LOGIN' | 'MEMBERSHIPS'
export type DownloadAccessMode = 'FOLLOW_READ' | 'LOGIN' | 'MEMBERSHIPS' | 'DISABLED'
export type AccessMembership = { id: string; name: string; status: number }
export type AccessRule<Mode extends string = ReadAccessMode | DownloadAccessMode> = {
  mode: Mode
  membershipLevelIds: string[]
  membershipLevels: AccessMembership[]
}
export type AccessViewer = { userId: number; role: string } | null
export type AccessReason = 'LOGIN_REQUIRED' | 'MEMBERSHIP_REQUIRED' | 'DOWNLOAD_DISABLED' | null
export type ProjectAccess = {
  readAccess: AccessRule<ReadAccessMode>
  downloadAccess: AccessRule<DownloadAccessMode>
  canRead: boolean
  canDownload: boolean
  readReason: AccessReason
  downloadReason: AccessReason
  viewerAuthenticated: boolean
}

export function evaluateProjectAccess(
  policy: Pick<ProjectAccess, 'readAccess' | 'downloadAccess'>,
  viewerAuthenticated: boolean,
  membershipIds: readonly string[],
  administrator = false,
): ProjectAccess {
  const matches = (rule: AccessRule) => rule.membershipLevelIds.some((id) => membershipIds.includes(id))
  const canRead = administrator || policy.readAccess.mode === 'PUBLIC' ||
    (viewerAuthenticated && (policy.readAccess.mode === 'LOGIN' || matches(policy.readAccess)))
  const readReason: AccessReason = canRead ? null : viewerAuthenticated ? 'MEMBERSHIP_REQUIRED' : 'LOGIN_REQUIRED'
  const downloadAllowed = policy.downloadAccess.mode === 'FOLLOW_READ' ||
    (policy.downloadAccess.mode === 'LOGIN' && viewerAuthenticated) ||
    (policy.downloadAccess.mode === 'MEMBERSHIPS' && viewerAuthenticated && matches(policy.downloadAccess))
  const canDownload = administrator || (canRead && downloadAllowed)
  const downloadReason: AccessReason = canDownload ? null :
    policy.downloadAccess.mode === 'DISABLED' ? 'DOWNLOAD_DISABLED' :
      !canRead ? readReason : !viewerAuthenticated ? 'LOGIN_REQUIRED' : 'MEMBERSHIP_REQUIRED'
  return { ...policy, canRead, canDownload, readReason, downloadReason, viewerAuthenticated }
}
