import { describe, expect, it } from 'vitest';

import {
  ConfigValidationError,
  CoreNotImplementedError,
  ReleaseError,
  TimeError,
} from '@petbattle/core';
import type { ReleaseErrorReason } from '@petbattle/core';

import { AppError, STATUS_BY_CODE, mapError } from '../src/errors.js';

describe('mapError：领域错误 → 稳定错误码', () => {
  it('CoreNotImplementedError → NOT_IMPLEMENTED 501', () => {
    const mapped = mapError(new CoreNotImplementedError('advanceProfile'));
    expect(mapped.code).toBe('NOT_IMPLEMENTED');
    expect(mapped.status).toBe(501);
  });

  it('TimeError(time_backwards) → TIME_BACKWARDS 400', () => {
    const mapped = mapError(new TimeError('time_backwards'));
    expect(mapped.code).toBe('TIME_BACKWARDS');
    expect(mapped.status).toBe(400);
  });

  it('ConfigValidationError → CONFIG_INVALID 500，并带 issues', () => {
    const mapped = mapError(
      new ConfigValidationError([{ path: 'species[0].id', code: 'missing_field', message: '缺少 id' }]),
    );
    expect(mapped.code).toBe('CONFIG_INVALID');
    expect(mapped.status).toBe(500);
    expect(mapped.details).toEqual({
      issues: [{ path: 'species[0].id', code: 'missing_field', message: '缺少 id' }],
    });
  });

  it('未知异常 → INTERNAL 500，不泄露内部信息', () => {
    const mapped = mapError(new Error('boom: db password=secret'));
    expect(mapped.code).toBe('INTERNAL');
    expect(mapped.status).toBe(500);
    expect(mapped.message).toBe('内部错误');
  });

  it('非 Error 值也能映射', () => {
    const mapped = mapError('weird');
    expect(mapped.code).toBe('INTERNAL');
    expect(mapped.message).toBe('内部错误');
  });
});

const RELEASE_CASES: Array<[ReleaseErrorReason, string, number]> = [
  ['pet_not_found', 'PET_NOT_FOUND', 404],
  ['cannot_release_egg', 'EGG_NOT_RELEASABLE', 409],
  ['pet_locked', 'PET_LOCKED', 409],
  ['in_lineup', 'PET_IN_USE', 409],
  ['in_habitat', 'PET_IN_USE', 409],
  ['last_adult', 'LAST_ADULT', 409],
];

describe('mapError：ReleaseError.reason 映射', () => {
  it.each(RELEASE_CASES)('%s → %s / %i', (reason, code, status) => {
    const mapped = mapError(new ReleaseError(reason));
    expect(mapped.code).toBe(code);
    expect(mapped.status).toBe(status);
  });
});

describe('AppError', () => {
  it('默认使用错误码对应状态，可显式覆盖', () => {
    expect(new AppError('NOT_FOUND', 'x').status).toBe(404);
    expect(new AppError('VALIDATION_FAILED', '过大', { status: 413 }).status).toBe(413);
  });

  it('mapError 保留 details', () => {
    const mapped = mapError(new AppError('REVISION_CONFLICT', '冲突', { details: { latestRevision: 3 } }));
    expect(mapped.code).toBe('REVISION_CONFLICT');
    expect(mapped.details).toEqual({ latestRevision: 3 });
  });
});

describe('STATUS_BY_CODE', () => {
  it('覆盖全部错误码且状态合法', () => {
    const entries = Object.entries(STATUS_BY_CODE);
    expect(entries.length).toBeGreaterThan(20);
    for (const [, status] of entries) {
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });
});
