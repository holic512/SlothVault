'use client'

import { App, Button, Card, Spin } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { use, useEffect, useState } from 'react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { MarkdownEditor } from '@/components/admin/markdown-editor'
import { apiFetch, ApiError } from '@/lib/http'

export default function Page({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { message } = App.useApp()
  const { id } = use(params)
  const [content, setContent] = useState('')
  const [homeId, setHomeId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['project-home-admin', id],
    queryFn: async () => {
      try {
        return await apiFetch<any>(`/api/admin/mm/home?projectId=${id}`)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return null
        }
        throw error
      }
    }
  })

  useEffect(() => {
    setHomeId(query.data?.id || null)
    setContent(query.data?.content || '')
  }, [query.data?.content, query.data?.id])

  const mutation = useMutation({
    mutationFn: async () => {
      if (homeId) {
        return apiFetch(`/api/admin/mm/home/${homeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, status: 1 })
        })
      }
      const result = await apiFetch<any>('/api/admin/mm/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, content, status: 1 })
      })
      setHomeId(result.id)
      return result
    },
    onSuccess: () => message.success('Project home saved')
  })

  if (query.isLoading) return <Spin size="large" />

  return (
    <div>
      <AdminPageHeader
        title="Project Home"
        description={`Edit project ${id} home page`}
        extra={<Button type="primary" onClick={() => mutation.mutate()} loading={mutation.isPending}>Save</Button>}
      />
      <Card>
        <MarkdownEditor modelValue={content} onChange={setContent} />
      </Card>
    </div>
  )
}
