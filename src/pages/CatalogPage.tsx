import { Search, SearchX, X } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import { useAnnounce } from '../a11y/announce'
import { api, isAbortError } from '../api'
import type { Category, Product } from '../api/types'
import { Hero } from '../components/Hero'
import { Notice } from '../components/Notice'
import { ProductCard, ProductCardSkeleton } from '../components/ProductCard'
import { useI18n } from '../i18n/context'
import { useDebouncedValue, useResource } from '../lib/hooks'
import { catalogRoute, navigate } from '../lib/router'

const SEARCH_DEBOUNCE_MS = 300
const SKELETON_COUNT = 8

interface ListState {
  key: string
  items: Product[]
  count: number
  page: number
  hasMore: boolean
  error?: unknown
}

const fetchCategories = (signal: AbortSignal) => api.getCategories(signal)

function dedupe(products: Product[]): Product[] {
  const seen = new Set<number>()
  return products.filter((product) => !seen.has(product.id) && seen.add(product.id))
}

export function CatalogPage({ category, q }: { category: string; q: string }) {
  const { t, name } = useI18n()
  const announce = useAnnounce()
  const categories = useResource('categories', fetchCategories)

  // The URL holds the applied filters (shareable, survives "back" from checkout); the
  // input holds what is being typed and is written to the URL once typing pauses.
  const [input, setInput] = useState(q)
  const [syncedQ, setSyncedQ] = useState(q)
  if (q !== syncedQ) {
    // The URL changed from outside the search box (a link, "reset"): show the new query.
    setSyncedQ(q)
    if (q !== input.trim()) setInput(q)
  }
  const debounced = useDebouncedValue(input.trim(), SEARCH_DEBOUNCE_MS)
  const applySearch = useEffectEvent((value: string) => {
    if (value !== q) navigate(catalogRoute(category, value), { replace: true })
  })
  useEffect(() => {
    applySearch(debounced)
  }, [debounced])

  const [attempt, setAttempt] = useState(0)
  const [list, setList] = useState<ListState | null>(null)
  const [more, setMore] = useState<{ key: string; failed: boolean } | null>(null)
  const key = `${category}|${q}|${attempt}`

  const announceResults = useEffectEvent((count: number) => {
    if (q) announce(t('catalog.found', { count }))
  })
  useEffect(() => {
    const controller = new AbortController()
    api
      .getProducts({ category: category || undefined, search: q || undefined }, controller.signal)
      .then(
        (page) => {
          setList({
            key,
            items: page.results,
            count: page.count,
            page: 1,
            hasMore: page.next !== null,
          })
          announceResults(page.count)
        },
        (error: unknown) => {
          if (isAbortError(error)) return
          setList({ key, items: [], count: 0, page: 1, hasMore: false, error })
        },
      )
    return () => controller.abort()
  }, [key, category, q])

  const loading = list?.key !== key
  const loadingMore = more?.key === key && !more.failed

  async function loadMore() {
    if (!list || list.key !== key || loadingMore) return
    setMore({ key, failed: false })
    try {
      const page = await api.getProducts({
        category: category || undefined,
        search: q || undefined,
        page: list.page + 1,
      })
      setList((previous) =>
        previous && previous.key === key
          ? {
              ...previous,
              items: dedupe([...previous.items, ...page.results]),
              count: page.count,
              page: previous.page + 1,
              hasMore: page.next !== null,
            }
          : previous,
      )
      setMore(null)
    } catch {
      setMore({ key, failed: true })
    }
  }

  const setCategory = (slug: string) => navigate(catalogRoute(slug, q), { replace: true })
  const resetFilters = () => {
    setInput('')
    navigate(catalogRoute(), { replace: true })
  }

  const visibleCategories = (categories.data ?? []).filter((row) => row.product_count > 0)
  const topLevel = visibleCategories.filter(
    (row) => row.parent === null || !visibleCategories.some((other) => other.id === row.parent),
  )
  const selected = visibleCategories.find((row) => row.slug === category)
  const selectedTop = selected
    ? (topLevel.find((row) => row.id === selected.parent) ?? selected)
    : undefined
  const children = selectedTop
    ? visibleCategories.filter((row) => row.parent === selectedTop.id)
    : []

  const items = list?.items ?? []
  const showSkeleton = loading && items.length === 0
  const error = !loading ? list?.error : undefined

  return (
    <>
      <Hero />
      <section id="catalog" className="catalog container" aria-labelledby="catalog-title">
        <div className="catalog__head">
          <h2 id="catalog-title" className="section-title">
            {t('catalog.title')}
          </h2>
          <form className="search" role="search" onSubmit={(event) => event.preventDefault()}>
            <label htmlFor="catalog-search" className="visually-hidden">
              {t('catalog.searchLabel')}
            </label>
            <Search className="search__icon" aria-hidden="true" />
            <input
              id="catalog-search"
              className="search__input"
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t('catalog.searchPlaceholder')}
              autoComplete="off"
              enterKeyHint="search"
              maxLength={100}
            />
            {input && (
              <button
                type="button"
                className="search__clear"
                onClick={() => setInput('')}
                aria-label={t('catalog.clearSearch')}
              >
                <X aria-hidden="true" />
              </button>
            )}
          </form>
        </div>

        {topLevel.length > 0 && (
          <CategoryChips
            label={t('catalog.categories')}
            allLabel={t('catalog.all')}
            categories={topLevel}
            activeSlug={selectedTop?.slug ?? (selected ? '' : category)}
            onSelect={setCategory}
            name={name}
          />
        )}
        {children.length > 0 && selectedTop && (
          <CategoryChips
            label={name(selectedTop)}
            allLabel={t('catalog.all')}
            categories={children}
            activeSlug={category === selectedTop.slug ? '' : category}
            onSelect={(slug) => setCategory(slug || selectedTop.slug)}
            name={name}
            secondary
          />
        )}

        {q && !loading && !error && items.length > 0 && (
          <p className="catalog__count">{t('catalog.found', { count: list?.count ?? 0 })}</p>
        )}

        {error ? (
          <div className="state-panel">
            <Notice
              tone="danger"
              role="alert"
              title={t('catalog.error')}
              action={
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  {t('common.retry')}
                </button>
              }
            >
              <p>{t('catalog.errorHint')}</p>
            </Notice>
          </div>
        ) : showSkeleton ? (
          <ul
            className="product-grid"
            role="list"
            aria-busy="true"
            aria-label={t('catalog.loading')}
          >
            {Array.from({ length: SKELETON_COUNT }, (_, index) => (
              <li key={index}>
                <ProductCardSkeleton />
              </li>
            ))}
          </ul>
        ) : items.length === 0 && !loading ? (
          <div className="state-panel state-panel--empty">
            <span className="empty-illustration" aria-hidden="true">
              <SearchX strokeWidth={1.5} />
            </span>
            <p className="state-panel__title">{t('catalog.empty')}</p>
            <p className="muted">
              {q ? t('catalog.emptySearch', { query: q }) : t('catalog.emptyCategory')}
            </p>
            {(q || category) && (
              <button type="button" className="btn btn--outline" onClick={resetFilters}>
                {t('catalog.reset')}
              </button>
            )}
          </div>
        ) : (
          <>
            <ul
              className={`product-grid${loading ? ' product-grid--stale' : ''}`}
              role="list"
              aria-busy={loading}
            >
              {items.map((product) => (
                <li key={product.id}>
                  <ProductCard product={product} />
                </li>
              ))}
            </ul>
            {list && list.key === key && (list.hasMore || more?.failed) && (
              <div className="load-more">
                <p className="load-more__count">
                  {t('catalog.shown', { shown: items.length, total: list.count })}
                </p>
                {more?.key === key && more.failed && (
                  <p className="load-more__error" role="alert">
                    {t('catalog.loadMoreError')}
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn--outline btn--lg"
                  onClick={loadMore}
                  aria-disabled={loadingMore || undefined}
                >
                  {loadingMore
                    ? t('catalog.loadingMore')
                    : more?.failed
                      ? t('common.retry')
                      : t('catalog.loadMore')}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  )
}

interface CategoryChipsProps {
  label: string
  allLabel: string
  categories: Category[]
  activeSlug: string
  onSelect: (slug: string) => void
  name: (item: Category) => string
  secondary?: boolean
}

function CategoryChips({
  label,
  allLabel,
  categories,
  activeSlug,
  onSelect,
  name,
  secondary,
}: CategoryChipsProps) {
  const options = [{ slug: '', label: allLabel }].concat(
    categories.map((row) => ({ slug: row.slug, label: name(row) })),
  )
  return (
    <ul className={`chips${secondary ? ' chips--secondary' : ''}`} role="list" aria-label={label}>
      {options.map((option) => (
        <li key={option.slug || 'all'}>
          <button
            type="button"
            className="chip"
            aria-pressed={option.slug === activeSlug}
            onClick={(event) => {
              onSelect(option.slug)
              event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })
            }}
          >
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  )
}
