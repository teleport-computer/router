import { describe, it, expect } from 'vitest';
import { loadConfig, saveConfig, getDefaults } from '../src/config.mjs';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('config', () => {
  it('loadConfig returns defaults when file missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'router-test-'));
    try {
      const cfg = loadConfig(join(dir, '.routerrc'));
      expect(cfg).toEqual(getDefaults());
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('saveConfig writes JSON readable by loadConfig', () => {
    const dir = mkdtempSync(join(tmpdir(), 'router-test-'));
    try {
      const path = join(dir, '.routerrc');
      saveConfig(path, { key: 'sk-x', server: 'https://example.com', last_skill_check_at: 1234 });
      const cfg = loadConfig(path);
      expect(cfg.key).toBe('sk-x');
      expect(cfg.server).toBe('https://example.com');
      expect(cfg.last_skill_check_at).toBe(1234);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
