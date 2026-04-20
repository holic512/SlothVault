'use client'

import { Button, Segmented } from 'antd'
import { useThemeStore } from '@/store/theme'

export function ThemeToggle() {
  const { theme, palette, setTheme, setPalette } = useThemeStore()

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Segmented
        size="small"
        options={[
          { label: 'Light', value: 'light' },
          { label: 'Dark', value: 'dark' }
        ]}
        value={theme}
        onChange={(value) => setTheme(value as 'light' | 'dark')}
      />
      <Button size="small" onClick={() => setPalette(nextPalette(palette))}>
        Palette
      </Button>
    </div>
  )
}

function nextPalette(current: 'purple' | 'cyan' | 'emerald' | 'rose') {
  const order: Array<'purple' | 'cyan' | 'emerald' | 'rose'> = [
    'purple',
    'cyan',
    'emerald',
    'rose'
  ]
  return order[(order.indexOf(current) + 1) % order.length]
}
