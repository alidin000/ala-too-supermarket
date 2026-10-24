import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDebouncedValue } from '../../lib/hooks'

interface SearchFieldProps {
  id: string
  label: string
  placeholder: string
  clearLabel: string
  /** The applied value, from the URL. */
  value: string
  onSearch: (value: string) => void
}

/** The storefront search box: typing applies after a short pause; Enter applies at once. */
export function SearchField({
  id,
  label,
  placeholder,
  clearLabel,
  value,
  onSearch,
}: SearchFieldProps) {
  const [text, setText] = useState(value)
  const debounced = useDebouncedValue(text, 350)
  const inputRef = useRef<HTMLInputElement>(null)
  const applied = useRef(value)

  // Follow the URL when it changes from outside (back/forward, "reset filters").
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    if (value !== text.trim()) setText(value)
  }

  useEffect(() => {
    const next = debounced.trim()
    if (next === applied.current) return
    applied.current = next
    onSearch(next)
  }, [debounced, onSearch])

  useEffect(() => {
    applied.current = value
  }, [value])

  return (
    <form
      className="search staff-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault()
        const next = text.trim()
        applied.current = next
        onSearch(next)
      }}
    >
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <Search className="search__icon" aria-hidden="true" />
      <input
        ref={inputRef}
        id={id}
        className="search__input"
        type="search"
        inputMode="search"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {text && (
        <button
          type="button"
          className="search__clear"
          aria-label={clearLabel}
          onClick={() => {
            setText('')
            applied.current = ''
            onSearch('')
            inputRef.current?.focus()
          }}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </form>
  )
}
