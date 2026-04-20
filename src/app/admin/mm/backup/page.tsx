'use client'

import { App, Button, Card, Flex, Input, Space, Upload } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { useState } from 'react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const { message } = App.useApp()
  const [confirm, setConfirm] = useState('')

  return (
    <div>
      <AdminPageHeader title="Backup" description="Backup, import, and reset data" />
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card title="Database">
          <Flex gap={12}>
            <Button
              icon={<DownloadOutlined />}
              onClick={async () => {
                const backup = await apiFetch<any>('/api/admin/mm/backup/database-export')
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = `slothvault-backup-${Date.now()}.json`
                link.click()
                URL.revokeObjectURL(url)
              }}
            >
              Export database
            </Button>
            <Upload
              accept=".json"
              showUploadList={false}
              beforeUpload={async (file) => {
                const text = await file.text()
                await apiFetch('/api/admin/mm/backup/database-import', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: text
                })
                message.success('Database imported')
                return false
              }}
            >
              <Button icon={<UploadOutlined />}>Import database</Button>
            </Upload>
          </Flex>
        </Card>
        <Card title="Files">
          <Flex gap={12}>
            <Button
              icon={<DownloadOutlined />}
              onClick={async () => {
                const response = await fetch('/api/admin/mm/backup/files-export')
                const blob = await response.blob()
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = `uploads-backup-${Date.now()}.zip`
                link.click()
                URL.revokeObjectURL(url)
              }}
            >
              Export files
            </Button>
            <Upload
              accept=".zip"
              showUploadList={false}
              beforeUpload={async (file) => {
                const formData = new FormData()
                formData.append('file', file)
                formData.append('mode', 'overwrite')
                await fetch('/api/admin/mm/backup/files-import', {
                  method: 'POST',
                  body: formData
                })
                message.success('Files imported')
                return false
              }}
            >
              <Button icon={<UploadOutlined />}>Import files</Button>
            </Upload>
          </Flex>
        </Card>
        <Card title="Danger Zone">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Type RESET_ALL_DATA"
            />
            <Button
              danger
              onClick={async () => {
                await apiFetch('/api/admin/mm/backup/system-reset', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    confirm,
                    clearDatabase: true,
                    clearFiles: true
                  })
                })
                message.success('System reset complete')
              }}
            >
              Reset all data
            </Button>
          </Space>
        </Card>
      </Space>
    </div>
  )
}
