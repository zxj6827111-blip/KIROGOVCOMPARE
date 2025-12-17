import axios from 'axios';

const normalizeBaseUrl = (url) => (url || '/api').replace(/\/+$/, '') || '/api';

export const API_BASE_URL = normalizeBaseUrl(process.env.REACT_APP_API_BASE_URL);

export const apiClient = axios.create({
  baseURL: API_BASE_URL || '/api',
});

export const buildApiUrl = (path) => {
  const cleanedPath = path.startsWith('/') ? path : `/${path}`;
  if (!API_BASE_URL) {
    return cleanedPath;
  }
  return `${API_BASE_URL}${cleanedPath}`.replace(/\/+$/, cleanedPath === '/' ? '/' : '');
};
