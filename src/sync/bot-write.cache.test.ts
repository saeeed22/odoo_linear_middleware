import { vi, describe, it, expect, beforeEach } from 'vitest';

const { mockSet, mockGetdel } = vi.hoisted(() => ({
  mockSet: vi.fn().mockResolvedValue('OK'),
  mockGetdel: vi.fn().mockResolvedValue(null),
}));

vi.mock('ioredis', () => ({
  default: class {
    set = mockSet;
    getdel = mockGetdel;
    on = vi.fn();
  },
}));

vi.mock('../config/env', () => ({
  env: {
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: undefined,
  },
}));

import { markBotWrite, consumeBotWriteFlag } from './bot-write.cache';

describe('bot-write.cache', () => {
  beforeEach(() => {
    mockSet.mockClear();
    mockGetdel.mockClear();
  });

  describe('markBotWrite', () => {
    it('sets the Redis key with a 5-minute TTL', async () => {
      await markBotWrite(123);
      expect(mockSet).toHaveBeenCalledWith('bot-write:odoo:123', '1', 'EX', 300);
    });

    it('uses the correct key format for different IDs', async () => {
      await markBotWrite(999);
      expect(mockSet).toHaveBeenCalledWith('bot-write:odoo:999', '1', 'EX', 300);
    });
  });

  describe('consumeBotWriteFlag', () => {
    it('returns true and deletes the key when the flag is set', async () => {
      mockGetdel.mockResolvedValue('1');
      const result = await consumeBotWriteFlag(123);
      expect(result).toBe(true);
      expect(mockGetdel).toHaveBeenCalledWith('bot-write:odoo:123');
    });

    it('returns false when the flag is not set', async () => {
      mockGetdel.mockResolvedValue(null);
      const result = await consumeBotWriteFlag(123);
      expect(result).toBe(false);
    });

    it('uses the correct key format for different IDs', async () => {
      mockGetdel.mockResolvedValue(null);
      await consumeBotWriteFlag(456);
      expect(mockGetdel).toHaveBeenCalledWith('bot-write:odoo:456');
    });
  });
});
