export interface MatrixLinkCopy {
  message: string;
  agentPrompt: string;
}

export function buildMatrixLinkCopy(input: {
  code: string;
  expiresAt?: number;
  setupUrl?: string;
}): MatrixLinkCopy {
  const expiresLine = input.expiresAt
    ? `This code expires at ${new Date(input.expiresAt).toISOString()}.`
    : 'This code expires in about 10 minutes.';
  const setupLine = input.setupUrl
    ? `If your agent is not connected to Shape Router yet, connect it first at ${input.setupUrl}.`
    : 'If your agent is not connected to Shape Router yet, connect it first, then paste this prompt.';

  const agentPrompt = [
    'Please link my Matrix account to this Shape Router account.',
    '',
    'Call the `router_link_matrix` tool with this code:',
    input.code,
    '',
    'If you need JSON arguments, use:',
    `{ "code": "${input.code}" }`,
    '',
    'After it succeeds, tell me which Router handle was linked.',
  ].join('\n');

  return {
    agentPrompt,
    message: [
      'To link this Matrix account to Shape Router:',
      '',
      '1. Open the agent where Shape Router is connected.',
      '2. Copy and paste everything between the lines below.',
      '',
      '--- copy into agent ---',
      agentPrompt,
      '--- end copy ---',
      '',
      expiresLine,
      setupLine,
    ].join('\n'),
  };
}

export function buildMatrixAlreadyLinkedCopy(input: {
  handle: string;
  setupUrl?: string;
}): MatrixLinkCopy {
  const setupLine = input.setupUrl
    ? `To reconnect an agent, open ${input.setupUrl} and use your existing Shape Router credentials.`
    : 'To reconnect an agent, open Shape Router setup and use your existing credentials.';
  const agentPrompt = `My Matrix account is already linked to Shape Router as @${input.handle}. Please confirm the connected Router account before continuing.`;

  return {
    agentPrompt,
    message: [
      `This Matrix account is already linked to Shape Router as @${input.handle}.`,
      '',
      'If your agent is already connected, you can continue using Router there.',
      setupLine,
    ].join('\n'),
  };
}

export function buildMatrixProvisionCopy(input: {
  handle: string;
  secretKey: string;
  setupUrl: string;
  mcpUrl: string;
}): MatrixLinkCopy {
  const agentPrompt = [
    'Please connect me to Shape Router.',
    '',
    `Router handle: @${input.handle}`,
    '',
    'Use this MCP server URL:',
    input.mcpUrl,
    '',
    'If your client asks for a key separately, use this secret_key:',
    input.secretKey,
    '',
    'After connecting, call Router context or whoami and confirm the connected handle.',
  ].join('\n');

  return {
    agentPrompt,
    message: [
      `Created and linked your Shape Router account as @${input.handle}.`,
      '',
      'Copy and paste everything between the lines below into your agent setup flow.',
      '',
      '--- copy into agent ---',
      agentPrompt,
      '--- end copy ---',
      '',
      `Setup page: ${input.setupUrl}`,
      '',
      'Treat the secret_key like a password. Do not paste it in public rooms.',
    ].join('\n'),
  };
}
