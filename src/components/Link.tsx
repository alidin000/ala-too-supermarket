import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { navigate, routeHref } from '../lib/router'
import type { Route } from '../lib/router'

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: Route
  replace?: boolean
}

/** A real link (works with middle-click and "open in new tab") that navigates in place. */
export function Link({ to, replace, onClick, ...rest }: LinkProps) {
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
    navigate(to, { replace })
  }
  return <a href={routeHref(to)} onClick={handleClick} {...rest} />
}
