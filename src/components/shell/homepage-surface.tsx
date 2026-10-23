'use client'

/**
 * @file homepage-surface.tsx
 * @project SlothVault
 * @module Public Homepage Surface
 * @description Frames server-rendered homepage content with an optional full-width personal cover.
 * @logic Reserve the cover geometry before loading, preserve its chosen focal point, and restore the original reading layout if the image fails.
 * @dependencies React, shared homepage cover contract, public page styles
 * @index_tags homepage,cover,responsive,fallback
 * @author holic512
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { homepageCoverUrl, type HomepageCover } from '@/lib/homepage-cover'

export function HomepageSurface({ cover, children }: { cover: HomepageCover | null; children: ReactNode }) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const url = cover?.enabled ? homepageCoverUrl(cover) : null
  const visible = Boolean(url && failedUrl !== url)

  useEffect(() => {
    const image = imageRef.current
    if (url && image?.complete && image.naturalWidth === 0) setFailedUrl(url)
  }, [url])

  return (
    <main className={`homepage-main${visible ? ' homepage-main--with-cover' : ''}`}>
      {visible && cover && url ? (
        <div className="homepage-cover" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={url}
            alt=""
            loading="eager"
            fetchPriority="high"
            decoding="async"
            style={{ objectPosition: `${cover.positionX}% ${cover.positionY}%` }}
            onError={() => setFailedUrl(url)}
          />
        </div>
      ) : null}
      {children}
    </main>
  )
}
