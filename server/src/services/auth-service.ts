/**
 * 鉴权与账号（ONLINE_DESIGN §3）。
 *
 * M1 只做游客登录 + token 刷新：
 * - 微信 `code2session` / Steam 票据校验需要外部密钥与网络，等 0 号给到环境变量再做；
 * - 游客身份只认 `deviceId`，同一 device 永远落同一个账号（唯一约束 + 按 device 互斥）。
 *
 * 客户端拿不到“我获得了什么”的决定权：这里只发 token / 账号视图，进度由 profile 服务返回。
 */
import { randomUUID } from 'node:crypto';

import type { AuthAccount, AuthProvider, AuthResponse } from '@petbattle/protocol';

import type { KeyedMutex } from '../concurrency.js';
import { createInitialProfile } from '../domain/starter-profile.js';
import { AppError } from '../errors.js';
import type { AccountRecord, AuditEntry, Store } from '../storage/types.js';
import type { TokenSigner } from './../auth/token.js';

export interface AuthTokens {
  token: string;
  refreshToken: string;
}

export interface AuthServiceOptions {
  store: Store;
  tokens: TokenSigner;
  mutex: KeyedMutex;
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
}

export class AuthService {
  constructor(private readonly options: AuthServiceOptions) {}

  async guestLogin(deviceId: string, now: number): Promise<AuthResponse> {
    const { store, mutex } = this.options;

    return mutex.run(`guest:${deviceId}`, async () => {
      let account = await store.findAccountByBinding('guest', deviceId);
      if (account === undefined) {
        account = {
          id: `acc_${randomUUID()}`,
          displayName: defaultDisplayName(),
          region: 'cn',
          status: 'active',
          createdAt: now,
          bindings: { guest: { deviceId } },
        };
        await store.createAccount(account);
        await this.audit({
          at: now,
          accountId: account.id,
          action: 'account.create',
          detail: { provider: 'guest' },
        });
      }

      assertActive(account);
      const profile = await this.ensureProfile(account.id, now);
      const tokens = await this.issueSession(account, now);

      return {
        token: tokens.token,
        refreshToken: tokens.refreshToken,
        account: toAuthAccount(account),
        profileRevision: profile.revision,
        serverTime: now,
      };
    });
  }

  async refresh(refreshToken: string, now: number): Promise<AuthResponse> {
    const { store, tokens, mutex } = this.options;
    const payload = tokens.verify(refreshToken, now);
    if (payload === undefined || payload.kind !== 'refresh') {
      throw new AppError('UNAUTHENTICATED', 'refreshToken 无效或已过期');
    }

    return mutex.run(`session:${payload.sid}`, async () => {
      const session = await store.getSession(payload.sid);
      if (session === undefined || session.revokedAt !== undefined || session.expiresAt <= now) {
        throw new AppError('UNAUTHENTICATED', '会话已失效');
      }
      // 轮换后旧 token 立刻作废：攻击者拿到旧 refreshToken 也不能续期。
      if (session.refreshTokenHash !== tokens.hash(refreshToken)) {
        throw new AppError('UNAUTHENTICATED', 'refreshToken 已被轮换');
      }

      const account = await store.getAccount(session.accountId);
      if (account === undefined) throw new AppError('UNAUTHENTICATED', '账号不存在');
      assertActive(account);

      await store.revokeSession(session.id, now);
      const profile = await this.ensureProfile(account.id, now);
      const issued = await this.issueSession(account, now);

      return {
        token: issued.token,
        refreshToken: issued.refreshToken,
        account: toAuthAccount(account),
        profileRevision: profile.revision,
        serverTime: now,
      };
    });
  }

  /** 校验 access token 并确认会话/账号仍有效；返回账号。 */
  async authenticate(accessToken: string, now: number): Promise<AccountRecord> {
    const { store, tokens } = this.options;
    const payload = tokens.verify(accessToken, now);
    if (payload === undefined || payload.kind !== 'access') {
      throw new AppError('UNAUTHENTICATED', 'accessToken 无效或已过期');
    }

    const session = await store.getSession(payload.sid);
    if (session === undefined || session.revokedAt !== undefined || session.expiresAt <= now) {
      throw new AppError('UNAUTHENTICATED', '会话已失效');
    }

    const account = await store.getAccount(payload.sub);
    if (account === undefined) throw new AppError('UNAUTHENTICATED', '账号不存在');
    assertActive(account);
    return account;
  }

  /** 审计失败不阻塞登录：账号已经建好，后续写操作还会产生审计记录。 */
  private async audit(entry: AuditEntry): Promise<void> {
    try {
      await this.options.store.appendAudit(entry);
    } catch {
      // 有意吞掉：审计是旁路，不应让用户登录失败。
    }
  }

  private async ensureProfile(accountId: string, now: number): Promise<{ revision: number }> {    const { store } = this.options;
    const existing = await store.getProfile(accountId);
    if (existing !== undefined) return existing;

    await store.createProfile(createInitialProfile(accountId, now));
    const created = await store.getProfile(accountId);
    if (created === undefined) throw new AppError('INTERNAL', '存档创建失败');
    return created;
  }

  private async issueSession(account: AccountRecord, now: number): Promise<AuthTokens> {
    const { store, tokens, accessTokenTtlMs, refreshTokenTtlMs } = this.options;
    const sessionId = `ses_${randomUUID()}`;

    const token = tokens.sign({
      accountId: account.id,
      sessionId,
      kind: 'access',
      ttlMs: accessTokenTtlMs,
      now,
    });
    const refreshToken = tokens.sign({
      accountId: account.id,
      sessionId,
      kind: 'refresh',
      ttlMs: refreshTokenTtlMs,
      now,
    });

    await store.createSession({
      id: sessionId,
      accountId: account.id,
      refreshTokenHash: tokens.hash(refreshToken),
      createdAt: now,
      expiresAt: now + refreshTokenTtlMs,
    });

    return { token, refreshToken };
  }
}

function assertActive(account: AccountRecord): void {
  if (account.status === 'banned') throw new AppError('FORBIDDEN', '账号已被封禁');
  if (account.status === 'deleted') throw new AppError('UNAUTHENTICATED', '账号已注销');
}

export function toAuthAccount(account: AccountRecord): AuthAccount {
  return {
    id: account.id,
    displayName: account.displayName,
    region: account.region,
    bindings: account.bindings,
  };
}

function defaultDisplayName(): string {
  return `训练师${randomUUID().slice(0, 4)}`;
}

export type { AuthProvider };
