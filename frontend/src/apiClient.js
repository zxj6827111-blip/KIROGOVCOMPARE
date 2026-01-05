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

// Add auth token to requests
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401 responses (token expired)
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear stored auth and redirect to login
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
      // Will be handled by App.js auth state
    }
    return Promise.reject(error);
  }
);

export const buildApiUrl = (path) => {
  const cleanedPath = path.startsWith('/') ? path : `/${path}`;
  const base = API_BASE_URL || '/api';
  const trimmedBase = base.replace(/\/+$/, '');
  return `${trimmedBase}${cleanedPath}`;
};

// For file downloads that need to bypass React proxy (window.open, etc.)
// Uses the API_BASE_URL which works in both dev and production
export const buildDownloadUrl = (path) => {
  const cleanedPath = path.startsWith('/') ? path : `/${path}`;
  // Use API_BASE_URL - in production this should be configured correctly
  // In development with proxy, this will be /api which proxies to backend
  const base = API_BASE_URL || '/api';
  return `${base}${cleanedPath}`;
};

// Helper to check if user is authenticated
export const isAuthenticated = () => {
  return !!localStorage.getItem('admin_token');
};

// Helper to get current user
export const getCurrentUser = () => {
  const userStr = localStorage.getItem('admin_user');
  return userStr ? JSON.parse(userStr) : null;
};

// Helper to logout
export const logout = () => {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
};
