#!/usr/bin/env node
// Local stdio MCP shim: presents ONE Router to Claude, backed by a primary
// instance (shaperotator) for tools/list + all reads + the interactive
// router_write flow. On a CONFIRMED router_write, replays the same payload to
// the secondary instances with the skill+preview gates bypassed.
//
// Config: ~/.claude/router-simulcast.json
//   { "primary":     { "name": "shaperotator", "url": "https://.../mcp/?key=KEY" },
//     "secondaries": [ { "name": "feedling", "url": "https://.../mcp/sse?key=KEY" }, ... ] }
// Transport is inferred from the URL path (.../mcp/sse → SSE, else streamable HTTP),
// or set explicitly per-instance with "transport": "sse" | "http".
//
// stdout is reserved for the MCP protocol — all logging goes to stderr.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const log = (...a) => console.error('[simulcast]', ...a);
const CONFIG_PATH = join(homedir(), '.claude', 'router-simulcast.json');

if (!existsSync(CONFIG_PATH)) {
  writeFileSync(CONFIG_PATH, JSON.stringify({
    primary: { name: 'shaperotator', url: 'https://shaperotator.teleport.computer/mcp/sse?key=PASTE_KEY' },
    secondaries: [
      { name: 'feedling', url: 'https://router.feedling.app/mcp/sse?key=PASTE_KEY' },
      { name: 'public', url: 'https://PASTE_PUBLIC_HOST/mcp/sse?key=PASTE_KEY' },
    ],
  }, null, 2) + '\n');
  log(`wrote config stub to ${CONFIG_PATH} — fill in the URLs+keys and rerun.`);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

async function connect(inst) {
  const url = new URL(inst.url);
  const kind = inst.transport ?? (url.pathname.endsWith('/mcp/sse') ? 'sse' : 'http');
  const transport = kind === 'sse' ? new SSEClientTransport(url) : new StreamableHTTPClientTransport(url);
  const client = new Client({ name: `simulcast→${inst.name}`, version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { ...inst, client, toolNames: new Set(tools.map(t => t.name)) };
}

// Primary connection is fatal if it fails — it's the daily driver.
const primary = await connect(cfg.primary);
log(`primary connected: ${primary.name}`);

// Secondaries are best-effort: a dead mirror must not take down the shim.
const secondaries = [];
for (const sec of cfg.secondaries ?? []) {
  try {
    secondaries.push(await connect(sec));
    log(`secondary connected: ${sec.name}`);
  } catch (e) {
    secondaries.push({ ...sec, client: null, connectError: e.message });
    log(`secondary FAILED to connect: ${sec.name} — ${e.message}`);
  }
}
const allInstances = [primary, ...secondaries];
const findInst = (n) => allInstances.find(i => i.name === n);

// Read tools that are safe to fan out + merge across instances. Mutations and
// identity/integration calls are NOT here — they default to primary, or target
// a single instance via simulcast_call.
const AGGREGATE_READS = new Set([
  'router_search', 'router_brief', 'router_tags', 'router_channels',
  'router_get_entry', 'router_search_sparks', 'router_memory_get',
]);

const META_TOOLS = [
  {
    name: 'simulcast_instances',
    description: 'List the Router instances behind the simulcast shim: name, role (primary/secondary), connected status, and the tools each one exposes. Call this to discover per-instance capabilities before using simulcast_call.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'simulcast_call',
    description: 'Call a tool on ONE specific Router instance (bypasses aggregation and write fan-out). Use to target a single instance — e.g. write to the public instance via its router_write_entry tool, or reach instance-specific tools. instance = a name from simulcast_instances; tool = that instance\'s tool name; arguments = that tool\'s args.',
    inputSchema: {
      type: 'object',
      properties: {
        instance: { type: 'string', description: 'Instance name (e.g. shaperotator, feedling, public)' },
        tool: { type: 'string', description: 'Tool name on that instance' },
        arguments: { type: 'object', description: 'Arguments object for the tool', additionalProperties: true },
      },
      required: ['instance', 'tool'],
      additionalProperties: false,
    },
  },
];

const textOf = (res) => (res?.content ?? []).filter(c => c.type === 'text').map(c => c.text).join(' ').trim();
const errResult = (text) => ({ content: [{ type: 'text', text }], isError: true });

const server = new Server({ name: 'router-simulcast', version: '0.1.0' }, { capabilities: { tools: {} } });

// tools/list = primary's live list (descriptions reflect shaperotator's current
// tags/presets/team-memory) + the shim's own meta tools.
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const { tools } = await primary.client.listTools();
  // Advertise the simulcast-only `public` flag on router_write so the client
  // will actually pass it through (unknown args get dropped otherwise).
  const patched = tools.map(t => t.name !== 'router_write' ? t : {
    ...t,
    description: `${t.description}\n\nSIMULCAST: this entry fans out to all instances (${allInstances.map(i => i.name).join(', ')}) by default. Before confirming, consult ~/.claude/router-simulcast-public-rules.md + judgment. To steer: set public:false to hold a context-sensitive entry off the public notebook; or set targets to an explicit subset of instance names (e.g. ["feedling"] for one only, ["shaperotator","public"] to skip another). targets overrides public.`,
    inputSchema: {
      ...t.inputSchema,
      properties: {
        ...(t.inputSchema?.properties ?? {}),
        public: { type: 'boolean', description: 'Mirror this entry to the public notebook? Default true. Set false to hold a context-sensitive entry team-only.' },
        targets: { type: 'array', items: { type: 'string' }, description: `Write only to these instances by name (subset of: ${allInstances.map(i => i.name).join(', ')}). Default: all. Overrides the public flag.` },
      },
    },
  });
  return { tools: [...patched, ...META_TOOLS] };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  // ── Meta: enumerate instances ──
  if (name === 'simulcast_instances') {
    const rows = allInstances.map(i => ({
      name: i.name,
      role: i === primary ? 'primary' : 'secondary',
      connected: !!i.client,
      ...(i.client ? { tools: [...i.toolNames] } : { error: i.connectError }),
    }));
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  }

  // ── Meta: target one instance ──
  if (name === 'simulcast_call') {
    const inst = findInst(args.instance);
    if (!inst) return errResult(`unknown instance "${args.instance}". Known: ${allInstances.map(i => i.name).join(', ')}`);
    if (!inst.client) return errResult(`instance "${inst.name}" not connected: ${inst.connectError}`);
    return inst.client.callTool({ name: args.tool, arguments: args.arguments ?? {} });
  }

  // ── Aggregated reads: fan out to every instance that has the tool, merge ──
  if (AGGREGATE_READS.has(name)) {
    const parts = [];
    for (const inst of allInstances) {
      if (!inst.client) { parts.push(`### ${inst.name}\n(not connected: ${inst.connectError})`); continue; }
      if (!inst.toolNames.has(name)) { parts.push(`### ${inst.name}\n(no ${name})`); continue; }
      try {
        const r = await inst.client.callTool({ name, arguments: args });
        parts.push(`### ${inst.name}\n${textOf(r) || '(empty)'}`);
      } catch (e) {
        parts.push(`### ${inst.name}\n✗ ${e.message}`);
      }
    }
    return { content: [{ type: 'text', text: parts.join('\n\n') }] };
  }

  // ── router_write: preview via primary, confirmed write to the target set ──
  if (name === 'router_write') {
    const { public: publicFlag, targets, ...fwdArgs } = args;

    // Preview / skill rounds (no commit) always run through primary for the
    // richest UX (its live tags + prewrite skills shape the preview).
    if (fwdArgs._confirmed !== true) return primary.client.callTool({ name, arguments: fwdArgs });

    // Resolve targets: explicit `targets` wins; else all instances, minus
    // public when the public flag is off.
    const names = Array.isArray(targets) && targets.length
      ? [...targets]
      : allInstances.map(i => i.name).filter(n => publicFlag === false ? n !== 'public' : true);
    const unknown = names.filter(n => !findInst(n));
    if (unknown.length) return errResult(`router_write: unknown target(s) ${unknown.join(', ')}. Known: ${allInstances.map(i => i.name).join(', ')}.`);
    if (!names.length) return errResult('router_write: no targets selected.');

    let primaryResult = null;
    const reports = [];
    for (const nm of names) {
      const inst = findInst(nm);
      const tag = inst === primary ? ' (primary)' : '';
      if (!inst.client) { reports.push(`${nm}: ✗ not connected (${inst.connectError})`); continue; }
      try {
        if (inst.toolNames.has('router_write')) {
          const r = await inst.client.callTool({ name: 'router_write', arguments: { ...fwdArgs, _skill_executed: true, _confirmed: true } });
          if (inst === primary) primaryResult = r;
          reports.push(`${nm}: ${r.isError ? '✗ ' + textOf(r) : '✓' + tag}`);
        } else if (inst.toolNames.has('router_write_entry')) {
          const entry = [fwdArgs.summary, fwdArgs.content].filter(Boolean).join('\n\n');
          const r = await inst.client.callTool({
            name: 'router_write_entry',
            arguments: {
              client: 'code', entry,
              search_keywords: [...(fwdArgs.tags ?? []), ...(fwdArgs.search_keywords ?? [])].slice(0, 8),
              sensitivity_check: 'Auto-mirrored from a team sync; context-sensitive entries are held via the public flag or targets. Nothing flagged here.',
            },
          });
          reports.push(`${nm}: ${r.isError ? '✗ ' + textOf(r) : '✓ (public)'}`);
        } else {
          reports.push(`${nm}: ✗ no write tool`);
        }
      } catch (e) { reports.push(`${nm}: ✗ ${e.message}`); }
    }
    log('simulcast:', reports.join(' | '));
    const base = primaryResult ?? { content: [{ type: 'text', text: `Written to: ${names.join(', ')} (primary not targeted).` }] };
    return { ...base, content: [...(base.content ?? []), { type: 'text', text: `\n\n— Simulcast —\n${reports.join('\n')}` }] };
  }

  // ── Everything else routes to primary ──
  return primary.client.callTool({ name, arguments: args });
});

await server.connect(new StdioServerTransport());
log('stdio server ready');
