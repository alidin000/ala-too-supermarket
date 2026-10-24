import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { navigateTo, routeHref } from '../lib/router'
import type { Route } from '../lib/router'

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  /** A customer route, or a same-origin href such as "/admin/orders/AT-000123". */
  to: Route | string
  replace?: boolean
}

/** A real link (works with middle-click and "open in new tab") that navigates in place. */
export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  const href = typeof to === 'string' ? to : routeHref(to)
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    navigateTo(href, { replace })
  }
  return <a href={href} onClick={handleClick} {...rest} />
}
