import type { Badge, Category, StoreConfig } from '../types'

// Demo catalogue for VITE_USE_MOCK=1. Prices are the prototype's sample prices, not real ones.

export interface MockProduct {
  id: number
  sku: string
  category: number
  name_ru: string
  name_ky: string
  description: string
  price: string
  unit: string
  stock: number
  badge: Badge | null
}

export const MOCK_CATEGORIES: Omit<Category, 'product_count'>[] = [
  {
    id: 1,
    slug: 'produkty',
    name_ru: 'Продукты',
    name_ky: 'Азык-түлүк',
    parent: null,
    sort_order: 0,
  },
  {
    id: 2,
    slug: 'ovoshchi-frukty',
    name_ru: 'Овощи и фрукты',
    name_ky: 'Жашылча-жемиш',
    parent: null,
    sort_order: 1,
  },
  {
    id: 3,
    slug: 'dlya-doma',
    name_ru: 'Для дома',
    name_ky: 'Үй үчүн',
    parent: null,
    sort_order: 2,
  },
  {
    id: 4,
    slug: 'krasota-uhod',
    name_ru: 'Красота и уход',
    name_ky: 'Сулуулук жана кам көрүү',
    parent: null,
    sort_order: 3,
  },
  {
    id: 5,
    slug: 'dlya-detey',
    name_ru: 'Для детей',
    name_ky: 'Балдар үчүн',
    parent: null,
    sort_order: 4,
  },
  // No products yet: the storefront must hide it.
  {
    id: 6,
    slug: 'zamorozka',
    name_ru: 'Заморозка',
    name_ky: 'Тоңдурулган азыктар',
    parent: null,
    sort_order: 5,
  },
]

export const MOCK_PRODUCTS: MockProduct[] = [
  {
    id: 1,
    sku: 'MILK-001',
    category: 1,
    name_ru: 'Молоко 2.5%',
    name_ky: 'Сүт 2.5%',
    description: '',
    price: '85.00',
    unit: '1 л',
    stock: 40,
    badge: 'popular',
  },
  {
    id: 2,
    sku: 'BREAD-001',
    category: 1,
    name_ru: 'Хлеб пшеничный',
    name_ky: 'Буудай наны',
    description: '',
    price: '35.00',
    unit: '1 шт.',
    stock: 60,
    badge: null,
  },
  {
    id: 3,
    sku: 'EGG-001',
    category: 1,
    name_ru: 'Яйца куриные',
    name_ky: 'Тоок жумурткасы',
    description: '',
    price: '145.00',
    unit: '10 шт.',
    stock: 30,
    badge: null,
  },
  {
    id: 4,
    sku: 'APPLE-001',
    category: 2,
    name_ru: 'Яблоки',
    name_ky: 'Алма',
    description: '',
    price: '120.00',
    unit: '1 кг',
    stock: 25,
    badge: null,
  },
  {
    id: 5,
    sku: 'DISH-001',
    category: 3,
    name_ru: 'Средство для посуды',
    name_ky: 'Идиш жуугуч каражат',
    description: '',
    price: '165.00',
    unit: '500 мл',
    stock: 18,
    badge: null,
  },
  {
    id: 6,
    sku: 'SHAMP-001',
    category: 4,
    name_ru: 'Шампунь',
    name_ky: 'Шампунь',
    description: '',
    price: '290.00',
    unit: '400 мл',
    stock: 0,
    badge: null,
  },
  {
    id: 7,
    sku: 'TOWEL-001',
    category: 3,
    name_ru: 'Бумажные полотенца',
    name_ky: 'Кагаз сүлгү',
    description: '',
    price: '110.00',
    unit: '2 рулона',
    stock: 15,
    badge: null,
  },
  {
    id: 8,
    sku: 'DIAPER-001',
    category: 5,
    name_ru: 'Детские подгузники',
    name_ky: 'Балдар жалаягы',
    description: '',
    price: '650.00',
    unit: 'упаковка',
    stock: 3,
    badge: 'deal',
  },
  {
    id: 9,
    sku: 'BANANA-001',
    category: 2,
    name_ru: 'Бананы',
    name_ky: 'Банан',
    description: '',
    price: '135.00',
    unit: '1 кг',
    stock: 25,
    badge: null,
  },
  {
    id: 10,
    sku: 'RICE-001',
    category: 1,
    name_ru: 'Рис',
    name_ky: 'Күрүч',
    description: '',
    price: '95.00',
    unit: '1 кг',
    stock: 50,
    badge: null,
  },
  {
    id: 11,
    sku: 'JUICE-001',
    category: 1,
    name_ru: 'Апельсиновый сок',
    name_ky: 'Апельсин ширеси',
    description: '',
    price: '155.00',
    unit: '1 л',
    stock: 20,
    badge: 'new',
  },
  {
    id: 12,
    sku: 'LAUNDRY-001',
    category: 3,
    name_ru: 'Средство для стирки',
    name_ky: 'Кир жуугуч каражат',
    description: '',
    price: '320.00',
    unit: '1 л',
    stock: 12,
    badge: null,
  },
]

export function mockStoreConfig(options: { closed: boolean; mbank: boolean }): StoreConfig {
  return {
    name: 'Ала-Тоо Маркет',
    city: 'Кызыл-Кия',
    // Left empty on purpose: the demo must not show a real-looking phone or address.
    phone: '',
    pickup_address: '',
    opening_hours: 'Ежедневно 08:00–22:00',
    is_accepting_orders: !options.closed,
    currency: 'KGS',
    fulfillment: {
      delivery_enabled: true,
      pickup_enabled: true,
      delivery_fee: '150.00',
      free_delivery_from: '2000.00',
      min_order_total: '300.00',
    },
    payment: {
      cash_enabled: true,
      mbank: options.mbank
        ? {
            configured: true,
            recipient_name: 'ДЕМО — не переводите деньги',
            phone: '+996 000 000 000',
            qr_image_url: '',
          }
        : { configured: false, recipient_name: '', phone: '', qr_image_url: '' },
    },
  }
}
