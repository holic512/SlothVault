'use client'

/**
 * @file project-access-fields.tsx
 * @project SlothVault
 * @module Project Capability Editor
 * @description Separates reading and download rules into accessible, explicit administrator controls.
 * @logic Select a mode for each capability, require explicit membership identities when applicable, and preview the effective policy.
 * @dependencies Ant Design Form, membership-level API, React Query, next-intl
 * @index_tags project,permissions,form,membership,read,download
 * @author holic512
 */
import { useQuery } from '@tanstack/react-query'
import { Form, Select, Typography } from 'antd'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'

type Membership = { id: string; name: string; status: number }
export function ProjectAccessFields() {
  const t = useTranslations('AdminMM.projects.permissions')
  const memberships = useQuery({ queryKey: ['admin-membership-levels'], queryFn: () => apiFetch<Membership[]>('/api/admin/mm/membership-levels?includeDisabled=1') })
  return <>
    {(['readAccess', 'downloadAccess'] as const).map((scope) => {
      const download = scope === 'downloadAccess'
      const modes = download ? ['FOLLOW_READ', 'LOGIN', 'MEMBERSHIPS', 'DISABLED'] : ['PUBLIC', 'LOGIN', 'MEMBERSHIPS']
      return <section key={scope}>
        <Form.Item name={[scope, 'mode']} label={download ? t('download') : t('read')} rules={[{ required: true }]}>
          <Select options={modes.map((mode) => ({ value: mode, label: t(`modes.${mode}`) }))} />
        </Form.Item>
        <Form.Item noStyle shouldUpdate>
          {({ getFieldValue, setFieldValue }) => {
            const mode = getFieldValue([scope, 'mode'])
            const ids: string[] = getFieldValue([scope, 'membershipLevelIds']) || []
            if (mode !== 'MEMBERSHIPS') {
              // Changing mode removes its inactive list from the submitted policy.
              return <Typography.Paragraph type="secondary">{t(`hints.${mode || (download ? 'FOLLOW_READ' : 'PUBLIC')}`)}</Typography.Paragraph>
            }
            return <>
              <Form.Item name={[scope, 'membershipLevelIds']} label={t('members')} rules={[{ required: true, type: 'array', min: 1, message: t('selectMembers') }]}>
                <Select mode="multiple" loading={memberships.isLoading} options={(memberships.data || []).map((item) => ({ value: item.id, label: `${item.name}${item.status === 0 ? ` (${t('notForSale')})` : ''}` }))} onChange={(value) => setFieldValue([scope, 'membershipLevelIds'], value)} />
              </Form.Item>
              <Typography.Paragraph type="secondary">{t('summary', { names: ids.map((id) => memberships.data?.find((item) => item.id === id)?.name || id).join(' / ') || t('selectMembers') })}</Typography.Paragraph>
            </>
          }}
        </Form.Item>
      </section>
    })}
    <Typography.Paragraph type="secondary">{t('downloadNeedsRead')}</Typography.Paragraph>
    <Typography.Paragraph type="secondary">{t('sharedFilesHint')}</Typography.Paragraph>
  </>
}
