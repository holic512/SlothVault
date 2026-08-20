'use client'

import { useEffect, useRef, useState } from 'react'

export function ArticleCover({
  cover,
  title,
  className = '',
  eager = false,
}: {
  cover: string | null
  title: string
  className?: string
  eager?: boolean
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const visibleCover = cover && failedCover !== cover

  useEffect(() => {
    const image = imageRef.current
    if (cover && image?.complete && image.naturalWidth === 0) {
      setFailedCover(cover)
    }
  }, [cover])

  return (
    <div className={`article-cover ${className}`} data-empty={!visibleCover || undefined}>
      {visibleCover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imageRef}
          src={cover}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          onError={() => setFailedCover(cover)}
        />
      ) : (
        <div className="article-cover-fallback" aria-hidden="true">
          <span>{title.charAt(0).toUpperCase() || 'A'}</span>
          <i />
          <i />
          <i />
        </div>
      )}
    </div>
  )
}
