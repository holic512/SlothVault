import { defineEventHandler } from 'h3'
import { getActiveSolanaNetwork } from '~~/server/utils/configCache'

export default defineEventHandler(async () => {
  return {
    code: 0,
    data: {
      network: await getActiveSolanaNetwork(),
    },
  }
})
