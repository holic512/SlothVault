'use client'

import { useState } from 'react'

import type { SystemBranding } from '@/types/branding'

const DEFAULT_LOGO_URL = '/logo.png'

type BrandLogoProps = {
  branding: SystemBranding
  className?: string
  alt?: string
}

export function BrandLogo({
  branding,
  className = 'brand-logo',
  alt = '',
}: BrandLogoProps) {
  return (
    <BrandLogoImage
      key={branding.logoUrl}
      branding={branding}
      className={className}
      alt={alt}
    />
  )
}

function BrandLogoImage({ branding, className, alt }: Required<BrandLogoProps>) {
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl)

  const isCustom = branding.isCustom && logoUrl === branding.logoUrl
  const classes = `${className}${isCustom ? ' brand-logo--custom' : ''}`

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl}
      alt={alt}
      className={classes}
      onError={() => {
        if (logoUrl !== DEFAULT_LOGO_URL) setLogoUrl(DEFAULT_LOGO_URL)
      }}
    />
  )
}
