'use client'

import { App, Button, Card, Spin } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { MarkdownEditor } from '@/components/admin/markdown-editor'
import { apiFetch } from '@/lib/http'

export default function Page() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['system-homepage'],
    queryFn: () => apiFetch<any>('/api/admin/mm/systemHomepage')
  })
  const [content, setContent] = useState('')

  useEffect(() => {
    if (query.data?.content) {
      setContent(query.data.content)
    }
  }, [query.data?.content])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!query.data) return
      return apiFetch(`/api/admin/mm/systemHomepage/${query.data.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          status: query.data.status
        })
      })
    },
    onSuccess: async () => {
      message.success('Homepage saved')
      await queryClient.invalidateQueries({ queryKey: ['system-homepage'] })
    }
  })

  if (query.isLoading) return <Spin size="large" />

  return (
    <div>
      <AdminPageHeader
        title="Homepage"
        description="Edit the public system homepage"
        extra={<Button type="primary" onClick={() => mutation.mutate()} loading={mutation.isPending}>Save</Button>}
      />
      <Card>
        <MarkdownEditor modelValue={content} onChange={setContent} />
      </Card>
    </div>
  )
}
