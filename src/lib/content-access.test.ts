import { describe, expect, it } from 'vitest'
import { evaluateProjectAccess, type AccessRule, type DownloadAccessMode, type ReadAccessMode } from './content-access'

const rule = <T extends ReadAccessMode | DownloadAccessMode>(mode: T, ids: string[] = []): AccessRule<T> => ({ mode, membershipLevelIds: ids, membershipLevels: ids.map(id => ({ id, name: id, status: 1 })) })
const policy = { readAccess: rule('MEMBERSHIPS', ['A', 'B', 'C']), downloadAccess: rule('MEMBERSHIPS', ['C']) }
describe('independent project capabilities', () => {
  it.each([
    [false, [], false, false], [true, [], false, false],
    [true, ['A'], true, false], [true, ['B'], true, false],
    [true, ['C'], true, true], [true, ['A', 'C'], true, true],
    [true, ['D'], false, false],
  ] as const)('matches explicit membership types (%s, %j)', (loggedIn, ids, read, download) => {
    expect(evaluateProjectAccess(policy, loggedIn, ids)).toMatchObject({ canRead: read, canDownload: download })
  })
  it('requires reading even when the download list matches', () => {
    expect(evaluateProjectAccess({ ...policy, readAccess: rule('MEMBERSHIPS', ['A']) }, true, ['C'])).toMatchObject({ canRead: false, canDownload: false, downloadReason: 'MEMBERSHIP_REQUIRED' })
  })
  it('supports public, login and disabled policies without disabling reading', () => {
    expect(evaluateProjectAccess({ readAccess: rule('PUBLIC'), downloadAccess: rule('FOLLOW_READ') }, false, [])).toMatchObject({ canRead: true, canDownload: true })
    expect(evaluateProjectAccess({ readAccess: rule('PUBLIC'), downloadAccess: rule('LOGIN') }, false, [])).toMatchObject({ canRead: true, canDownload: false, downloadReason: 'LOGIN_REQUIRED' })
    expect(evaluateProjectAccess({ readAccess: rule('LOGIN'), downloadAccess: rule('FOLLOW_READ') }, true, [])).toMatchObject({ canRead: true, canDownload: true })
    expect(evaluateProjectAccess({ ...policy, downloadAccess: rule('DISABLED') }, true, ['A'])).toMatchObject({ canRead: true, canDownload: false, downloadReason: 'DOWNLOAD_DISABLED' })
  })
  it('retains administrator access when downloading is closed', () => {
    expect(evaluateProjectAccess({ ...policy, downloadAccess: rule('DISABLED') }, true, [], true)).toMatchObject({ canRead: true, canDownload: true })
  })
})
