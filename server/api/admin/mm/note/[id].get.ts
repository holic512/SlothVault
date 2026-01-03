import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {getRouterParam, setResponseStatus} from 'h3'

function noteToDto(note: any) {
    return {
        id: note.id.toString(),
        categoryId: note.categoryId.toString(),
        noteTitle: note.noteTitle,
        weight: note.weight,
        status: note.status,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        isDeleted: note.isDeleted,
        category: note.category ? {
            id: note.category.id.toString(),
            categoryName: note.category.categoryName,
            projectVersionId: note.category.projectVersionId.toString(),
            projectVersion: note.category.projectVersion ? {
                id: note.category.projectVersion.id.toString(),
                version: note.category.projectVersion.version,
                projectId: note.category.projectVersion.projectId.toString(),
                project: note.category.projectVersion.project ? {
                    id: note.category.projectVersion.project.id.toString(),
                    projectName: note.category.projectVersion.project.projectName,
                } : null,
            } : null,
        } : null,
        contentCount: note._count?.contents ?? 0,
    }
}

export default defineEventHandler(async (event) => {
    const session = await readSession(event)
    if (!session) {
        setResponseStatus(event, 401)
        return fail('Unauthorized', 401)
    }

    const idRaw = getRouterParam(event, 'id')
    if (!idRaw) {
        setResponseStatus(event, 400)
        return fail('Missing id', 400)
    }

    let id: bigint
    try {
        id = BigInt(idRaw)
    } catch {
        setResponseStatus(event, 400)
        return fail('Invalid id', 400)
    }

    try {
        const note = await prisma.noteInfo.findUnique({
            where: {id},
            include: {
                category: {
                    include: {
                        projectVersion: {
                            include: {
                                project: true,
                            },
                        },
                    },
                },
                _count: {
                    select: {contents: true},
                },
            },
        })

        if (!note) {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }

        return ok(noteToDto(note))
    } catch (err) {
        console.error('Note get error:', err)
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
