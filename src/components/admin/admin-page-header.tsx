import { Flex, Typography } from 'antd'

type Props = {
  title: string
  description?: string
  extra?: React.ReactNode
}

export function AdminPageHeader({ title, description, extra }: Props) {
  return (
    <Flex justify="space-between" align="flex-start" style={{ marginBottom: 24 }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 4 }}>
          {title}
        </Typography.Title>
        {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
      </div>
      {extra}
    </Flex>
  )
}
