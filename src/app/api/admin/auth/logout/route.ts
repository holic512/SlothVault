/**
 * @file route.ts
 * @project SlothVault
 * @module Legacy Logout Adapter
 * @description Retains the old administrator logout URL without duplicating session logic.
 * @logic Delegate revocation and cookie clearing to the shared logout handler.
 * @dependencies auth/logout route
 * @index_tags auth,logout,compatibility
 * @author holic512
 */
export { POST } from '@/app/api/auth/logout/route'
