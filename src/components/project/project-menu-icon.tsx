import { GithubOutlined, GitlabOutlined, DiscordOutlined, YoutubeOutlined, TwitterOutlined } from '@ant-design/icons'
import { BookOpen, Code2, Download, ExternalLink, FileText, Folder, Globe, Home, Link2, MessageCircle, Terminal } from 'lucide-react'

import { resolveProjectMenuIcon } from '@/lib/project-menu-icons'

const icons = {
  home: Home,
  'book-open': BookOpen,
  github: GithubOutlined,
  gitlab: GitlabOutlined,
  discord: DiscordOutlined,
  youtube: YoutubeOutlined,
  twitter: TwitterOutlined,
  code: Code2,
  terminal: Terminal,
  download: Download,
  globe: Globe,
  link: Link2,
  folder: Folder,
  'message-circle': MessageCircle,
  'file-text': FileText,
  'external-link': ExternalLink,
}

export function ProjectMenuIcon({ size = 16, ...menu }: { icon?: string | null; url?: string | null; children?: unknown[]; size?: number }) {
  const key = resolveProjectMenuIcon(menu)
  if (!key) return null
  const Icon = icons[key]
  return <Icon aria-hidden style={{ width: size, height: size, fontSize: size, flexShrink: 0, display: 'inline-flex' }} />
}
