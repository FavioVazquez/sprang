# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0] - 2024-02-28

### Added
- `apiHealth` endpoint returning database and session status
- `removeRole` function in auth module for revocation flows
- `queryId` field on `QueryResult` for distributed tracing

### Fixed
- `apiQuery` now auto-logs out and returns error on expired sessions (Re: #103)

## [1.2.0] - 2024-03-10

### Added
- `apiGetCurrentUser` endpoint for retrieving the authenticated user
- `isAuthenticated` helper exported from auth module
- Support for `maxConnections` option in database config

### Changed
- `apiQuery` now returns `Unauthorized` error when not logged in
- `initApi` is idempotent — safe to call multiple times

## [1.1.0] - 2024-01-15

### Added
- Initial `login`, `logout`, `getCurrentUser` functions in auth module
- Database `connect`, `query`, `disconnect` functions
- `api.ts` composing auth and database layers
- Entry point `index.ts` re-exporting all public API

### Fixed
- Database `disconnect` no longer throws when not connected (Fixes #45)
- Auth `login` validates email and password before proceeding (Closes #23)
