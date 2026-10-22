import { Blocks, Coins, Ticket, Wallet, Settings } from 'lucide-react'

const icons = { blocks: Blocks, coins: Coins, ticket: Ticket, wallet: Wallet, settings: Settings }
export function PluginIcon({ name, size = 16, className }: { name?: keyof typeof icons; size?: number; className?: string }) {
  const Icon = icons[name ?? 'blocks'] ?? Blocks
  return <Icon size={size} className={className} aria-hidden />
}
