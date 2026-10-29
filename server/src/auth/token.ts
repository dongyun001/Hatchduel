/**
 * Token：自签 HMAC-SHA256，无第三方依赖（不引 JWT 库，锁文件归 0 号）。
 *
 * - access token 短有效期（默认 2h），携带 `accountId` + `sessionId`；
 * - refresh token 长有效期（默认 30d），服务端只存哈希，刷新即轮换；
 * - 会话吊销（封禁/删除账号）时查 session 表即可让 access token 立刻失效。
 *
 * 不是密码学创新：签名 payload 只做完整性，不加密内容。
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export type TokenKind = 'access' | 'refresh';

export interface TokenPayload {
  /** token 结构版本，便于以后换签名方案。 */
  v: 1;
  kind: TokenKind;
  /** accountId */
  sub: string;
  /** sessionId */
  sid: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface SignOptions {
  accountId: string;
  sessionId: string;
  kind: TokenKind;
  ttlMs: number;
  now: number;
}

export interface TokenSigner {
  sign(options: SignOptions): string;
  verify(token: string, now: number): TokenPayload | undefined;
  /** refresh token 只存哈希，避免数据库泄露即可直接用。 */
  hash(token: string): string;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function base64UrlDecode(input: string): string | undefined {
  try {
    return Buffer.from(input, 'base64url').toString('utf8');
  } catch {
    return undefined;
  }
}

export function createTokenSigner(secret: string): TokenSigner {
  if (secret.length < 8) {
    throw new Error('PETBATTLE_TOKEN_SECRET 至少 8 个字符');
  }

  const signPayload = (payload: string): string =>
    createHmac('sha256', secret).update(payload).digest('base64url');

  return {
    sign({ accountId, sessionId, kind, ttlMs, now }) {
      const payload: TokenPayload = {
        v: 1,
        kind,
        sub: accountId,
        sid: sessionId,
        iat: now,
        exp: now + ttlMs,
        jti: randomUUID(),
      };
      const encoded = base64UrlEncode(JSON.stringify(payload));
      return `${encoded}.${signPayload(encoded)}`;
    },

    verify(token, now) {
      const separator = token.lastIndexOf('.');
      if (separator <= 0) return undefined;
      const encoded = token.slice(0, separator);
      const signature = token.slice(separator + 1);
      if (signature === '') return undefined;

      const expected = signPayload(encoded);
      const actualBuffer = Buffer.from(signature, 'utf8');
      const expectedBuffer = Buffer.from(expected, 'utf8');
      if (actualBuffer.length !== expectedBuffer.length) return undefined;
      if (!timingSafeEqual(actualBuffer, expectedBuffer)) return undefined;

      const decoded = base64UrlDecode(encoded);
      if (decoded === undefined) return undefined;

      let parsed: unknown;
      try {
        parsed = JSON.parse(decoded);
      } catch {
        return undefined;
      }
      if (typeof parsed !== 'object' || parsed === null) return undefined;

      const payload = parsed as Partial<TokenPayload>;
      if (payload.v !== 1) return undefined;
      if (payload.kind !== 'access' && payload.kind !== 'refresh') return undefined;
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return undefined;
      if (typeof payload.exp !== 'number' || payload.exp <= now) return undefined;
      if (typeof payload.iat !== 'number' || typeof payload.jti !== 'string') return undefined;

      return payload as TokenPayload;
    },

    hash(token) {
      return createHash('sha256').update(token).digest('hex');
    },
  };
}
