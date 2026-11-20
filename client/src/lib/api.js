import axios from 'axios';

const TOKEN_KEY = 'civiclens_admin_token';

export const getAdminToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
};
export const setAdminToken = (t) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
};

export const api = axios.create({ baseURL: '/api', timeout: 120000 });

api.interceptors.request.use((cfg) => {
  const token = getAdminToken();
  if (token && cfg.url?.startsWith('/admin')) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

/** Human-readable message from an API error. */
export function errorMessage(err) {
  const e = err?.response?.data?.error;
  if (e?.fields?.length) return e.fields.map((f) => f.message).join(' ');
  if (e?.message) return e.message;
  if (err?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (!err?.response) return 'Cannot reach the CivicLens server. Is the backend running?';
  return 'Something went wrong. Please try again.';
}

export const isUnauthorized = (err) => err?.response?.status === 401;
