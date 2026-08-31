/**
 * @file branding.ts
 * @project SlothVault
 * @module System Branding Contract
 * @description Defines resolved public URLs and customization state for the system logo and browser favicon.
 * @logic Carry independently validated branding resource states from server configuration into page and shell components.
 * @dependencies system-branding service, shell and public page components
 * @index_tags types,branding,logo,favicon,public-contract
 * @author holic512
 */
export type SystemBranding = {
  logoUrl: string
  isCustom: boolean
  faviconUrl: string
  isFaviconCustom: boolean
}
