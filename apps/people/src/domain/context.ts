import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { AppInvocation } from '@ri/app-kit/sdk';
import {
  createBlobStore, createJobQueue, createScopeStore, createSettings,
  type AccessScope, type BlobStore, type JobQueue, type ScopeStore,
} from '@ri/app-kit/data';
import { createAccountStore, createMailIndex, type AccountStore, type MailIndex } from '@ri/app-kit/sources';

export type Param = string | number | bigint | null | Uint8Array;
export type Row = Record<string, unknown>;

/** A thin statement cache over node:sqlite. Booleans become 0/1 before binding. */
export class Db {
  private readonly cache = new Map<string, StatementSync>();
  /** When set, read statements are recorded so tests can check their query plans. */
  trace: { sql: string; params: Param[] }[] | null = null;
  constructor(readonly raw: DatabaseSync) {}
  statement(sql: string): StatementSync {
    let statement = this.cache.get(sql);
    if (!statement) {
      if (this.cache.size > 1500) this.cache.clear();
      statement = this.raw.prepare(sql);
      this.cache.set(sql, statement);
    }
    return statement;
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    this.trace?.push({ sql, params });
    return this.statement(sql).all(...params) as T[];
  }
  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    this.trace?.push({ sql, params });
    return this.statement(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: Param[]) {
    return this.statement(sql).run(...params);
  }
  exec(sql: string) {
    this.raw.exec(sql);
  }
  get isTransaction() {
    return this.raw.isTransaction;
  }
  /** Same contract as the kit's `transaction`: join an open transaction or run one. */
  tx<T>(work: () => T): T {
    if (this.raw.isTransaction) return work();
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.raw.isTransaction) this.raw.exec('ROLLBACK');
      throw error;
    }
  }
}

export interface Ctx {
  db: Db;
  instanceId: string;
  settings: ReturnType<typeof createSettings>;
  scopes: ScopeStore;
  jobs: JobQueue;
  accounts: AccountStore;
  mailIndex: MailIndex;
  blobs: BlobStore;
  mutate<T>(invocation: AppInvocation, action: string, input: unknown, operation: () => T): T;
  now(): Date;
  close(): void;
}

export function createContext(options: {
  raw: DatabaseSync;
  mutate: Ctx['mutate'];
  close: () => void;
  blobsDir: string;
  instanceId: string;
  now?: () => Date;
}): Ctx {
  const db = new Db(options.raw);
  const now = options.now ?? (() => new Date());
  const kitDb = options.raw as unknown as Parameters<typeof createSettings>[0];
  return {
    db,
    instanceId: options.instanceId,
    settings: createSettings(kitDb),
    scopes: createScopeStore(kitDb, () => options.instanceId),
    jobs: createJobQueue(kitDb, { now }),
    accounts: createAccountStore(kitDb),
    mailIndex: createMailIndex(kitDb),
    blobs: createBlobStore(options.blobsDir),
    mutate: options.mutate,
    now,
    close: options.close,
  };
}

export const iso = (ctx: Ctx) => ctx.now().toISOString();
export const newId = () => randomUUID();
export type Scope = AccessScope;
