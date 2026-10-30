/**
 * @file markdown-view.tsx
 * @project SlothVault
 * @module Mixed Document Viewer
 * @description Renders Markdown, safe HTML and registered extensions through one responsive document surface.
 * @logic Apply reading or landing typography, parse GFM and raw HTML, filter inline CSS, create stable heading links, sanitize the final tree, harden external resources, render registered interactive blocks with protected image previews, and route managed links through contextual reading/download checks.
 * @dependencies react-markdown, remark-gfm, rehype-raw, rehype-slug, rehype-autolink-headings, rehype-sanitize, MermaidDiagram
 * @index_tags markdown,html,viewer,sanitize,security,typography
 * @author holic512
 */
import { Children, cloneElement, isValidElement } from 'react'
import { MarkdownFencedBlock, ContainerBlock } from './extension-blocks'
import { DocumentImages, DocumentImage, ImagePreviewAction } from './document-images'
import remarkDirective from 'remark-directive'
import { remarkMarkdownContainers, rehypeMarkdownMarkers } from '@/lib/markdown/processor'
import { markdownFencedExtensions } from '@/lib/markdown/contract'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { Options as SanitizeSchema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { useTranslations } from 'next-intl'

import {
  DOCUMENT_CONTENT_MAX_CHARACTERS,
  isDocumentContentWithinLimit,
} from '@/lib/document-content'
import {
  rehypeSafeDocumentStyles,
  SAFE_DOCUMENT_CLASS_NAME,
} from '@/lib/markdown-security'
import markdownStyles from '@/styles/modules/markdown.module.css'
import { contextualFileUrl, managedUploadPath } from '@/lib/managed-file-paths'

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
  'dataMarkdownBlock', 'dataMarkdownAttributes', 'dataMarkdownDepth', 'dataMarkdownParent', 'dataMarkdownError', 'dataMarkdownSource',
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

export type MarkdownPresentation = 'reading' | 'landing'

export function MarkdownView({
  content,
  className = '',
  presentation = 'reading',
  projectId,
  canDownload = true,
  downloadMessage,
}: {
  content: string
  className?: string
  presentation?: MarkdownPresentation
  projectId?: string
  canDownload?: boolean
  downloadMessage?: string
}) {
  const t = useTranslations('MarkdownView')
  const articleClassName = `${markdownStyles.root} ${className}`.trim()
  if (!isDocumentContentWithinLimit(content)) {
    return (
      <article className={articleClassName} data-presentation={presentation} data-document-error="content-too-large" role="alert">
        <div className="sloth-callout sloth-callout-warning">
          <strong>{t('unavailableTitle')}</strong>
          <p>
            {t('contentTooLarge', { limit: DOCUMENT_CONTENT_MAX_CHARACTERS.toLocaleString() })}
          </p>
        </div>
      </article>
    )
  }

  return (
    <DocumentImages><article className={articleClassName} data-presentation={presentation}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkMarkdownContainers]}
        rehypePlugins={[
          rehypeRaw,
          rehypeMarkdownMarkers,
          rehypeSafeDocumentStyles,
          [rehypeSanitize, sanitizeSchema],
          rehypeSlug,
          [rehypeAutolinkHeadings, { behavior: 'wrap' }],
        ]}
        urlTransform={defaultUrlTransform}
        components={{
          div: ({ node, children, ...props }) => {
            const data = node?.properties || {}
            if (typeof data.dataMarkdownBlock === 'string') return <ContainerBlock name={data.dataMarkdownBlock} attributes={String(data.dataMarkdownAttributes || '{}')} error={data.dataMarkdownError ? String(data.dataMarkdownError) : undefined} source={String(data.dataMarkdownSource || '')}>{children}</ContainerBlock>
            return <div {...props}>{children}</div>
          },
          pre: ({ node, children, ...props }) => {
            void node
            const child = Children.toArray(children)[0]
            if (isValidElement<{ className?: string; children?: unknown }>(child) && typeof child.props.children === 'string') {
              const language = /(?:^|\s)language-(\S+)/i.exec(child.props.className || '')?.[1].toLowerCase()
              const kind = markdownFencedExtensions.find(id => id === language)
              if (kind) return <MarkdownFencedBlock kind={kind} source={child.props.children.replace(/\n$/, '')} />
            }
            return <pre {...props}>{children}</pre>
          },
          a: ({ node, href, children, ...props }) => {
            void node
            const external = Boolean(href && /^(https?:)?\/\//.test(href))
            const managed = Boolean(managedUploadPath(href))
            const imageChildren = Children.toArray(children)
            const linkedImages = imageChildren.filter(child => isValidElement<{ src?: string }>(child) && typeof child.props.src === 'string')
            const anchor = <a
                {...props}
                href={managed && !canDownload ? undefined : contextualFileUrl(href, projectId, true)}
                aria-disabled={managed && !canDownload ? true : undefined}
                title={managed && !canDownload ? downloadMessage || t('downloadUnavailable') : props.title}
                target={external ? '_blank' : undefined}
                rel={external ? 'noreferrer noopener' : undefined}
              >
                {imageChildren.map((child, index) => isValidElement<{ src?: string; alt?: string; linked?: boolean }>(child) && typeof child.props.src === 'string'
                  ? cloneElement(child, { key: index, linked: true }) : child)}
              </a>
            return linkedImages.length ? <span className="sloth-linked-image" data-image-preview="true">{anchor}<ImagePreviewAction /></span> : anchor
          },
          img: ({ node, alt, ...props }) => {
            void node
            return <DocumentImage {...props} src={typeof props.src === 'string' ? props.src : undefined} alt={alt || ''} projectId={projectId} />
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article></DocumentImages>
  )
}
