/**
 * 请求解析与校验：header 约定、JSON 体读取、字段校验。
 *
 * - 鉴权：`Authorization: Bearer <accessToken>`。
 * - 写操作：`Idempotency-Key` + `X-Base-Revision`（都是 protocol 常量）。
 */
import type { IncomingMessage } from 'node:http';

import {
  BASE_REVISION_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  PROTOCOL_VERSION,
  PROTOCOL_VERSION_HEADER,
} from '@petbattle/protocol';

import { AppError } from '../errors.js';

export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export function readHeader(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/** 校验客户端声明的协议版本；未声明视为 v1（兼容老客户端）。 */
export function assertProtocolVersion(req: IncomingMessage): void {
  const declared = readHeader(req, PROTOCOL_VERSION_HEADER);
  if (declared === undefined) return;
  if (declared !== PROTOCOL_VERSION) {
    throw new AppError('VALIDATION_FAILED', `协议版本不匹配：服务端 ${PROTOCOL_VERSION}，客户端 ${declared}`);
  }
}

export function readBearerToken(req: IncomingMessage): string | undefined {
  const raw = readHeader(req, 'authorization');
  if (raw === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim();
}

export function requireIdempotencyKey(req: IncomingMessage): string {
  const raw = readHeader(req, IDEMPOTENCY_KEY_HEADER);
  if (raw === undefined || raw.trim() === '') {
    throw new AppError('VALIDATION_FAILED', `写操作必须携带 ${IDEMPOTENCY_KEY_HEADER} 头`);
  }
  if (raw.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new AppError('VALIDATION_FAILED', `${IDEMPOTENCY_KEY_HEADER} 过长（上限 ${MAX_IDEMPOTENCY_KEY_LENGTH}）`);
  }
  return raw;
}

export function requireBaseRevision(req: IncomingMessage): number {
  const raw = readHeader(req, BASE_REVISION_HEADER);
  if (raw === undefined || raw.trim() === '') {
    throw new AppError('VALIDATION_FAILED', `写操作必须携带 ${BASE_REVISION_HEADER} 头`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError('VALIDATION_FAILED', `${BASE_REVISION_HEADER} 必须是非负整数`);
  }
  return value;
}

/** C0 控制字符与 DEL：避免把换行/终端转义写进名字。 */
function hasControlChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('VALIDATION_FAILED', '请求体必须是 JSON 对象');
  }
  return body as Record<string, unknown>;
}

export interface StringFieldOptions {
  min: number;
  max: number;
  /** 提示给客户端的字段名，默认取 key。 */
  label?: string;
}

/** 取必填字符串字段并做长度/控制字符校验；不做 trim，调用方需要时自行 trim。 */
export function requireStringField(
  source: Record<string, unknown>,
  key: string,
  options: StringFieldOptions,
): string {
  const label = options.label ?? key;
  const value = source[key];
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_FAILED', `${label} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length < options.min) {
    throw new AppError('VALIDATION_FAILED', `${label} 不能为空`);
  }
  if (trimmed.length > options.max) {
    throw new AppError('VALIDATION_FAILED', `${label} 过长（上限 ${options.max}）`);
  }
  if (hasControlChars(trimmed)) {
    throw new AppError('VALIDATION_FAILED', `${label} 含非法控制字符`);
  }
  return trimmed;
}

/** 取必填布尔字段；`"true"` 这类字符串不接受，避免客户端把语义猜错。 */
export function requireBooleanField(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    throw new AppError('VALIDATION_FAILED', `${key} 必须是布尔值`);
  }
  return value;
}

export interface ReadBodyOptions {
  maxBytes: number;
}/** 读取 JSON 请求体；空体返回 `undefined`，超限抛 413。 */
export function readJsonBody(req: IncomingMessage, options: ReadBodyOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.resume();
      reject(error);
    };

    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > options.maxBytes) {
        fail(new AppError('VALIDATION_FAILED', `请求体过大（上限 ${options.maxBytes} 字节）`, { status: 413 }));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      req.removeListener('error', onError);
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new AppError('VALIDATION_FAILED', '请求体不是合法 JSON'));
      }
    };

    const onError = (error: Error): void => {
      fail(new AppError('VALIDATION_FAILED', `读取请求体失败：${error.message}`));
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}
