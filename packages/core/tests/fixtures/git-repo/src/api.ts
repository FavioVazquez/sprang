/**
 * API module — composes auth and database to expose application endpoints.
 */

import { login, logout, getCurrentUser, isAuthenticated, isSessionExpired, type User } from './auth.js';
import { connect, query, disconnect, isConnected, getQueryCount, type ConnectionOptions, type QueryResult } from './database.js';

export interface ApiConfig {
  db: ConnectionOptions;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Initializes the API by connecting to the database.
 */
export async function initApi(config: ApiConfig): Promise<void> {
  if (!isConnected()) {
    await connect(config.db);
  }
}

/**
 * Shuts down the API, disconnecting from the database and logging out.
 */
export async function shutdownApi(): Promise<void> {
  if (isAuthenticated()) {
    await logout();
  }
  await disconnect();
}

/**
 * Authenticates a user and returns an API response.
 */
export async function apiLogin(email: string, password: string): Promise<ApiResponse<User>> {
  try {
    const user = await login(email, password);
    return { success: true, data: user };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Executes a query and wraps the result in an API response.
 */
export async function apiQuery<T = unknown>(
  sql: string,
  params?: unknown[]
): Promise<ApiResponse<QueryResult<T>>> {
  if (!isAuthenticated()) {
    return { success: false, error: 'Unauthorized' };
  }
  if (isSessionExpired()) {
    await logout();
    return { success: false, error: 'Session expired' };
  }
  try {
    const result = await query<T>(sql, params);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Returns the currently logged in user wrapped in an API response.
 */
export function apiGetCurrentUser(): ApiResponse<User> {
  const user = getCurrentUser();
  if (!user) {
    return { success: false, error: 'Not logged in' };
  }
  return { success: true, data: user };
}

/**
 * Returns the current health status of the API.
 */
export async function apiHealth(): Promise<ApiResponse<{ dbConnected: boolean; queryCount: number; sessionExpired: boolean }>> {
  return {
    success: true,
    data: {
      dbConnected: isConnected(),
      queryCount: getQueryCount(),
      sessionExpired: isSessionExpired(),
    },
  };
}

/**
 * Logs out the current user and returns an API response.
 */
export async function apiLogout(): Promise<ApiResponse<void>> {
  try {
    await logout();
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
