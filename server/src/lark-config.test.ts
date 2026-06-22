import { describe, expect, it, beforeEach } from 'vitest';
import { _resetLarkConfigCache, loadLarkConfig } from './lark-config.js';

describe('loadLarkConfig', () => {
  beforeEach(() => {
    _resetLarkConfigCache();
    delete process.env.LARK_BOT_ENABLED;
    process.env.LARK_APP_ID = 'app_test';
    process.env.LARK_APP_SECRET = 'secret_test';
    process.env.LARK_REDIRECT_URI = 'http://localhost/cb';
    process.env.LARK_STATE_SECRET = 'state_test';
  });

  it('botEnabled defaults to false when LARK_BOT_ENABLED unset', () => {
    const cfg = loadLarkConfig();
    expect(cfg?.botEnabled).toBe(false);
  });

  it('botEnabled true when LARK_BOT_ENABLED=true', () => {
    process.env.LARK_BOT_ENABLED = 'true';
    _resetLarkConfigCache();
    const cfg = loadLarkConfig();
    expect(cfg?.botEnabled).toBe(true);
  });

  it('botEnabled false when LARK_BOT_ENABLED=false', () => {
    process.env.LARK_BOT_ENABLED = 'false';
    _resetLarkConfigCache();
    const cfg = loadLarkConfig();
    expect(cfg?.botEnabled).toBe(false);
  });

  it('verificationToken populates from LARK_VERIFICATION_TOKEN env', () => {
    process.env.LARK_VERIFICATION_TOKEN = 'vt_x';
    _resetLarkConfigCache();
    const cfg = loadLarkConfig();
    expect(cfg?.verificationToken).toBe('vt_x');
    delete process.env.LARK_VERIFICATION_TOKEN;
  });
});
