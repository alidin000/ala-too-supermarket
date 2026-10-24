import { createStaffApi } from './api'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '')

// In demo mode the staff API is answered by an in-browser fake server. It sits behind
// `fetch`, so the real client (CSRF handling, retries, error mapping) runs unchanged.
// The check reads import.meta.env right here, not the IS_MOCK re-export: Vite replaces it
// with a constant, so production builds drop the mock chunk entirely.
const fetchImpl: typeof fetch =
  import.meta.env.VITE_USE_MOCK === '1'
    ? (input, init) =>
        import('./mock/staffMock').then((module) => module.mockStaffFetch(input, init))
    : (input, init) => fetch(input, init)

/** The one staff API client: it holds the CSRF token for this page load, in memory. */
export const staffApi = createStaffApi({ baseUrl: `${API_BASE_URL}/staff`, fetchImpl })
