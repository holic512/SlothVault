import type { HTMLAttributes } from 'react'

import ReactMarkdown from 'react-markdown'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'

import markdownStyles from '@/styles/modules/markdown.module.css'

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] || []),
      'className',
      'style',
      'align',
      'id',
      'title',
    ],
    a: [...(defaultSchema.attributes?.a || []), 'target', 'rel'],
    img: [...(defaultSchema.attributes?.img || []), 'width', 'height', 'loading'],
  },
}

export function MarkdownView({ content, className = '' }: { content: string; className?: string }) {
  return (
    <article className={`${markdownStyles.root} ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, sanitizeSchema],
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: 'wrap' }],
        ]}
        components={{
          a: ({ href, children, ...props }) => {
            const external = Boolean(href && /^(https?:)?\/\//.test(href))
            return (
              <a
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer noopener' : undefined}
                {...props}
              >
                {children}
              </a>
            )
          },
          img: ({ alt, ...props }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={alt || ''} loading="lazy" {...props} />
          ),
          div: ({ className: divClassName, ...props }: HTMLAttributes<HTMLDivElement>) => (
            <div className={divClassName} {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
