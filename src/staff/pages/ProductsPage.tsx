import { CircleAlert, CircleCheck, PackageSearch } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { useAnnounce } from '../../a11y/announce'
import { api } from '../../api'
import { isAbortError } from '../../api/errors'
import type { FieldErrors } from '../../api/errors'
import { useResource } from '../../lib/hooks'
import { formatMoney } from '../../lib/money'
import { navigateTo } from '../../lib/router'
import { isStaffApiError } from '../api'
import { staffApi } from '../client'
import { SearchField } from '../components/SearchField'
import { Forbidden, LoadError } from '../components/StatePanels'
import { useStaff } from '../context'
import { errorMessage, generalErrors } from '../format'
import { useMediaQuery, useStaffTitle } from '../hooks'
import {
  applyPatch,
  BADGES,
  buildProductPatch,
  DEFAULT_PRODUCT_FILTERS,
  draftFromProduct,
  hasErrors,
  isDraftDirty,
  parseProductFilters,
  productsSearch,
  stockLevel,
  validateDraft,
} from '../productEdit'
import type {
  DraftErrors,
  DraftField,
  ProductDraft,
  ProductFilters,
  StockLevel,
} from '../productEdit'
import { staffHref } from '../routes'
import { S } from '../strings'
import type { ActiveFilter, Badge, StaffProduct, StockFilter } from '../types'

const DEFAULT_LOW_STOCK = 5
const fetchCategories = (signal: AbortSignal) => api.getCategories(signal)

interface ProductsData {
  key: string
  rows: StaffProduct[]
  count: number
  pages: number
  threshold: number
}

export function ProductsPage({ filters }: { filters: ProductFilters }) {
  useStaffTitle(S.products.title)
  const { user } = useStaff()
  const announce = useAnnounce()
  const canView = user.permissions.view_products
  const canEdit = user.permissions.change_products
  const wide = useMediaQuery('(min-width: 900px)')
  const key = productsSearch(filters)
  const categories = useResource(canView ? 'categories' : null, fetchCategories)

  const [tick, setTick] = useState(0)
  const [data, setData] = useState<ProductsData | null>(null)
  const [failure, setFailure] = useState<{ key: string; error: unknown } | null>(null)
  const [more, setMore] = useState({ loading: false, failed: false })

  useEffect(() => {
    if (!canView) return
    const controller = new AbortController()
    const query = { ...parseProductFilters(key), page: 1 }
    staffApi.listProducts(query, controller.signal).then(
      (page) => {
        setData({
          key,
          rows: page.results,
          count: page.count,
          pages: 1,
          threshold: page.low_stock_threshold ?? DEFAULT_LOW_STOCK,
        })
        setFailure(null)
      },
      (error: unknown) => {
        if (!isAbortError(error)) setFailure({ key, error })
      },
    )
    return () => controller.abort()
  }, [key, tick, canView])

  const setFilters = (next: ProductFilters) =>
    navigateTo(staffHref({ name: 'products', filters: next }), { replace: true })
  const onSearch = useCallback(
    (q: string) =>
      navigateTo(staffHref({ name: 'products', filters: { ...filters, q } }), { replace: true }),
    [filters],
  )
  const onSaved = useCallback((product: StaffProduct) => {
    setData((previous) =>
      previous
        ? {
            ...previous,
            rows: previous.rows.map((row) => (row.id === product.id ? product : row)),
          }
        : previous,
    )
  }, [])

  async function loadMore() {
    const current = data
    if (!current || more.loading) return
    setMore({ loading: true, failed: false })
    try {
      const page = await staffApi.listProducts({ ...filters, page: current.pages + 1 })
      setData((previous) => {
        if (!previous || previous.key !== current.key) return previous
        const known = new Set(previous.rows.map((row) => row.id))
        return {
          ...previous,
          rows: [...previous.rows, ...page.results.filter((row) => !known.has(row.id))],
          count: page.count,
          pages: current.pages + 1,
        }
      })
      setMore({ loading: false, failed: false })
      announce(S.products.shown(current.rows.length + page.results.length, page.count))
    } catch {
      setMore({ loading: false, failed: true })
    }
  }

  const current = data?.key === key ? data : null
  const currentFailure = failure?.key === key ? failure.error : null
  const filtered = key !== ''

  let body: ReactNode
  if (!canView || isStaffApiError(currentFailure, 'forbidden')) {
    body = <Forbidden />
  } else if (!current && currentFailure) {
    body = (
      <LoadError
        title={S.products.loadError}
        error={currentFailure}
        onRetry={() => setTick((value) => value + 1)}
      />
    )
  } else if (!current) {
    body = (
      <div className="staff-skeleton" aria-busy="true">
        <span className="visually-hidden">{S.loading}</span>
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index} className="skeleton staff-skeleton__row" />
        ))}
      </div>
    )
  } else if (current.rows.length === 0) {
    body = (
      <div className="state-panel">
        <span className="empty-illustration" aria-hidden="true">
          <PackageSearch strokeWidth={1.5} />
        </span>
        <p className="state-panel__title">{S.products.emptyTitle}</p>
        <p className="muted">{S.products.emptyHint}</p>
        {filtered && (
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => setFilters(DEFAULT_PRODUCT_FILTERS)}
          >
            {S.products.resetFilters}
          </button>
        )}
      </div>
    )
  } else {
    const rowProps = { threshold: current.threshold, canEdit, onSaved }
    body = (
      <>
        {wide ? (
          <div className="staff-table-wrap">
            <table className="staff-table staff-products">
              <caption className="visually-hidden">{S.products.tableCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">{S.products.columns.product}</th>
                  <th scope="col" className={canEdit ? undefined : 'staff-table__num'}>
                    {S.products.columns.price}
                  </th>
                  <th scope="col" className={canEdit ? undefined : 'staff-table__num'}>
                    {S.products.columns.stock}
                  </th>
                  <th scope="col">{S.products.columns.onSale}</th>
                  <th scope="col">{S.products.columns.badge}</th>
                  {canEdit && (
                    <th scope="col">
                      <span className="visually-hidden">{S.products.columns.save}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {current.rows.map((product) => (
                  <ProductTableRow
                    key={`${current.key}:${product.id}`}
                    product={product}
                    {...rowProps}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="staff-product-cards" role="list">
            {current.rows.map((product) => (
              <ProductCard key={`${current.key}:${product.id}`} product={product} {...rowProps} />
            ))}
          </ul>
        )}
        <div className="load-more">
          <p className="load-more__count">{S.products.shown(current.rows.length, current.count)}</p>
          {more.failed && (
            <p className="load-more__error" role="alert">
              {S.products.loadMoreError}
            </p>
          )}
          {current.rows.length < current.count && (
            <button
              type="button"
              className="btn btn--outline"
              onClick={loadMore}
              aria-disabled={more.loading || undefined}
            >
              {more.loading ? S.products.loadingMore : S.products.loadMore}
            </button>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="container page staff-page">
      <div className="staff-page__head">
        <h1 className="page-title staff-page__title" tabIndex={-1}>
          {S.products.title}
        </h1>
      </div>

      {canView && (
        <div className="staff-filters" role="group" aria-label={S.products.filtersLabel}>
          <SearchField
            id="products-search"
            label={S.products.searchLabel}
            placeholder={S.products.searchPlaceholder}
            clearLabel={S.products.clearSearch}
            value={filters.q}
            onSearch={onSearch}
          />
          <div className="staff-selects">
            <label className="staff-select">
              <span className="staff-select__label">{S.products.category}</span>
              <select
                className="input"
                value={filters.category}
                onChange={(event) => setFilters({ ...filters, category: event.target.value })}
              >
                <option value="">{S.products.allCategories}</option>
                {(categories.data ?? []).map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.parent === null ? category.name_ru : `— ${category.name_ru}`}
                  </option>
                ))}
              </select>
            </label>
            <label className="staff-select">
              <span className="staff-select__label">{S.products.stock}</span>
              <select
                className="input"
                value={filters.stock}
                onChange={(event) =>
                  setFilters({ ...filters, stock: event.target.value as StockFilter })
                }
              >
                {(Object.keys(S.products.stockFilters) as StockFilter[]).map((value) => (
                  <option key={value} value={value}>
                    {S.products.stockFilters[value]}
                  </option>
                ))}
              </select>
            </label>
            <label className="staff-select">
              <span className="staff-select__label">{S.products.active}</span>
              <select
                className="input"
                value={filters.active}
                onChange={(event) =>
                  setFilters({ ...filters, active: event.target.value as ActiveFilter })
                }
              >
                {(['', '1', '0'] as const).map((value) => (
                  <option key={value} value={value}>
                    {S.products.activeFilters[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {canView && !canEdit && (
            <p className="staff-readonly" role="note">
              {S.products.readOnly}
            </p>
          )}
          {canEdit && <p className="staff-hint muted">{S.products.enterHint}</p>}
        </div>
      )}

      {body}
    </div>
  )
}

// --- One editable product row --------------------------------------------------------------

interface RowProps {
  product: StaffProduct
  threshold: number
  canEdit: boolean
  onSaved: (product: StaffProduct) => void
}

type RowStatus = 'idle' | 'saving' | 'saved' | 'reverted'

const SERVER_FIELD: Record<DraftField, string> = { price: 'price', stock: 'stock_quantity' }
const KNOWN_FIELDS = ['price', 'stock_quantity']

interface RowRefs {
  price: RefObject<HTMLInputElement | null>
  stock: RefObject<HTMLInputElement | null>
}

/** Draft, validation and save for one product. The caller owns the input refs. */
function useProductRow({ product, onSaved }: RowProps, refs: RowRefs) {
  const announce = useAnnounce()
  const [saved, setSaved] = useState(product)
  const [shown, setShown] = useState(product)
  const [draft, setDraft] = useState<ProductDraft>(() => draftFromProduct(product))
  const [errors, setErrors] = useState<DraftErrors>({})
  const [serverErrors, setServerErrors] = useState<FieldErrors>({})
  const [rowError, setRowError] = useState<string | null>(null)
  const [status, setStatus] = useState<RowStatus>('idle')

  const update = (patch: Partial<ProductDraft>) => {
    setDraft((previous) => ({ ...previous, ...patch }))
    if (status !== 'saving') setStatus('idle')
  }

  async function save() {
    if (status === 'saving') return
    const check = validateDraft(draft)
    if (hasErrors(check.errors)) {
      setErrors(check.errors)
      setServerErrors({})
      const first = check.errors.price ? refs.price : refs.stock
      first.current?.focus()
      announce(
        [check.errors.price, check.errors.stock]
          .filter((code) => code !== undefined)
          .map((code) => S.products.errors[code])
          .join(' '),
      )
      return
    }
    setErrors({})
    const patch = buildProductPatch(saved, draft)
    if (!patch || Object.keys(patch).length === 0) return
    const previous = saved
    setServerErrors({})
    setRowError(null)
    setShown(applyPatch(saved, patch)) // optimistic: the stock marks update at once
    setStatus('saving')
    try {
      const next = await staffApi.updateProduct(saved.id, patch)
      setSaved(next)
      setShown(next)
      setDraft(draftFromProduct(next))
      setStatus('saved')
      onSaved(next)
      announce(S.products.saved(next.name_ru))
    } catch (error) {
      setShown(previous) // revert what the row shows to the last saved values
      if (isStaffApiError(error, 'validation')) {
        // Keep the typed values, so the person can correct what the server rejected.
        setServerErrors(error.fieldErrors)
        const other = generalErrors(error, KNOWN_FIELDS)
        setRowError(other.length > 0 ? other.join(' ') : null)
        setStatus('idle')
        if (error.fieldErrors.price) refs.price.current?.focus()
        else if (error.fieldErrors.stock_quantity) refs.stock.current?.focus()
        announce(errorMessage(error))
      } else {
        setDraft(draftFromProduct(previous))
        setRowError(`${S.products.reverted} ${errorMessage(error)}`)
        setStatus('reverted')
        announce(`${S.products.reverted} ${errorMessage(error)}`)
      }
    }
  }

  const fieldError = (field: DraftField): string | undefined => {
    const code = errors[field]
    if (code) return S.products.errors[code]
    return serverErrors[SERVER_FIELD[field]]?.join(' ')
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void save()
    }
  }

  return {
    shown,
    draft,
    update,
    save,
    status,
    rowError,
    fieldError,
    onKeyDown,
    dirty: isDraftDirty(saved, draft),
  }
}

function StockMark({ level }: { level: StockLevel }) {
  if (level === 'ok') return null
  return (
    <span className={`staff-stock-mark staff-stock-mark--${level}`}>
      {level === 'out' ? S.products.out : S.products.low}
    </span>
  )
}

function badgeLabel(badge: Badge | null): string {
  return badge ? S.badge[badge] : S.products.noBadge
}

function SaveStatus({
  status,
  rowError,
  id,
}: {
  status: RowStatus
  rowError: string | null
  id: string
}) {
  if (rowError) {
    return (
      <p id={id} className="field__error staff-row-error" role="alert">
        <CircleAlert aria-hidden="true" />
        {rowError}
      </p>
    )
  }
  if (status === 'saved') {
    return (
      <p id={id} className="staff-row-saved">
        <CircleCheck aria-hidden="true" />
        {S.products.savedShort}
      </p>
    )
  }
  return null
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null
  return (
    <p id={id} className="field__error">
      <CircleAlert aria-hidden="true" />
      {message}
    </p>
  )
}

function rowClass(level: StockLevel, active: boolean): string {
  return [level !== 'ok' ? `is-${level}` : '', active ? '' : 'is-hidden'].filter(Boolean).join(' ')
}

function ProductTableRow(props: RowProps) {
  const { threshold, canEdit } = props
  const priceRef = useRef<HTMLInputElement>(null)
  const stockRef = useRef<HTMLInputElement>(null)
  const row = useProductRow(props, { price: priceRef, stock: stockRef })
  const product = row.shown
  const level = stockLevel(product.stock_quantity, threshold)
  const base = `product-${product.id}`
  const priceError = row.fieldError('price')
  const stockError = row.fieldError('stock')
  const name = product.name_ru

  return (
    <tr className={rowClass(level, product.is_active) || undefined}>
      <th scope="row" className="staff-products__name">
        <span className="staff-item__name">{name}</span>
        <span className="staff-item__meta muted">
          {product.sku} · {product.unit} · {product.category_name}
        </span>
        <StockMark level={level} />
      </th>
      {canEdit ? (
        <>
          <td>
            <input
              ref={priceRef}
              className="input staff-input staff-input--price"
              inputMode="decimal"
              autoComplete="off"
              aria-label={S.products.priceFor(name)}
              aria-invalid={priceError ? true : undefined}
              aria-describedby={priceError ? `${base}-price-error` : undefined}
              value={row.draft.price}
              onChange={(event) => row.update({ price: event.target.value })}
              onKeyDown={row.onKeyDown}
            />
            <FieldError id={`${base}-price-error`} message={priceError} />
          </td>
          <td>
            <input
              ref={stockRef}
              className="input staff-input staff-input--stock"
              inputMode="numeric"
              autoComplete="off"
              aria-label={S.products.stockFor(name)}
              aria-invalid={stockError ? true : undefined}
              aria-describedby={stockError ? `${base}-stock-error` : undefined}
              value={row.draft.stock}
              onChange={(event) => row.update({ stock: event.target.value })}
              onKeyDown={row.onKeyDown}
            />
            <FieldError id={`${base}-stock-error`} message={stockError} />
          </td>
          <td>
            <input
              type="checkbox"
              className="staff-checkbox"
              aria-label={S.products.onSaleFor(name)}
              checked={row.draft.isActive}
              onChange={(event) => row.update({ isActive: event.target.checked })}
              onKeyDown={row.onKeyDown}
            />
          </td>
          <td>
            <select
              className="input staff-input"
              aria-label={S.products.badgeFor(name)}
              value={row.draft.badge}
              onChange={(event) => row.update({ badge: event.target.value as Badge | '' })}
              onKeyDown={row.onKeyDown}
            >
              <option value="">{S.products.noBadge}</option>
              {BADGES.map((badge) => (
                <option key={badge} value={badge}>
                  {S.badge[badge]}
                </option>
              ))}
            </select>
          </td>
          <td className="staff-products__save">
            <button
              type="button"
              className={`btn btn--sm ${row.dirty ? 'btn--primary' : 'btn--outline'}`}
              aria-label={S.products.saveFor(name)}
              aria-disabled={!row.dirty || row.status === 'saving' || undefined}
              aria-describedby={`${base}-status`}
              onClick={() => (row.dirty ? row.save() : undefined)}
            >
              {row.status === 'saving' ? S.products.saving : S.products.save}
            </button>
            <SaveStatus id={`${base}-status`} status={row.status} rowError={row.rowError} />
          </td>
        </>
      ) : (
        <>
          <td className="staff-table__num">{formatMoney(product.price)}</td>
          <td className="staff-table__num">{S.products.units(product.stock_quantity)}</td>
          <td>{product.is_active ? S.products.onSale : S.products.hidden}</td>
          <td>{badgeLabel(product.badge)}</td>
        </>
      )}
    </tr>
  )
}

function ProductCard(props: RowProps) {
  const { threshold, canEdit } = props
  const priceRef = useRef<HTMLInputElement>(null)
  const stockRef = useRef<HTMLInputElement>(null)
  const row = useProductRow(props, { price: priceRef, stock: stockRef })
  const product = row.shown
  const level = stockLevel(product.stock_quantity, threshold)
  const base = `product-card-${product.id}`
  const priceError = row.fieldError('price')
  const stockError = row.fieldError('stock')

  return (
    <li className={`staff-product-card ${rowClass(level, product.is_active)}`}>
      <div className="staff-product-card__head">
        <p className="staff-item__name">{product.name_ru}</p>
        <StockMark level={level} />
      </div>
      <p className="staff-item__meta muted">
        {product.sku} · {product.unit} · {product.category_name}
      </p>
      {canEdit ? (
        <>
          <div className="staff-product-card__grid">
            <div className={`field${priceError ? ' field--invalid' : ''}`}>
              <label className="field__label" htmlFor={`${base}-price`}>
                {S.products.columns.price}
              </label>
              <input
                ref={priceRef}
                id={`${base}-price`}
                className="input"
                inputMode="decimal"
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={priceError ? true : undefined}
                aria-describedby={priceError ? `${base}-price-error` : undefined}
                value={row.draft.price}
                onChange={(event) => row.update({ price: event.target.value })}
                onKeyDown={row.onKeyDown}
              />
              <FieldError id={`${base}-price-error`} message={priceError} />
            </div>
            <div className={`field${stockError ? ' field--invalid' : ''}`}>
              <label className="field__label" htmlFor={`${base}-stock`}>
                {S.products.columns.stock}
              </label>
              <input
                ref={stockRef}
                id={`${base}-stock`}
                className="input"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={stockError ? true : undefined}
                aria-describedby={stockError ? `${base}-stock-error` : undefined}
                value={row.draft.stock}
                onChange={(event) => row.update({ stock: event.target.value })}
                onKeyDown={row.onKeyDown}
              />
              <FieldError id={`${base}-stock-error`} message={stockError} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`${base}-badge`}>
                {S.products.columns.badge}
              </label>
              <select
                id={`${base}-badge`}
                className="input"
                value={row.draft.badge}
                onChange={(event) => row.update({ badge: event.target.value as Badge | '' })}
              >
                <option value="">{S.products.noBadge}</option>
                {BADGES.map((badge) => (
                  <option key={badge} value={badge}>
                    {S.badge[badge]}
                  </option>
                ))}
              </select>
            </div>
            <label className="staff-check">
              <input
                type="checkbox"
                className="staff-checkbox"
                checked={row.draft.isActive}
                onChange={(event) => row.update({ isActive: event.target.checked })}
              />
              <span>{S.products.onSale}</span>
            </label>
          </div>
          <div className="staff-product-card__actions">
            <button
              type="button"
              className={`btn ${row.dirty ? 'btn--primary' : 'btn--outline'}`}
              aria-disabled={!row.dirty || row.status === 'saving' || undefined}
              aria-describedby={`${base}-status`}
              onClick={() => (row.dirty ? row.save() : undefined)}
            >
              {row.status === 'saving' ? S.products.saving : S.products.save}
            </button>
            <SaveStatus id={`${base}-status`} status={row.status} rowError={row.rowError} />
          </div>
        </>
      ) : (
        <dl className="staff-dl staff-dl--inline">
          <div>
            <dt>{S.products.columns.price}</dt>
            <dd className="staff-strong">{formatMoney(product.price)}</dd>
          </div>
          <div>
            <dt>{S.products.columns.stock}</dt>
            <dd>{S.products.units(product.stock_quantity)}</dd>
          </div>
          <div>
            <dt>{S.products.columns.onSale}</dt>
            <dd>{product.is_active ? S.products.onSale : S.products.hidden}</dd>
          </div>
          <div>
            <dt>{S.products.columns.badge}</dt>
            <dd>{badgeLabel(product.badge)}</dd>
          </div>
        </dl>
      )}
    </li>
  )
}
