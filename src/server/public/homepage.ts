import { prisma } from '~~/server/utils/prisma'

const DEFAULT_HOMEPAGE_CONTENT = `# SlothVault\n\nWelcome to SlothVault.`

export async function getHomepage() {
  let homepage = await prisma.systemHomepage.findFirst({
    where: {
      isDeleted: false,
      status: 1
    },
    orderBy: {
      id: 'desc'
    }
  })

  if (!homepage) {
    homepage = await prisma.systemHomepage.create({
      data: {
        content: DEFAULT_HOMEPAGE_CONTENT,
        status: 1
      }
    })
  }

  return {
    content: homepage.content
  }
}
