// Every string of the staff panel, in Russian. The staff UI does not follow the customer
// language switch. To add Kyrgyz later, copy `ru` to `ky: StaffStrings`, translate it, and
// choose the dictionary where `S` is defined at the bottom of this file.

import type { BoardTab } from './boardQuery'
import type { DraftErrorCode } from './productEdit'
import type {
  Badge,
  Fulfillment,
  OrderEventKind,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  StockFilter,
} from './types'

const pluralRules = new Intl.PluralRules('ru')

/** Russian plural: plural(5, ['минута', 'минуты', 'минут']) -> "минут". */
export function plural(count: number, [one, few, many]: readonly [string, string, string]): string {
  const form = pluralRules.select(count)
  if (form === 'one') return one
  if (form === 'few') return few
  return many
}

const MINUTES = ['минуту', 'минуты', 'минут'] as const
const SECONDS = ['секунду', 'секунды', 'секунд'] as const
const ORDERS = ['заказ', 'заказа', 'заказов'] as const
const ITEMS = ['товар', 'товара', 'товаров'] as const

/** "через 15 минут" / "через 40 секунд", rounded up so a wait is never understated. */
export function waitPhrase(seconds: number): string {
  if (seconds < 60) {
    const value = Math.max(1, Math.ceil(seconds))
    return `через ${value} ${plural(value, SECONDS)}`
  }
  const minutes = Math.ceil(seconds / 60)
  return `через ${minutes} ${plural(minutes, MINUTES)}`
}

export const ru = {
  brand: 'Ала-Тоо',
  brandAccent: 'Маркет',
  area: 'Персонал',
  titleSuffix: 'Ала-Тоо',
  skip: 'Перейти к содержимому',
  home: 'Ала-Тоо Маркет, панель персонала',
  loading: 'Загружаем…',

  nav: {
    label: 'Разделы',
    orders: 'Заказы',
    products: 'Товары',
    newOrders: (count: number) => `${count} ${plural(count, ['новый', 'новых', 'новых'])}`,
    advanced: 'Расширенные настройки',
    logout: 'Выйти',
    loggingOut: 'Выходим…',
    signedInAs: (name: string) => `Вы вошли как ${name}`,
    userMenu: 'Учётная запись',
  },

  store: {
    switchLabel: 'Принимаем заказы',
    on: 'Заказы принимаются',
    paused: 'Приём заказов на паузе',
    onButClosed: 'Включено, но сейчас магазин закрыт для заказов',
    confirmTitle: 'Приостановить приём заказов?',
    confirmText:
      'Покупатели увидят, что магазин сейчас не принимает заказы, и не смогут оформить новый. Уже принятые заказы не изменятся.',
    confirmPause: 'Приостановить',
    keepOpen: 'Не приостанавливать',
    pausedAnnounce: 'Приём заказов приостановлен',
    resumedAnnounce: 'Приём заказов возобновлён',
    error: 'Не удалось переключить приём заказов.',
  },

  login: {
    title: 'Вход для сотрудников',
    lead: 'Панель управления заказами и товарами магазина.',
    username: 'Логин',
    password: 'Пароль',
    showPassword: 'Показать пароль',
    hidePassword: 'Скрыть пароль',
    submit: 'Войти',
    submitting: 'Входим…',
    failed: 'Неверный логин или пароль.',
    lockedTitle: 'Вход временно заблокирован',
    locked: (seconds: number) => `Слишком много попыток входа. Попробуйте ${waitPhrase(seconds)}.`,
    lockedHint: 'Это защита от подбора пароля. Если забыли пароль, обратитесь к владельцу.',
    required: 'Введите логин и пароль.',
    demoTitle: 'Демо-доступ',
  },

  board: {
    title: 'Заказы',
    tabsLabel: 'Статус заказа',
    tabs: {
      active: 'Активные',
      new: 'Новые',
      confirmed: 'Подтверждённые',
      preparing: 'Собираем',
      ready: 'Готовы к выдаче',
      out_for_delivery: 'Курьер в пути',
      completed: 'Выполненные',
      cancelled: 'Отменённые',
      all: 'Все',
    } satisfies Record<BoardTab, string>,
    tabWithCount: (label: string, count: number) => `${label}: ${count}`,
    paymentChip: 'Ожидают проверки оплаты',
    searchLabel: 'Поиск по номеру, телефону или имени',
    searchPlaceholder: 'AT-000123, 0555 123 456, Айгерим',
    clearSearch: 'Очистить поиск',
    refresh: 'Обновить',
    updatedAt: (time: string) => `Обновлено в ${time}`,
    autoRefresh: 'Список обновляется каждые 20 секунд.',
    loadMore: 'Показать ещё',
    loadingMore: 'Загружаем…',
    shown: (shown: number, total: number) => `Показано ${shown} из ${total}`,
    emptyTitle: 'Заказов нет',
    emptyActive: 'Активных заказов сейчас нет. Новые появятся здесь сами.',
    emptyFiltered: 'По этим условиям заказов нет.',
    resetFilters: 'Сбросить фильтры',
    loadError: 'Не удалось загрузить заказы',
    loadMoreError: 'Не удалось загрузить следующие заказы.',
    refreshError: 'Не удалось обновить список. Показаны прежние данные.',
    unseen: 'Новое с прошлого просмотра',
    arrived: (count: number, numbers: string) =>
      count === 1
        ? `Новый заказ ${numbers}`
        : `${count} ${plural(count, ['новый заказ', 'новых заказа', 'новых заказов'])}: ${numbers}`,
    columns: {
      number: 'Заказ',
      time: 'Время',
      customer: 'Клиент',
      phone: 'Телефон',
      fulfillment: 'Получение',
      total: 'Сумма',
      status: 'Статус',
      payment: 'Оплата',
    },
    tableCaption: 'Список заказов',
    itemsCount: (count: number) => `${count} ${plural(count, ITEMS)}`,
    call: (phone: string) => `Позвонить ${phone}`,
    openOrder: (number: string) => `Открыть заказ ${number}`,
  },

  order: {
    title: (number: string) => `Заказ ${number}`,
    back: 'Все заказы',
    created: (time: string) => `Создан ${time}`,
    actions: 'Действия',
    readOnly: 'У вас доступ только для просмотра заказов.',
    noActions: 'Для этого заказа действий больше нет.',
    statusGroup: 'Статус заказа',
    paymentGroup: 'Оплата',
    cancel: 'Отменить заказ',
    customer: 'Клиент',
    name: 'Имя',
    phone: 'Телефон',
    copyPhone: 'Скопировать телефон',
    call: 'Позвонить',
    address: 'Адрес доставки',
    pickup: 'Самовывоз из магазина',
    customerNote: 'Комментарий клиента',
    noCustomerNote: 'Клиент ничего не написал.',
    staffNote: 'Заметка персонала',
    noStaffNote: 'Заметки нет.',
    staffNoteHint: 'Видна только сотрудникам.',
    edit: 'Изменить данные',
    editTitle: 'Данные заказа',
    save: 'Сохранить',
    saving: 'Сохраняем…',
    cancelEdit: 'Отмена',
    saved: 'Данные заказа сохранены',
    items: 'Товары',
    itemsCaption: 'Товары в заказе',
    product: 'Товар',
    quantity: 'Кол-во',
    price: 'Цена',
    lineTotal: 'Сумма',
    subtotal: 'Товары',
    deliveryFee: 'Доставка',
    total: 'Итого',
    free: 'Бесплатно',
    payment: 'Оплата',
    paymentMethod: 'Способ',
    paymentStatus: 'Статус',
    paymentReference: 'Комментарий к переводу',
    noReference: 'Нет',
    tracking: 'Ссылка для клиента',
    trackingHint: 'По этой ссылке клиент видит статус заказа. Не публикуйте её.',
    copyTracking: 'Скопировать ссылку',
    journal: 'Журнал',
    journalEmpty: 'Событий пока нет.',
    system: 'Система',
    loadError: 'Не удалось загрузить заказ',
    notFound: 'Заказ не найден',
    notFoundHint: 'Проверьте номер. Возможно, ссылка устарела.',
    statusChanged: (number: string, label: string) => `Заказ ${number}: ${label}`,
    paymentChanged: (number: string, label: string) => `Оплата заказа ${number}: ${label}`,
    cancelled: (number: string) => `Заказ ${number} отменён`,
    actionFailed: 'Действие не выполнено',
    customerActor: 'Клиент',
    eventChange: (from: string, to: string) => `${from} → ${to}`,
    itemsCount: (count: number) => `${count} ${plural(count, ITEMS)}`,
    autoRefresh: 'Страница обновляется каждые 20 секунд.',
    nameLabel: 'Имя клиента',
    phoneHint: 'Например, 0555 123 456.',
  },

  cancelDialog: {
    title: (number: string) => `Отменить заказ ${number}?`,
    text: 'Товары вернутся на склад. Клиент увидит, что заказ отменён.',
    reason: 'Причина отмены',
    reasonHint: 'От 3 до 500 символов. Её увидят сотрудники в журнале.',
    reasonRequired: 'Укажите причину отмены.',
    reasonShort: 'Причина слишком короткая: нужно хотя бы 3 символа.',
    reasonLong: 'Причина слишком длинная: не больше 500 символов.',
    confirm: 'Отменить заказ',
    confirming: 'Отменяем…',
    keep: 'Не отменять',
  },

  products: {
    title: 'Товары',
    searchLabel: 'Поиск по названию или артикулу',
    searchPlaceholder: 'Молоко, MILK-001',
    clearSearch: 'Очистить поиск',
    category: 'Категория',
    allCategories: 'Все категории',
    stock: 'Остаток',
    stockFilters: { all: 'Любой', low: 'Мало', out: 'Нет в наличии' } satisfies Record<
      StockFilter,
      string
    >,
    active: 'Показ на сайте',
    activeFilters: { '': 'Все', '1': 'В продаже', '0': 'Скрытые' },
    filtersLabel: 'Фильтры товаров',
    readOnly: 'У вас доступ только для просмотра товаров.',
    tableCaption: 'Товары, цены и остатки',
    columns: {
      product: 'Товар',
      price: 'Цена, сом',
      stock: 'Остаток',
      onSale: 'В продаже',
      badge: 'Метка',
      save: 'Сохранение',
    },
    priceFor: (name: string) => `Цена, сом: ${name}`,
    stockFor: (name: string) => `Остаток: ${name}`,
    onSaleFor: (name: string) => `В продаже: ${name}`,
    badgeFor: (name: string) => `Метка: ${name}`,
    saveFor: (name: string) => `Сохранить: ${name}`,
    onSale: 'В продаже',
    hidden: 'Скрыт',
    noBadge: 'Без метки',
    save: 'Сохранить',
    saving: 'Сохраняем…',
    saved: (name: string) => `Сохранено: ${name}`,
    savedShort: 'Сохранено',
    reverted: 'Не сохранено, значения возвращены.',
    enterHint: 'Enter — сохранить строку.',
    low: 'Мало',
    out: 'Нет в наличии',
    units: (count: number) => `${count} шт.`,
    unchanged: 'Изменений нет',
    emptyTitle: 'Товаров не нашлось',
    emptyHint: 'Измените поиск или фильтры.',
    resetFilters: 'Сбросить фильтры',
    loadError: 'Не удалось загрузить товары',
    loadMore: 'Показать ещё',
    loadingMore: 'Загружаем…',
    shown: (shown: number, total: number) => `Показано ${shown} из ${total}`,
    loadMoreError: 'Не удалось загрузить следующие товары.',
    errors: {
      price_required: 'Укажите цену.',
      price_format: 'Цена — число, например 85 или 85.50.',
      price_positive: 'Цена должна быть больше 0.',
      stock_required: 'Укажите остаток.',
      stock_format: 'Остаток — целое число.',
      stock_range: 'Остаток — от 0 до 100 000.',
    } satisfies Record<DraftErrorCode, string>,
  },

  status: {
    new: 'Новый',
    confirmed: 'Подтверждён',
    preparing: 'Собираем',
    ready: 'Готов к выдаче',
    out_for_delivery: 'Курьер в пути',
    completed: 'Выполнен',
    cancelled: 'Отменён',
  } satisfies Record<OrderStatus, string>,

  payment: {
    unpaid: 'Не оплачен',
    pending: 'Ждёт проверки',
    paid: 'Оплачен',
    rejected: 'Оплата не найдена',
    refunded: 'Деньги возвращены',
  } satisfies Record<PaymentStatus, string>,

  method: {
    cash: 'Наличными',
    mbank_transfer: 'Перевод MBANK',
  } satisfies Record<PaymentMethod, string>,

  fulfillment: {
    delivery: 'Доставка',
    pickup: 'Самовывоз',
  } satisfies Record<Fulfillment, string>,

  badge: {
    popular: 'Популярное',
    deal: 'Выгодно',
    new: 'Новинка',
  } satisfies Record<Badge, string>,

  /** Buttons for allowed_status_transitions. */
  statusAction: {
    new: 'Вернуть в новые',
    confirmed: 'Подтвердить',
    preparing: 'Начать сборку',
    ready: 'Готов к выдаче',
    out_for_delivery: 'Передан курьеру',
    completed: 'Выполнен',
    cancelled: 'Отменить заказ',
  } satisfies Record<OrderStatus, string>,

  /** Buttons for allowed_payment_transitions. */
  paymentAction: {
    unpaid: 'Отметить как неоплаченный',
    pending: 'Вернуть на проверку',
    paid: 'Оплата получена',
    rejected: 'Оплата не найдена',
    refunded: 'Деньги возвращены',
  } satisfies Record<PaymentStatus, string>,

  event: {
    created: 'Заказ создан',
    status: 'Статус изменён',
    payment: 'Оплата изменена',
    payment_reported: 'Клиент сообщил об оплате',
    stock_restored: 'Товары возвращены на склад',
    edited: 'Данные заказа изменены',
    migrated: 'Перенесён из старой системы',
  } satisfies Record<OrderEventKind, string>,

  forbidden: {
    title: 'Недостаточно прав',
    text: 'У вашей учётной записи нет доступа к этому разделу. Обратитесь к владельцу магазина.',
  },

  notFound: {
    title: 'Страница не найдена',
    text: 'Такой страницы в панели персонала нет.',
    home: 'К заказам',
  },

  errors: {
    network: 'Нет связи с сервером. Проверьте интернет и повторите.',
    timeout: 'Сервер долго не отвечает. Повторите попытку.',
    server: 'Ошибка на сервере. Повторите попытку чуть позже.',
    forbidden: 'Недостаточно прав.',
    csrf: 'Сессия устарела. Обновите страницу.',
    unauthenticated: 'Войдите в систему.',
    notFound: 'Не найдено.',
    throttled: (seconds: number | null) =>
      seconds === null
        ? 'Слишком много запросов. Подождите немного.'
        : `Слишком много запросов. Повторите ${waitPhrase(seconds)}.`,
    generic: 'Что-то пошло не так. Повторите попытку.',
    retry: 'Повторить',
    sessionCheck: 'Не удалось проверить вход',
  },

  time: {
    justNow: 'только что',
    minutesAgo: (minutes: number) => `${minutes} мин назад`,
    hoursAgo: (hours: number) => `${hours} ч назад`,
    daysAgo: (days: number) => `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`,
  },

  newOrdersAnnounce: (count: number) =>
    `Новые заказы: ${count} ${plural(count, ORDERS)} ждут подтверждения`,
}

export type StaffStrings = typeof ru

/** The active staff dictionary. */
export const S: StaffStrings = ru
