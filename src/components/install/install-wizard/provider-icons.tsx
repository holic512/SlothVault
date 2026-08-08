/**
 * @file provider-icons.tsx
 * @project SlothVault
 * @module First-run Installation
 * @description Maps supported database providers to the icons used throughout the installation interface.
 * @logic Expose one stable provider-to-icon mapping for the orchestrator and connection stage.
 * @dependencies Ant Design Icons
 * @index_tags install,database,providers,icons
 * @author holic512
 */
import { CloudServerOutlined, DatabaseOutlined, HddOutlined } from '@ant-design/icons'

import type { DatabaseProvider } from './types'

export const providerIcons = {
  sqlite: <HddOutlined />,
  mysql: <CloudServerOutlined />,
  postgresql: <DatabaseOutlined />,
} satisfies Record<DatabaseProvider, React.ReactNode>
