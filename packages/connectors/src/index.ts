/**
 * @connectors/engine — a local-first, trust-first connector runtime.
 *
 * Public core surface. Auth strategies, the Google provider, the AI-SDK adapter,
 * stores, and crypto live behind subpath exports (`@connectors/engine/auth`,
 * `/google`, `/ai-sdk`, `/store`, `/crypto`) so the core stays zod-only.
 */

// Runtime
export { createConnectorRuntime } from './core/runtime';
export type { ConnectorRuntimeOptions } from './core/runtime';

// Registry + authoring
export { createRegistry } from './core/registry';
export type { Registry, ResolvedAction } from './core/registry';
export { defineProvider, defineToolkit, action, httpAction } from './core/authoring';
export type { ActionSpec, HttpActionSpec, HttpActionRequest, HttpActionContext } from './core/authoring';
export { collectPages } from './core/paginate';
export type { Page, PaginateOptions } from './core/paginate';

// Ports defaults + helpers
export { staticOAuthApps } from './oauth-apps';
export { staticAuthConfigs, storeAuthConfigRegistry } from './auth-configs';
export type { AuthConfigInput, StaticAuthConfigsInput, StoreAuthConfigRegistryOptions } from './auth-configs';
export { createAuthConfigAdmin } from './core/auth-config-admin';
export type { AuthConfigAdmin, AuthConfigAdminDeps, AddAuthConfigInput } from './core/auth-config-admin';
export { createRedactor, noopRedactor } from './core/redactor';
export { systemClock, noopLogger, defaultApprovalPolicy, connectionMetadata, uniqueScopes } from './core/defaults';
export { inProcessLock, fileLock } from './lock';
export type { FileLockOptions } from './lock';

// Digest / canonicalization (host-shared for grant keys)
export { inputDigest, canonicalStringify, actionVersion, schemaFingerprint } from './core/digest';

// Errors
export {
  ConnectorError,
  NeedsReauthError,
  AuthConfigRequiredError,
  isConnectorError,
  isAuthConfigRequiredError,
} from './core/errors';
export type { ConnectorErrorCode, ConnectorErrorOptions } from './core/errors';

// Domain model + ports (types)
export type {
  Provider,
  Toolkit,
  Action,
  Connection,
  ConnectionMetadata,
  ActionContext,
  AccountIdentity,
  IdentifyContext,
  RiskLevel,
  Credentials,
  OAuth2Credentials,
  CredentialType,
  AuthStrategy,
  OAuthFlow,
  TokenSet,
  AuthedHttp,
  HttpRequest,
  ActionOutcome,
  AccountChoice,
  AuthConfigChoice,
  AuthRequest,
  AuthIntent,
  SealedSecret,
  StoredConnection,
  ConnectionStore,
  AuthRequestStore,
  SecretBox,
  OAuthAppConfig,
  OAuthAppRegistry,
  AuthScheme,
  AuthConfig,
  AuthConfigStatus,
  AuthConfigScope,
  AuthConfigSummary,
  ResolvedAuthConfig,
  ResolutionContext,
  AuthConfigRegistry,
  AuthConfigStore,
  ApprovalPolicy,
  ApprovalDecision,
  ApprovalCheckInput,
  Lock,
  Redactor,
  Clock,
  Logger,
  Caller,
  CallerType,
  ActionRunEvent,
  ActionRunStatus,
  OnActionRun,
  BeginAuthOptions,
  BeginAuthResult,
  RunActionOptions,
  DisconnectOptions,
  ConnectDirectOptions,
  ConnectorRuntime,
} from './core/types';
