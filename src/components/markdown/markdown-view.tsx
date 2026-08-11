/**
 * @file markdown-view.tsx
 * @project SlothVault
 * @module Mixed Document Viewer
 * @description Renders Markdown and embedded HTML through one responsive, sanitized document surface.
 * @logic Parse GFM and raw HTML, filter inline CSS, create stable heading links, sanitize the final tree, and harden external resources.
 * @dependencies react-markdown, remark-gfm, rehype-raw, rehype-slug, rehype-autolink-headings, rehype-sanitize
 * @index_tags markdown,html,viewer,sanitize,security,typography
 * @author holic512
 */
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeSchema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'

import {
  DOCUMENT_CONTENT_MAX_CHARACTERS,
  isDocumentContentWithinLimit,
} from '@/lib/document-content'
import {
  rehypeSafeDocumentStyles,
  SAFE_DOCUMENT_CLASS_NAME,
} from '@/lib/markdown-security'
import markdownStyles from '@/styles/modules/markdown.module.css'

type AttributeDefinitions = NonNullable<SanitizeSchema['attributes']>[string]

function allowDocumentClasses(definitions: AttributeDefinitions = []): AttributeDefinitions {
  const existingClassDefinition = definitions.find(
    (definition) =>
      definition === 'className' ||
      (Array.isArray(definition) && definition[0] === 'className'),
  )
  if (existingClassDefinition === 'className') return [...definitions]

  const existingValues = Array.isArray(existingClassDefinition)
    ? existingClassDefinition.slice(1)
    : []
  return [
    ['className', ...existingValues, SAFE_DOCUMENT_CLASS_NAME],
    ...definitions.filter((definition) => definition !== existingClassDefinition),
  ]
}

const sanitizeAttributes = Object.fromEntries(
  Object.entries(defaultSchema.attributes || {}).map(([tagName, definitions]) => [
    tagName,
    allowDocumentClasses(definitions),
  ]),
) as NonNullable<SanitizeSchema['attributes']>
sanitizeAttributes['*'] = [
  ...allowDocumentClasses(defaultSchema.attributes?.['*']),
  'style',
  'ariaLabel',
]
sanitizeAttributes.img = [
  ...allowDocumentClasses(defaultSchema.attributes?.img),
  'width',
  'height',
]

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'aside',
    'figcaption',
    'figure',
    'mark',
  ],
  attributes: sanitizeAttributes,
} satisfies SanitizeSchema

export function MarkdownView({ content, className = '' }: { content: string; className?: string }) {
  const articleClassName = `${markdownStyles.root} ${className}`.trim()
  if (!isDocumentContentWithinLimit(content)) {
    return (
      <article className={articleClassName} data-document-error="content-too-large" role="alert">
        <div className="sloth-callout sloth-callout-warning">
          <strong>文档暂时无法展示 / Document unavailable</strong>
          <p>
            内容超过 {DOCUMENT_CONTENT_MAX_CHARACTERS.toLocaleString()} 字符的安全展示限制，请联系管理员精简或拆分文档。
          </p>
        </div>
      </article>
    )
  }

  return (
    <article className={articleClassName}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          rehypeRaw,
          rehypeSafeDocumentStyles,
          [rehypeSanitize, sanitizeSchema],
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: 'wrap' }],
        ]}
        urlTransform={defaultUrlTransform}
        components={{
          a: ({ node, href, children, ...props }) => {
            void node
            const external = Boolean(href && /^(https?:)?\/\//.test(href))
            return (
              <a
                {...props}
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer noopener' : undefined}
              >
                {children}
              </a>
            )
          },
          img: ({ node, alt, ...props }) => {
            void node
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                {...props}
                alt={alt || ''}
                decoding="async"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
