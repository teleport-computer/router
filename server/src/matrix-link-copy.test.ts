import { describe, expect, it } from 'vitest';
import {
  buildMatrixAlreadyLinkedCopy,
  buildMatrixLinkCopy,
  buildMatrixProvisionCopy,
} from './matrix-link-copy.js';

describe('matrix link copy', () => {
  it('builds a paste-ready agent prompt for redeeming a Matrix link code', () => {
    const copy = buildMatrixLinkCopy({
      code: 'MATRIX-ABC12345',
      expiresAt: Date.parse('2026-05-26T12:00:00Z'),
      setupUrl: 'https://shape.example/setup',
    });

    expect(copy.agentPrompt).toContain('Call the `router_link_matrix` tool');
    expect(copy.agentPrompt).toContain('MATRIX-ABC12345');
    expect(copy.agentPrompt).toContain('{ "code": "MATRIX-ABC12345" }');
    expect(copy.message).toContain('--- copy into agent ---');
    expect(copy.message).toContain('https://shape.example/setup');
  });

  it('builds a provision message without hiding the setup credentials', () => {
    const copy = buildMatrixProvisionCopy({
      handle: 'alice',
      secretKey: 'rtr_secret',
      setupUrl: 'https://shape.example/setup',
      mcpUrl: 'https://shape.example/mcp/sse?key=rtr_secret',
    });

    expect(copy.message).toContain('Created and linked your Shape Router account as @alice.');
    expect(copy.agentPrompt).toContain('Router handle: @alice');
    expect(copy.agentPrompt).toContain('rtr_secret');
    expect(copy.agentPrompt).toContain('https://shape.example/mcp/sse?key=rtr_secret');
  });

  it('builds a clear already-linked response', () => {
    const copy = buildMatrixAlreadyLinkedCopy({
      handle: 'alice',
      setupUrl: 'https://shape.example/setup',
    });

    expect(copy.message).toContain('already linked to Shape Router as @alice');
    expect(copy.agentPrompt).toContain('@alice');
  });
});
