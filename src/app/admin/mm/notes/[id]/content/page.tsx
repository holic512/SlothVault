import { redirect } from 'next/navigation'

import { prisma } from '~~/server/utils/prisma'

export default async function Page({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const note = await prisma.noteInfo.findUnique({
    where: { id: BigInt(id) },
    include: {
      category: {
        include: {
          projectVersion: true
        }
      }
    }
  })

  if (!note) {
    redirect('/admin/mm/projects')
  }

  redirect(
    `/admin/mm/projects/${note.category.projectVersion.projectId.toString()}?tab=content&versionId=${note.category.projectVersionId.toString()}&categoryId=${note.categoryId.toString()}&noteId=${note.id.toString()}&focus=note`
  )
}
