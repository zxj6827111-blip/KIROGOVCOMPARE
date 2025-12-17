import axios from 'axios';

const normalizeBaseUrl = (url) => {
  const normalized = (url || '/api').trim();
  if (!normalized) return '/api';
  return normalized.replace(/\/+$/, '');
};

export const API_BASE_URL = normalizeBaseUrl(process.env.REACT_APP_API_BASE_URL);

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

export const buildApiUrl = (path) => {
  const cleanedPath = path.startsWith('/') ? path : `/${path}`;
  const base = API_BASE_URL || '/api';
  const trimmedBase = base.replace(/\/+$/, '');
  return `${trimmedBase}${cleanedPath}`;
};
