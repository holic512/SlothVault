'use client'

import { Alert, Button, Card, Space, Typography } from 'antd'
import { KeyRound, ShieldCheck, WalletCards } from 'lucide-react'

export function ProjectAccessGate({
  loading,
  connected,
  reason,
  onAuthorize,
}: {
  loading: boolean
  connected: boolean
  reason: string
  onAuthorize: () => Promise<boolean>
}) {
  return (
    <main className="project-gate-wrap">
      <Card className="project-gate-card" variant="borderless">
        <span className="project-gate-icon"><ShieldCheck size={26} /></span>
        <Typography.Title level={2}>Protected project</Typography.Title>
        <Typography.Paragraph type="secondary">
          This collection uses a Solana cNFT as its reading credential. SlothVault asks for a
          short-lived message signature; it never requests a transaction or your private key.
        </Typography.Paragraph>
        {reason ? <Alert type="info" showIcon message={reason} /> : null}
        <Space orientation="vertical" className="project-gate-actions">
          <Button
            block
            size="large"
            type="primary"
            loading={loading}
            icon={connected ? <KeyRound size={17} /> : <WalletCards size={17} />}
            onClick={() => void onAuthorize()}
          >
            {connected ? 'Sign & verify access' : 'Choose wallet'}
          </Button>
          <Typography.Text type="secondary">Proof expires automatically after five minutes.</Typography.Text>
        </Space>
      </Card>
    </main>
  )
}
