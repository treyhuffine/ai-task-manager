/**
 * Types for the native trust-store layer (see docs/optional-http2.md §4).
 *
 * Trust installation is intentionally decoupled from certificate generation:
 * generating a CA changes no system trust, and each native store is handled by
 * a small adapter with inspect/install/remove operations. All native tool
 * invocations use fixed argument arrays (never shell-interpolated paths) and
 * report a structured per-target result so partial success is legible.
 */

export type TrustTargetId =
  | 'macos-system'
  | 'windows-user-root'
  | 'linux-debian'
  | 'linux-fedora'
  | 'nss-chromium'
  | 'nss-firefox';

export type TrustOutcome =
  /** A trust entry this run created. */
  | 'installed'
  /** The exact certificate was already trusted (idempotent no-op). */
  | 'already-present'
  /** An owned trust entry this run removed. */
  | 'removed'
  /** Nothing recorded/owned to remove for this target. */
  | 'not-present'
  /** The store needs authorization this run did not obtain. */
  | 'permission-denied'
  /** A required native tool (e.g. certutil) is unavailable. */
  | 'missing-tool'
  /** The target applies but its profile/database could not be read. */
  | 'profile-unavailable'
  /** This target is not supported on this machine/config. */
  | 'unsupported'
  /** Any other failure. */
  | 'error';

export interface TrustResult {
  target: TrustTargetId;
  label: string;
  outcome: TrustOutcome;
  /** Human-readable context: which store/profile, guidance, or the tool error. */
  detail?: string;
  /**
   * Whether THIS install owns the resulting store entry — set by the adapter,
   * not inferred from the outcome label. True when we created it (or, for the
   * uniquely-named Linux anchor, when the owned file is present even if a
   * refresh has not completed). False when the entry was found already present
   * and we did not add it, so untrust must never touch it.
   */
  owned?: boolean;
  /**
   * For multi-location stores (NSS profiles), the specific locations THIS run
   * installed into. Recorded per-location so untrust removes trust only from
   * the profiles Flow added it to, never a profile that already trusted the CA.
   */
  ownedProfiles?: string[];
}

/** Result of a native command execution. */
export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be spawned at all (e.g. ENOENT). */
  error?: string;
}

/**
 * Abstraction over native command execution and environment probing. The
 * default implementation shells out with fixed argument arrays; tests inject a
 * scripted runner so command construction and result handling are verifiable
 * without mutating any real trust store.
 */
export interface NativeRunner {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: string;
  /** Resolve a tool on PATH, or null if absent. */
  which(command: string): string | null;
  /** Does a filesystem path exist? */
  exists(p: string): boolean;
  /** Read a UTF-8 file, or null if unreadable. */
  readFile(p: string): string | null;
  /** Write a UTF-8 file. `error` is set (e.g. `EACCES`) when the write fails. */
  writeFile(p: string, data: string): { ok: boolean; error?: string };
  /** Remove a file. `error` is set on failure other than "already gone". */
  removeFile(p: string): { ok: boolean; error?: string };
  /** Execute a command with a fixed argument array. */
  run(command: string, args: string[], opts?: { input?: string }): RunResult;
}

/** Everything an adapter needs to act on one target. */
export interface TrustContext {
  runner: NativeRunner;
  /** Absolute path to the generated CA certificate (PEM). */
  caCertPath: string;
  /** The CA certificate PEM contents. */
  caCertPem: string;
  /** Lowercase hex SHA-256 of the CA DER — the canonical ownership key. */
  caFingerprintSha256: string;
  /** SHA-1 thumbprint (uppercase hex, no separators) — Windows store key. */
  caFingerprintSha1: string;
  /** Per-install identifier, used to name owned anchor files. */
  installId: string;
}

export interface TrustAdapter {
  id: TrustTargetId;
  label: string;
  /** Whether this target applies on the current machine. */
  detect(runner: NativeRunner): boolean;
  install(ctx: TrustContext): TrustResult;
  /**
   * Remove owned trust. `ownedProfiles` carries the recorded per-location
   * ownership (NSS) so removal never touches a location we did not install into;
   * adapters without per-location state ignore it.
   */
  remove(ctx: TrustContext, ownedProfiles?: string[]): TrustResult;
}
