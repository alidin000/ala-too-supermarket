import { ArrowLeft, Bike, CircleAlert, Pencil, Phone, Store } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useAnnounce } from '../../a11y/announce'
import { isAbortError } from '../../api/errors'
import { CopyButton } from '../../components/CopyButton'
import { Link } from '../../components/Link'
import { Notice } from '../../components/Notice'
import { formatMoney, toMinor } from '../../lib/money'
import { displayPhone, telHref } from '../../lib/phone'
import { cancelReasonError, CANCEL_REASON_MAX, orderActions } from '../actions'
import type { OrderAction } from '../actions'
import { isStaffApiError } from '../api'
import { staffApi } from '../client'
import { PaymentBadge, StatusBadge } from '../components/Badges'
import { StaffDialog } from '../components/StaffDialog'
import { Forbidden, LoadError, StaffNotFound } from '../components/StatePanels'
import { useStaff } from '../context'
import { absoluteTime, errorMessage, generalErrors } from '../format'
import { REFRESH_MS, useNow, useStaffTitle, useVisibleInterval } from '../hooks'
import { ORDER_STATUSES, PAYMENT_STATUSES } from '../labels'
import { lastBoardHref } from '../routes'
import { S } from '../strings'
import type { OrderEvent, OrderPatch, StaffOrderDetail } from '../types'

interface LoadState {
  number: string
  order?: StaffOrderDetail
  error?: unknown
}

const actionKey = (action: OrderAction) =>
  action.kind === 'cancel' ? 'cancel' : `${action.kind}:${action.to}`

export function OrderDetail({ number }: { number: string }) {
  useStaffTitle(S.order.title(number))
  const { user, refreshSummary } = useStaff()
  const announce = useAnnounce()
  const canView = user.permissions.view_orders
  const now = useNow()

  const [tick, setTick] = useState(0)
  const [state, setState] = useState<LoadState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<unknown>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const actionsHeading = useRef<HTMLHeadingElement>(null)
  // Results of a refresh that started before the last action are stale; drop them.
  const actionSeq = useRef(0)

  useEffect(() => {
    if (!canView) return
    const controller = new AbortController()
    const seq = actionSeq.current
    staffApi.getOrder(number, controller.signal).then(
      (order) => {
        if (seq === actionSeq.current) setState({ number, order })
      },
      (error: unknown) => {
        if (isAbortError(error) || seq !== actionSeq.current) return
        setState((previous) => ({
          number,
          // A failed background refresh keeps showing the last good data.
          order: previous?.number === number ? previous.order : undefined,
          error,
        }))
      },
    )
    return () => controller.abort()
  }, [number, tick, canView])

  const refresh = useCallback(() => setTick((value) => value + 1), [])
  const autoRefresh = useCallback(() => {
    if (busy === null && !cancelOpen) refresh()
  }, [busy, cancelOpen, refresh])
  useVisibleInterval(autoRefresh, REFRESH_MS, canView)

  const current = state?.number === number ? state : null
  const order = current?.order

  const applyResult = useCallback(
    (next: StaffOrderDetail) => {
      actionSeq.current += 1
      setState({ number, order: next })
      refreshSummary()
    },
    [number, refreshSummary],
  )

  const focusActions = () => window.requestAnimationFrame(() => actionsHeading.current?.focus())

  async function run(action: OrderAction) {
    if (busy !== null) return
    if (action.kind === 'cancel') {
      setActionError(null)
      setCancelOpen(true)
      return
    }
    setBusy(actionKey(action))
    setActionError(null)
    try {
      const next =
        action.kind === 'status'
          ? await staffApi.changeStatus(number, action.to)
          : await staffApi.changePayment(number, action.to)
      applyResult(next)
      announce(
        action.kind === 'status'
          ? S.order.statusChanged(number, S.status[next.status])
          : S.order.paymentChanged(number, S.payment[next.payment_status]),
      )
      focusActions()
    } catch (error) {
      setActionError(error)
      announce(`${S.order.actionFailed}: ${errorMessage(error)}`)
    } finally {
      setBusy(null)
    }
  }

  const backLink = (
    <Link to={lastBoardHref()} className="back-link">
      <ArrowLeft aria-hidden="true" />
      {S.order.back}
    </Link>
  )
  const title = (
    <h1 className="page-title staff-page__title" tabIndex={-1}>
      {S.order.title(number)}
    </h1>
  )

  // One layout for every state, so the <h1> keeps its DOM node (and the focus that a page
  // change put on it) when the data arrives.
  const forbidden = !canView || isStaffApiError(current?.error, 'forbidden')
  const head = (
    <div className="staff-order__head">
      {title}
      {order && !forbidden && (
        <>
          <div className="staff-order__badges">
            <StatusBadge status={order.status} />
            <PaymentBadge status={order.payment_status} method={order.payment_method} />
          </div>
          <p className="staff-order__meta muted">
            <span>{S.order.created(absoluteTime(order.created_at, now))}</span>
            <span className="staff-fulfillment">
              {order.fulfillment === 'delivery' ? (
                <Bike aria-hidden="true" />
              ) : (
                <Store aria-hidden="true" />
              )}
              {S.fulfillment[order.fulfillment]} · {S.order.itemsCount(order.items_count)}
            </span>
            <span className="staff-order__total">{formatMoney(order.total)}</span>
          </p>
        </>
      )}
    </div>
  )

  let content: ReactNode
  if (forbidden) {
    content = <Forbidden />
  } else if (!order) {
    content = !current?.error ? (
      <div className="staff-skeleton" aria-busy="true">
        <span className="visually-hidden">{S.loading}</span>
        <span className="skeleton skeleton--block" />
        <span className="skeleton skeleton--block" />
      </div>
    ) : isStaffApiError(current.error, 'not_found') ? (
      <StaffNotFound title={S.order.notFound} text={S.order.notFoundHint} />
    ) : (
      <LoadError title={S.order.loadError} error={current.error} onRetry={refresh} />
    )
  } else {
    const actions = orderActions(order, user.permissions)
    const statusActions = actions.filter((action) => action.kind === 'status')
    const paymentActions = actions.filter((action) => action.kind === 'payment')
    const cancelAction = actions.find((action) => action.kind === 'cancel')
    const canChange = user.permissions.change_orders
    const actionMessages = actionError ? generalErrors(actionError, []) : []

    const button = (action: OrderAction) => {
      const toneClass =
        action.tone === 'primary'
          ? 'btn--primary'
          : action.tone === 'soft'
            ? 'btn--soft'
            : action.tone === 'danger'
              ? 'btn--danger-outline'
              : 'btn--outline'
      const running = busy === actionKey(action)
      return (
        <button
          key={actionKey(action)}
          type="button"
          className={`btn ${toneClass}`}
          disabled={busy !== null && !running}
          aria-disabled={running || undefined}
          aria-busy={running || undefined}
          aria-haspopup={action.kind === 'cancel' ? 'dialog' : undefined}
          onClick={() => run(action)}
        >
          {running ? S.loading : action.label}
        </button>
      )
    }

    content = (
      <>
        <section className="order-card staff-actions" aria-labelledby="order-actions-title">
          <h2
            id="order-actions-title"
            ref={actionsHeading}
            className="order-card__title"
            tabIndex={-1}
          >
            {S.order.actions}
          </h2>
          {!canChange ? (
            <p className="muted">{S.order.readOnly}</p>
          ) : actions.length === 0 ? (
            <p className="muted">{S.order.noActions}</p>
          ) : (
            <div className="staff-actions__groups">
              {statusActions.length > 0 && (
                <div className="staff-actions__group" role="group" aria-label={S.order.statusGroup}>
                  {statusActions.map(button)}
                </div>
              )}
              {paymentActions.length > 0 && (
                <div
                  className="staff-actions__group"
                  role="group"
                  aria-label={S.order.paymentGroup}
                >
                  {paymentActions.map(button)}
                </div>
              )}
              {cancelAction && <div className="staff-actions__group">{button(cancelAction)}</div>}
            </div>
          )}
          {actionMessages.length > 0 && (
            <Notice tone="danger" role="alert" title={S.order.actionFailed}>
              {actionMessages.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </Notice>
          )}
        </section>

        <div className="order-grid">
          <div className="staff-order__col">
            <CustomerCard order={order} canEdit={canChange} onSaved={applyResult} />
            <ItemsCard order={order} />
          </div>
          <div className="staff-order__col">
            <PaymentCard order={order} />
            <section className="order-card" aria-labelledby="tracking-title">
              <h2 id="tracking-title" className="order-card__title">
                {S.order.tracking}
              </h2>
              <p className="muted staff-small">{S.order.trackingHint}</p>
              <div>
                <CopyButton
                  value={new URL(order.tracking_path, window.location.origin).href}
                  label={S.order.copyTracking}
                  showLabel
                />
              </div>
            </section>
            <Journal events={order.events} now={now} />
          </div>
        </div>
        <p className="staff-hint muted">{S.order.autoRefresh}</p>

        <CancelDialog
          open={cancelOpen}
          number={number}
          onClose={() => setCancelOpen(false)}
          onCancelled={(next) => {
            setCancelOpen(false)
            applyResult(next)
            announce(S.order.cancelled(number))
            focusActions()
          }}
        />
      </>
    )
  }

  return (
    <div className="container page staff-page staff-order">
      {backLink}
      {head}
      {content}
    </div>
  )
}

// --- Customer block and inline edit ------------------------------------------------------

const EDIT_FIELDS = ['customer_name', 'phone', 'address', 'staff_note'] as const
type EditField = (typeof EDIT_FIELDS)[number]
type EditDraft = Record<EditField, string>

function draftOf(order: StaffOrderDetail): EditDraft {
  return {
    customer_name: order.customer_name,
    phone: order.phone,
    address: order.address,
    staff_note: order.staff_note,
  }
}

function CustomerCard({
  order,
  canEdit,
  onSaved,
}: {
  order: StaffOrderDetail
  canEdit: boolean
  onSaved: (order: StaffOrderDetail) => void
}) {
  const announce = useAnnounce()
  const [draft, setDraft] = useState<EditDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const editButton = useRef<HTMLButtonElement>(null)
  const firstField = useRef<HTMLInputElement>(null)
  const formId = useId()

  const close = () => {
    setDraft(null)
    setError(null)
    window.requestAnimationFrame(() => editButton.current?.focus())
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || saving) return
    const saved = draftOf(order)
    const patch: OrderPatch = {}
    for (const field of EDIT_FIELDS) {
      if (field === 'address' && order.fulfillment !== 'delivery') continue
      const value = field === 'staff_note' ? draft[field] : draft[field].trim()
      if (value !== saved[field]) patch[field] = value
    }
    if (Object.keys(patch).length === 0) {
      close()
      return
    }
    setSaving(true)
    setError(null)
    try {
      const next = await staffApi.updateOrder(order.number, patch)
      onSaved(next)
      announce(S.order.saved)
      close()
    } catch (reason) {
      setError(reason)
    } finally {
      setSaving(false)
    }
  }

  const fieldErrors = isStaffApiError(error, 'validation') ? error.fieldErrors : {}
  const otherErrors = generalErrors(error, EDIT_FIELDS)
  const phone = order.phone ? displayPhone(order.phone) : ''

  if (draft) {
    const field = (
      name: EditField,
      label: string,
      control: (props: {
        id: string
        'aria-invalid'?: boolean
        'aria-describedby'?: string
      }) => ReactNode,
      hint?: string,
    ) => {
      const id = `${formId}-${name}`
      const message = fieldErrors[name]?.join(' ')
      const describedBy =
        [hint ? `${id}-hint` : '', message ? `${id}-error` : ''].filter(Boolean).join(' ') ||
        undefined
      return (
        <div className={`field${message ? ' field--invalid' : ''}`}>
          <label className="field__label" htmlFor={id}>
            {label}
          </label>
          {control({
            id,
            'aria-invalid': message ? true : undefined,
            'aria-describedby': describedBy,
          })}
          {hint && (
            <p id={`${id}-hint`} className="field__hint">
              {hint}
            </p>
          )}
          {message && (
            <p id={`${id}-error`} className="field__error">
              <CircleAlert aria-hidden="true" />
              {message}
            </p>
          )}
        </div>
      )
    }
    const update = (name: EditField) => (value: string) =>
      setDraft((previous) => (previous ? { ...previous, [name]: value } : previous))

    return (
      <section className="order-card" aria-labelledby="customer-title">
        <h2 id="customer-title" className="order-card__title">
          {S.order.editTitle}
        </h2>
        <form className="staff-edit" noValidate onSubmit={save}>
          {otherErrors.length > 0 && (
            <Notice tone="danger" role="alert">
              {otherErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </Notice>
          )}
          {field('customer_name', S.order.nameLabel, (props) => (
            <input
              {...props}
              ref={firstField}
              className="input"
              autoComplete="off"
              maxLength={160}
              value={draft.customer_name}
              onChange={(event) => update('customer_name')(event.target.value)}
            />
          ))}
          {field(
            'phone',
            S.order.phone,
            (props) => (
              <input
                {...props}
                className="input"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={draft.phone}
                onChange={(event) => update('phone')(event.target.value)}
              />
            ),
            S.order.phoneHint,
          )}
          {order.fulfillment === 'delivery' &&
            field('address', S.order.address, (props) => (
              <textarea
                {...props}
                className="input input--area"
                rows={2}
                value={draft.address}
                onChange={(event) => update('address')(event.target.value)}
              />
            ))}
          {field(
            'staff_note',
            S.order.staffNote,
            (props) => (
              <textarea
                {...props}
                className="input input--area"
                rows={3}
                maxLength={2000}
                value={draft.staff_note}
                onChange={(event) => update('staff_note')(event.target.value)}
              />
            ),
            S.order.staffNoteHint,
          )}
          <div className="staff-edit__actions">
            <button type="submit" className="btn btn--primary" aria-disabled={saving || undefined}>
              {saving ? S.order.saving : S.order.save}
            </button>
            <button type="button" className="btn btn--outline" onClick={close}>
              {S.order.cancelEdit}
            </button>
          </div>
        </form>
      </section>
    )
  }

  return (
    <section className="order-card" aria-labelledby="customer-title">
      <div className="staff-card-head">
        <h2 id="customer-title" className="order-card__title">
          {S.order.customer}
        </h2>
        {canEdit && (
          <button
            ref={editButton}
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              setDraft(draftOf(order))
              window.requestAnimationFrame(() => firstField.current?.focus())
            }}
          >
            <Pencil aria-hidden="true" />
            {S.order.edit}
          </button>
        )}
      </div>
      <dl className="staff-dl">
        <div>
          <dt>{S.order.name}</dt>
          <dd className="staff-strong">{order.customer_name}</dd>
        </div>
        <div>
          <dt>{S.order.phone}</dt>
          <dd className="staff-phone">
            {phone ? (
              <>
                <a className="btn btn--soft btn--sm staff-call" href={telHref(order.phone)}>
                  <Phone aria-hidden="true" />
                  <span>
                    <span className="visually-hidden">{S.order.call} </span>
                    {phone}
                  </span>
                </a>
                <CopyButton value={phone} label={S.order.copyPhone} />
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>{order.fulfillment === 'delivery' ? S.order.address : S.fulfillment.pickup}</dt>
          <dd>{order.fulfillment === 'delivery' ? order.address || '—' : S.order.pickup}</dd>
        </div>
        <div>
          <dt>{S.order.customerNote}</dt>
          <dd className={order.customer_note ? 'staff-note' : 'muted'}>
            {order.customer_note || S.order.noCustomerNote}
          </dd>
        </div>
        <div>
          <dt>{S.order.staffNote}</dt>
          <dd className={order.staff_note ? 'staff-note staff-note--staff' : 'muted'}>
            {order.staff_note || S.order.noStaffNote}
          </dd>
        </div>
      </dl>
    </section>
  )
}

// --- Items, payment, journal -------------------------------------------------------------

function ItemsCard({ order }: { order: StaffOrderDetail }) {
  const fee = toMinor(order.delivery_fee)
  return (
    <section className="order-card" aria-labelledby="items-title">
      <h2 id="items-title" className="order-card__title">
        {S.order.items}
      </h2>
      <div className="staff-table-wrap">
        <table className="staff-table staff-table--items">
          <caption className="visually-hidden">{S.order.itemsCaption}</caption>
          <thead>
            <tr>
              <th scope="col">{S.order.product}</th>
              <th scope="col" className="staff-table__num">
                {S.order.quantity}
              </th>
              <th scope="col" className="staff-table__num staff-table__price">
                {S.order.price}
              </th>
              <th scope="col" className="staff-table__num">
                {S.order.lineTotal}
              </th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, index) => (
              <tr key={`${item.product_id ?? 'x'}-${index}`}>
                <th scope="row">
                  <span className="staff-item__name">{item.product_name}</span>
                  <span className="staff-item__meta muted">
                    {item.sku} · {item.unit}
                  </span>
                  <span className="staff-item__each muted">
                    {item.quantity} × {formatMoney(item.unit_price)}
                  </span>
                </th>
                <td className="staff-table__num">{item.quantity}</td>
                <td className="staff-table__num staff-table__price">
                  {formatMoney(item.unit_price)}
                </td>
                <td className="staff-table__num">{formatMoney(item.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="totals">
        <div className="totals__row">
          <dt>{S.order.subtotal}</dt>
          <dd>{formatMoney(order.subtotal)}</dd>
        </div>
        <div className="totals__row">
          <dt>{S.order.deliveryFee}</dt>
          <dd>{fee === 0 ? S.order.free : formatMoney(order.delivery_fee)}</dd>
        </div>
        <div className="totals__row totals__row--grand">
          <dt>{S.order.total}</dt>
          <dd>{formatMoney(order.total)}</dd>
        </div>
      </dl>
    </section>
  )
}

function PaymentCard({ order }: { order: StaffOrderDetail }) {
  return (
    <section className="order-card" aria-labelledby="payment-title">
      <h2 id="payment-title" className="order-card__title">
        {S.order.payment}
      </h2>
      <dl className="staff-dl">
        <div>
          <dt>{S.order.paymentMethod}</dt>
          <dd>{S.method[order.payment_method]}</dd>
        </div>
        <div>
          <dt>{S.order.paymentStatus}</dt>
          <dd>
            <PaymentBadge status={order.payment_status} />
          </dd>
        </div>
        <div>
          <dt>{S.order.paymentReference}</dt>
          <dd className={order.payment_reference ? 'staff-strong' : 'muted'}>
            {order.payment_reference || S.order.noReference}
          </dd>
        </div>
      </dl>
    </section>
  )
}

function labelFor(kind: OrderEvent['kind'], value: string | null): string {
  if (!value) return '—'
  if (kind === 'status' && (ORDER_STATUSES as readonly string[]).includes(value)) {
    return S.status[value as (typeof ORDER_STATUSES)[number]]
  }
  if (kind === 'payment' && (PAYMENT_STATUSES as readonly string[]).includes(value)) {
    return S.payment[value as (typeof PAYMENT_STATUSES)[number]]
  }
  return value
}

function eventActor(event: OrderEvent): string {
  if (event.actor) return event.actor
  return event.kind === 'created' || event.kind === 'payment_reported'
    ? S.order.customerActor
    : S.order.system
}

function Journal({ events, now }: { events: OrderEvent[]; now: number }) {
  return (
    <section className="order-card" aria-labelledby="journal-title">
      <h2 id="journal-title" className="order-card__title">
        {S.order.journal}
      </h2>
      {events.length === 0 ? (
        <p className="muted">{S.order.journalEmpty}</p>
      ) : (
        <ol className="staff-journal">
          {events.map((event, index) => {
            const change =
              (event.kind === 'status' || event.kind === 'payment') && (event.from || event.to)
                ? S.order.eventChange(
                    labelFor(event.kind, event.from),
                    labelFor(event.kind, event.to),
                  )
                : null
            return (
              <li
                key={`${event.at}-${index}`}
                className={`staff-journal__item staff-journal__item--${event.kind}`}
              >
                <span className="staff-journal__dot" aria-hidden="true" />
                <div className="staff-journal__body">
                  <p className="staff-journal__title">
                    {S.event[event.kind] ?? event.kind}
                    {change && <span className="staff-journal__change">: {change}</span>}
                  </p>
                  {event.message && <p className="staff-journal__message">{event.message}</p>}
                  <p className="staff-journal__meta muted">
                    <time dateTime={event.at}>{absoluteTime(event.at, now)}</time> ·{' '}
                    {eventActor(event)}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// --- Cancel dialog -----------------------------------------------------------------------

function CancelDialog({
  open,
  number,
  onClose,
  onCancelled,
}: {
  open: boolean
  number: string
  onClose: () => void
  onCancelled: (order: StaffOrderDetail) => void
}) {
  const [reason, setReason] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<unknown>(null)
  const [sending, setSending] = useState(false)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  // Start empty every time the dialog opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setReason('')
      setClientError(null)
      setServerError(null)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending) return
    const problem = cancelReasonError(reason)
    if (problem) {
      setClientError(problem)
      reasonRef.current?.focus()
      return
    }
    setClientError(null)
    setServerError(null)
    setSending(true)
    try {
      onCancelled(await staffApi.cancelOrder(number, reason.trim()))
    } catch (error) {
      setServerError(error)
      reasonRef.current?.focus()
    } finally {
      setSending(false)
    }
  }

  const serverFieldError = isStaffApiError(serverError, 'validation')
    ? serverError.fieldErrors.reason?.join(' ')
    : undefined
  const reasonError = clientError ?? serverFieldError
  const otherErrors = generalErrors(serverError, ['reason'])

  return (
    <StaffDialog open={open} onClose={onClose} labelledBy="cancel-title">
      <form className="staff-dialog__form" noValidate onSubmit={submit}>
        <div className="staff-dialog__body">
          <h2 id="cancel-title" className="staff-dialog__title">
            {S.cancelDialog.title(number)}
          </h2>
          <p>{S.cancelDialog.text}</p>
          {otherErrors.length > 0 && (
            <Notice tone="danger" role="alert">
              {otherErrors.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </Notice>
          )}
          <div className={`field${reasonError ? ' field--invalid' : ''}`}>
            <label className="field__label" htmlFor="cancel-reason">
              {S.cancelDialog.reason}
            </label>
            <textarea
              ref={reasonRef}
              id="cancel-reason"
              className="input input--area"
              rows={3}
              maxLength={CANCEL_REASON_MAX}
              required
              data-autofocus
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={
                reasonError ? 'cancel-reason-hint cancel-reason-error' : 'cancel-reason-hint'
              }
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <p id="cancel-reason-hint" className="field__hint">
              {S.cancelDialog.reasonHint}
            </p>
            {reasonError && (
              <p id="cancel-reason-error" className="field__error" role="alert">
                <CircleAlert aria-hidden="true" />
                {reasonError}
              </p>
            )}
          </div>
        </div>
        <div className="staff-dialog__actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {S.cancelDialog.keep}
          </button>
          <button type="submit" className="btn btn--danger" aria-disabled={sending || undefined}>
            {sending ? S.cancelDialog.confirming : S.cancelDialog.confirm}
          </button>
        </div>
      </form>
    </StaffDialog>
  )
}
