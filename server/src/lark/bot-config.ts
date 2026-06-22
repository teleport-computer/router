/**
 * Display name shown in user-facing help text / cards / error messages.
 * Override per deployment via env var:  LARK_BOT_DISPLAY_NAME=YourBotName
 */
export const BOT_NAME = process.env.LARK_BOT_DISPLAY_NAME || 'Router Bot';
