/**
 * Authentication module — handles login, logout, and current user retrieval.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

let _currentUser: User | null = null;
let _sessionStartTime: number | null = null;

/**
 * Authenticates a user with the given credentials.
 * Returns the logged-in user on success.
 */
export async function login(email: string, password: string): Promise<User> {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email address');
  }
  // Simulate authentication
  const user: User = {
    id: `user-${Date.now()}`,
    email,
    name: email.split('@')[0] ?? email,
    roles: ['user'],
  };
  _currentUser = user;
  _sessionStartTime = Date.now();
  return user;
}

/**
 * Logs out the currently authenticated user.
 */
export async function logout(): Promise<void> {
  _currentUser = null;
  _sessionStartTime = null;
}

/**
 * Returns whether the current session has expired.
 */
export function isSessionExpired(): boolean {
  if (!_sessionStartTime) return false;
  return Date.now() - _sessionStartTime > SESSION_TIMEOUT_MS;
}

/**
 * Refreshes the session timer to prevent expiry.
 * No-op if no session is active.
 */
export function refreshSession(): void {
  if (_sessionStartTime !== null) {
    _sessionStartTime = Date.now();
  }
}

/**
 * Returns the currently authenticated user, or null if not logged in.
 */
export function getCurrentUser(): User | null {
  return _currentUser;
}

/**
 * Returns true if a user is currently authenticated.
 */
export function isAuthenticated(): boolean {
  return _currentUser !== null;
}

/**
 * Returns true if the current user has the given role.
 */
export function hasRole(role: string): boolean {
  if (!_currentUser) return false;
  return _currentUser.roles.includes(role);
}

/**
 * Assigns an additional role to the current user.
 * Throws if no user is logged in.
 */
export function assignRole(role: string): void {
  if (!_currentUser) {
    throw new Error('No authenticated user');
  }
  if (!_currentUser.roles.includes(role)) {
    _currentUser.roles.push(role);
  }
}

/**
 * Removes a role from the current user.
 * Throws if no user is logged in.
 */
export function removeRole(role: string): void {
  if (!_currentUser) {
    throw new Error('No authenticated user');
  }
  _currentUser.roles = _currentUser.roles.filter((r) => r !== role);
}
// v1.1 — basic auth
// security: validate token
// session expiry check
// role-based access
// logout cleanup
