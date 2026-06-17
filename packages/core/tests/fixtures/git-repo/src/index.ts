/**
 * Entry point — re-exports all public API surface.
 */

export {
  initApi,
  shutdownApi,
  apiLogin,
  apiLogout,
  apiQuery,
  apiGetCurrentUser,
  apiHealth,
  type ApiConfig,
  type ApiResponse,
} from './api.js';

export {
  login,
  logout,
  getCurrentUser,
  isAuthenticated,
  isSessionExpired,
  hasRole,
  assignRole,
  removeRole,
  type User,
} from './auth.js';

export {
  connect,
  query,
  disconnect,
  isConnected,
  getConnectionOptions,
  getConnectionStatus,
  getQueryCount,
  type ConnectionOptions,
  type QueryResult,
} from './database.js';
export const VERSION = '1.1.0';
export const VERSION = '1.2.0';
export const VERSION = '1.3.0';
export const VERSION = '1.1.0';
export const VERSION = '1.2.0';
export const VERSION = '1.3.0';
export const VERSION = '1.1.0';
export const VERSION = '1.2.0';
export const VERSION = '1.3.0';
