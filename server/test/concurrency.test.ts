import { describe, expect, it } from 'vitest';

import { KeyedMutex, Semaphore } from '../src/concurrency.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

describe('KeyedMutex', () => {
  it('同一 key 串行执行，不交叉', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];

    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await tick();
      events.push(`${name}:end`);
    };

    await Promise.all([
      mutex.run('a', task('a1')),
      mutex.run('a', task('a2')),
      mutex.run('a', task('a3')),
    ]);

    expect(events).toEqual(['a1:start', 'a1:end', 'a2:start', 'a2:end', 'a3:start', 'a3:end']);
    expect(mutex.size).toBe(0);
  });

  it('不同 key 并行执行', async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];

    await Promise.all([
      mutex.run('a', async () => {
        events.push('a:start');
        await tick();
        events.push('a:end');
      }),
      mutex.run('b', async () => {
        events.push('b:start');
        await tick();
        events.push('b:end');
      }),
    ]);

    expect(events.slice(0, 2).sort()).toEqual(['a:start', 'b:start']);
  });

  it('任务抛错不会卡住后续任务', async () => {
    const mutex = new KeyedMutex();
    const failing = mutex.run('a', async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');

    await expect(mutex.run('a', async () => 'ok')).resolves.toBe('ok');
    expect(mutex.size).toBe(0);
  });
});

describe('Semaphore', () => {
  it('并发不超过上限', async () => {
    const semaphore = new Semaphore(2);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 6 }, () =>
        semaphore.run(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await tick();
          active -= 1;
        }),
      ),
    );

    expect(peak).toBe(2);
    expect(semaphore.pending).toBe(0);
  });

  it('非法上限直接抛错', () => {
    expect(() => new Semaphore(0)).toThrow();
  });

  it('任务抛错仍然释放名额', async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(semaphore.run(async () => 'ok')).resolves.toBe('ok');
  });
});
