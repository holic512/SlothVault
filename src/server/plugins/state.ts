/**
 * @file state.ts
 * @project SlothVault
 * @module Plugin Runtime Registry
 * @description Keeps a tiny hot-reload-safe metadata index for zero-subscriber fast paths.
 * @logic Store validated manifests only; never load executable plugin code in core business service imports.
 * @dependencies plugin protocol
 * @index_tags plugins,registry,events,performance
 * @author holic512
 */
import 'server-only'
import type { PluginManifest } from '@slothvault/plugin-sdk/protocol'
export type RegisteredPlugin = { manifest: PluginManifest; digest: string; enabled: boolean; installed: boolean; generation: number; configCiphertext: string; accessBindings?: Record<string, number> }
const globalState = globalThis as unknown as { slothVaultPluginRegistry?: Map<string, RegisteredPlugin> }
export const pluginRegistry = globalState.slothVaultPluginRegistry ??= new Map()
