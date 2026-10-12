import { describe, expect, it } from 'vitest'

import { WORKFLOW_STAGES } from '@/lib/commission-workflow'
import {
  agreementTagColors, backupStatusTagColors, contentTagColors, evidenceProofTagColors,
  getContentTagColor, getWorkflowTagColor, issueTagColors,
} from '@/theme/tag-colors'

describe('content tag identity', () => {
  it('keeps normalized names stable across order changes and supports Unicode and escaped display text', () => {
    const names = ['API', '教程', '部署指南', '<script>', '文档'.repeat(15), '']
    const colors = new Map(names.map((name) => [name, getContentTagColor(name)]))
    for (const name of names.toReversed()) {
      expect(getContentTagColor(name)).toBe(colors.get(name))
      expect(getContentTagColor(` ${name} `)).toBe(colors.get(name))
      expect(contentTagColors).toContain(colors.get(name))
    }
    expect(new Set(Array.from({ length: 50 }, (_, index) => getContentTagColor(`标签${index}`))).size).toBe(5)
  })
})

describe('workflow tag semantics', () => {
  it.each(Object.keys(WORKFLOW_STAGES) as Array<keyof typeof WORKFLOW_STAGES>)('prioritizes archive and pause over %s', (stage) => {
    expect(getWorkflowTagColor({ stage, archived: true, paused: true })).toBe('default')
    expect(getWorkflowTagColor({ stage, archived: false, paused: true })).toBe('warning')
  })

  it('distinguishes waiting, active, successful, and terminated stages', () => {
    const color = (stage: keyof typeof WORKFLOW_STAGES) => getWorkflowTagColor({ stage, archived: false, paused: false })
    for (const stage of ['DRAFT', 'REQUESTED', 'CONTRACT_PENDING', 'READY'] as const) expect(color(stage)).toBe('warning')
    for (const stage of ['ACCEPTED', 'IN_PROGRESS', 'MAINTENANCE'] as const) expect(color(stage)).toBe('processing')
    expect(color('COMPLETED')).toBe('success')
    expect(color('TERMINATED')).toBe('error')
  })

  it('keeps agreement disputes, issue retests, signing and backup queues distinct from completion', () => {
    expect(agreementTagColors.PENDING).toBe('warning')
    expect(agreementTagColors.DECLINED).toBe('error')
    expect(agreementTagColors.SUPERSEDED).toBe('default')
    expect(issueTagColors.RESOLVED).toBe('processing')
    expect(issueTagColors.CLOSED).toBe('success')
    expect(evidenceProofTagColors.PREPARED).toBe('warning')
    expect(evidenceProofTagColors.SUBMITTED).toBe('processing')
    expect(evidenceProofTagColors.FINALIZED).toBe('success')
    expect(backupStatusTagColors.queued).toBe('warning')
    expect(backupStatusTagColors.running).toBe('processing')
    expect(backupStatusTagColors.failed).toBe('error')
  })
})
