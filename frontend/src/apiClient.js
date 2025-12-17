const rawBaseUrl = (process.env.REACT_APP_API_BASE_URL || '').replace(/\/+$/, '');

export const API_BASE_URL = rawBaseUrl;

export const buildApiUrl = (path) => {
  if (!path.startsWith('/')) {
    return `${API_BASE_URL}/${path}`;
  }
  return `${API_BASE_URL}${path}`;
};
