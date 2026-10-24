import { useState } from 'react'
import type { CSSProperties } from 'react'
import {
  Apple,
  Baby,
  Beef,
  Croissant,
  CupSoda,
  Fish,
  House,
  Milk,
  ShoppingBasket,
  Snowflake,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Look {
  Icon: LucideIcon
  hue: number
}

// Category slugs are set by staff, so match on common stems rather than exact values.
const LOOKS: [RegExp, Look][] = [
  [/ovoshch|frukt|ovosh|zelen|yagod/, { Icon: Apple, hue: 100 }],
  [/moloch|moloko|syr|dairy/, { Icon: Milk, hue: 200 }],
  [/hleb|vypech|bakery/, { Icon: Croissant, hue: 35 }],
  [/myas|ptic|kolbas/, { Icon: Beef, hue: 8 }],
  [/ryb|fish|more/, { Icon: Fish, hue: 195 }],
  [/napit|drink|sok/, { Icon: CupSoda, hue: 330 }],
  [/zamoroz|frozen/, { Icon: Snowflake, hue: 210 }],
  [/det|baby|kids/, { Icon: Baby, hue: 48 }],
  [/krasot|uhod|beauty|gigien/, { Icon: Sparkles, hue: 300 }],
  [/dom|home|hoz|byt/, { Icon: House, hue: 225 }],
]
const FALLBACK: Look = { Icon: ShoppingBasket, hue: 145 }

function placeholderLook(categorySlug: string): Look {
  const slug = categorySlug.toLowerCase()
  return LOOKS.find(([pattern]) => pattern.test(slug))?.[1] ?? FALLBACK
}

interface ProductMediaProps {
  imageUrl: string
  categorySlug: string
  variant: 'card' | 'thumb'
}

const SIZES = { card: 320, thumb: 64 } as const

/** The product photo, or a calm category-coloured placeholder when there is none. */
export function ProductMedia({ imageUrl, categorySlug, variant }: ProductMediaProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const size = SIZES[variant]

  if (imageUrl && failedUrl !== imageUrl) {
    return (
      <img
        className={`product-media product-media--${variant}`}
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailedUrl(imageUrl)}
      />
    )
  }

  const { Icon, hue } = placeholderLook(categorySlug)
  return (
    <div
      className={`product-media product-media--${variant} product-media--placeholder`}
      style={{ '--ph-hue': hue } as CSSProperties}
      aria-hidden="true"
    >
      <Icon className="product-media__icon" strokeWidth={1.5} aria-hidden="true" />
    </div>
  )
}
