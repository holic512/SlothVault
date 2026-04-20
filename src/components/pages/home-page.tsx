import { LiquidNavbar } from '@/components/public/liquid-navbar'
import { MarkdownPreview } from '@/components/shared/markdown-preview'

type Props = {
  content: string
}

export function HomePage({ content }: Props) {
  return (
    <>
      <LiquidNavbar />
      <div className="homepage-wrapper">
        <div className="sloth-container">
          <MarkdownPreview content={content} />
        </div>
      </div>
    </>
  )
}
