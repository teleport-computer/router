/**
 * Entry-write prompts — single file holding the LLM-facing prompts that
 * teach different surfaces how to create router entries.
 *
 *   - ROUTER_WRITE_TOOL_DESCRIPTION : CC reads via tools/list (router_write MCP tool)
 *   - buildLarkSummarizePrompt(...)  : DeepSeek reads server-side for /summarize
 *
 * When you edit ONE, review the OTHER right below and keep rules coherent
 * (especially around tags). Co-location, not abstraction.
 */

import type { Storage } from './storage.js';

// ────────────────────────────────────────────────────────────
// Server-side limits + validators
// ────────────────────────────────────────────────────────────

export const TAG_MAX = 5;

/**
 * Tag-picking rules — the SINGLE source for both surfaces (CC router_write
 * and Lark summarize). When you change this, both LLMs see the change.
 */
export const TAG_RULES_FOR_LLM = `1-${TAG_MAX} tags (server-enforced max), aim for 2-4 covering different dimensions. Lowercase + hyphens. Reuse existing tags from the listing whenever semantically close — exact match not required. Only invent when nothing fits. Example: ["project-x","frontend","decision"].`;

export function normalizeTags(input: readonly string[], alwaysInclude: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...alwaysInclude, ...input]) {
    const v = (t ?? '').trim().toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= TAG_MAX) break;
  }
  return out;
}

/** Render preset + team-used custom tags. Used by both router_tags MCP and Lark prompt. */
export async function renderTagContextForLLM(
  storage: Pick<Storage, 'getPresetTags' | 'getTagStats'>,
  teamId: string,
): Promise<string> {
  const [presets, stats] = await Promise.all([
    storage.getPresetTags(),
    storage.getTagStats(teamId),
  ]);
  const presetNames = new Set(presets.map(t => t.name));
  const customStats = stats.filter(s => !presetNames.has(s.tag)).slice(0, 30);

  const lines: string[] = [];
  lines.push('# Preset tags:');
  for (const t of presets) {
    const stat = stats.find(s => s.tag === t.name);
    const countStr = stat ? ` (used ${stat.count} times)` : '';
    lines.push(`  - ${t.name}: ${t.description}${countStr}`);
  }
  if (customStats.length > 0) {
    lines.push('');
    lines.push('# Custom tags (from team usage):');
    for (const s of customStats) {
      lines.push(`  - ${s.tag} (used ${s.count} times)`);
    }
  }
  if (presets.length === 0 && customStats.length === 0) {
    lines.push('(No tags exist yet — pick short, generic, reusable names.)');
  }
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────
// Surface 1: CC via router_write MCP tool
// ────────────────────────────────────────────────────────────

export const ROUTER_WRITE_TOOL_DESCRIPTION = `Post an entry to the Teleport Router team notebook.

When to call this
Only post when the user has clearly asked you to — phrases like "sync", "push to router", "save this", "put this in router", or the equivalent in whatever language they're speaking. If they're being vague, ask first. Don't sync background chatter or routine tool use.

Tagging — reuse first, invent last
Call router_tags first to see the available tag list (preset tags + team custom tags). The goal is tag reuse across the team, not precision — fewer, reused tags make search work.

Rules:
1. 1-5 tags per entry (hard limit, server enforces). Aim for 2-4 covering different dimensions (domain / activity / project); single-tag entries are fine when only one truly fits — don't pad.
2. REUSE over invent. When an existing tag is semantically close — even if not a perfect match — use it. Examples: an MCP-protocol change → "backend" + "feature", not a new "mcp" tag; an OAuth setup flow → "onboarding", not a new "oauth-setup" tag; a build pipeline tweak → "infra", not a new "ci".
3. Prefer preset tags over custom tags. Prefer high-usage custom tags over low-usage ones. Only invent a brand-new tag when nothing in the list is within reasonable semantic distance — and when you do, pick a name the team is likely to reuse (short, generic, lowercase + hyphens).
4. If posting to a channel, ALSO add the matching project tag so the entry is discoverable via tag search across channels. For example, posting to #my-project should also carry the "my-project" tag; posting to #design should also carry the "design" tag (when those tags exist).

Timeline-worthy entries
When the entry records something the team will want to look back on as a project node — a decision made, a milestone reached, something shipped, a release cut, an incident, or a retro — also include the matching tag (decision / milestone / shipped / release / incident / retro). These tags promote the entry into a channel's Timeline view.

Project context
If you're running inside a project (has .git or CLAUDE.md), prefix the summary with "[project: <repo> @ <branch>]" so the team knows the entry's home base. Get the branch with \`git branch --show-current\`. Skip this outside a project.

Fields
- oneliner: a 10–15 char headline for sharing ("PG migration done", "Fixed IME bug", "v0.1.0 shipped"). Plain text, no markdown. Keep it punchy — this is a headline, not a sentence.
- summary: 2–3 plain-text sentences. No markdown (no #, *, -, fences, links) — any markdown syntax renders literally. Newlines ARE rendered (pre-wrap) — use \\n to split distinct points onto separate lines so the card is scannable at a glance.
- content: the full body in markdown — headings, lists, code blocks, links. Optional, but recommended whenever there's substance (rationale, code, step-by-step, errors, links). Without content, there's nothing to expand into when someone clicks "Show full content".
- tags: ${TAG_RULES_FOR_LLM}
- role: frontend / backend / design / pm / infra, based on what the entry is about.
- channel: set this when the user names one (e.g. "push to #my-project").
- Write in whatever language the user is using. Don't translate their words into English to sound more official.

Two-step flow
1. First call (without _confirmed): returns a formatted preview — show it to the user.
2. If the user approves (or doesn't object), call again with ALL the same params plus _confirmed: true to actually publish.

After the confirmed sync, tell the user:
1. Confirm it synced (and to which channel, if any).
2. Which tags you picked + a one-line reason.
3. Entry ID + when it publishes (staging delay).
Never leave the user guessing what you actually saved.`;

/** Suffix appended to router_tags tool output. */
export const ROUTER_TAGS_REUSE_GUIDANCE = [
  'Reuse first: pick an existing tag whenever it is semantically close — exact match not required (e.g. an MCP-protocol change → "backend" + "feature", not a new "mcp" tag).',
  'Prefer presets over custom tags; prefer high-usage custom tags over low-usage ones.',
  'Only invent a new tag when nothing above is within reasonable semantic distance — and pick a short, generic name the team is likely to reuse.',
].join('\n');

// ────────────────────────────────────────────────────────────
// Surface 2: Lark group via /summarize (DeepSeek server-side)
// ────────────────────────────────────────────────────────────

export type SummaryStyle = 'person' | 'topic' | 'free';

export interface LarkSummarizePromptArgs {
  chatName: string;
  interpretation: string;
  messageBlock: string;
  messageCount: number;
  tagContext: string;
  /** 'person' (default): "@hx 分享 X / Y" — 谁做的事开头  |
   *  'topic':            "X / Y — @hx" — 主题开头,作者尾标 */
  style?: SummaryStyle;
}

const UPDATES_RULES_PERSON = [
  `updates — 群里实际发生过的事。每条 ≤40 汉字。**尽量收全**,以下都要进:`,
  `  · 谁做了/做完什么实质动作(写代码/部署/发布/沟通)`,
  `  · 谁分享了什么(链接/Figma/文档/截图/资料)`,
  `  · 谁提出的想法或提议(还没拍板的"我觉得 X 更好"也算)`,
  `  · 重要 FYI / 状态更新 / 时间承诺(下周做 X、晚点交付)`,
  `  合并: 同一人做的相关动作默认合一条(用顿号连接,例: "@hx 分享 Figma + 设计规范 + three.js 文档")。`,
  `  例外不合: 跨人协作流程(@A 让 @B 干 X 是 A→B 节点,即使 A 还做了别的也独立成行);时间承诺单独成行。`,
  `  忽略: 闲聊、问候、附和"嗯/ok"、表情反应。`,
];

const UPDATES_RULES_TOPIC = [
  `updates — 群里实际发生过的事,**按主题分组,作者尾标**。每条 ≤40 汉字。**尽量收全**,以下都要进:`,
  `  · 实质动作(写代码 / 部署 / 发布 / 沟通)`,
  `  · 分享内容(链接 / Figma / 文档 / 截图 / 资料)`,
  `  · 想法 / 提议(还没拍板的"我觉得 X 更好"也算)`,
  `  · 重要 FYI / 状态更新 / 时间承诺`,
  `  **格式**: \`<主题或动作描述> — @作者\` (用 em-dash 分隔)`,
  `  例: "TEE / Teleport 愿景介绍 — @Sevenfloor Tan"`,
  `  跨人协作: \`<动作> — @A → @B\` (例: "Figma 文件统一管理 — @Sevenfloor Tan → @Kira")`,
  `  合并: 同一作者的相关主题默认合一条(用顿号或 / 连接);不同主题分开;时间承诺单独一行。`,
  `  忽略: 闲聊、问候、附和、表情反应。`,
];

export function buildLarkSummarizePrompt(args: LarkSummarizePromptArgs): string {
  if (args.style === 'free') {
    // No formatting rules — let the LLM choose. Only the JSON schema and tag
    // rule (server needs them) remain as constraints.
    return [
      `你是 router 群聊摘要助手。把下面的群聊总结成一条 router entry,JSON 输出。`,
      ``,
      `字段:`,
      `  tldr            — 1 句核心结论`,
      `  updates         — 进展 / 分享 / 想法 / 状态变化 列表`,
      `  decisions       — 已拍板的决定 列表`,
      `  todo            — 待办 列表,每项 { who?, what }`,
      `  open_questions  — 未解决的疑问 列表`,
      `  tags            — ${TAG_RULES_FOR_LLM} 不要写 "lark-summary"。`,
      ``,
      `没有就空数组 / 空字符串。全程中文。其余风格、长度、合并方式自己决定。`,
      ``,
      `[输出 — 严格 JSON,不要 \`\`\`json 包裹]`,
      ``,
      `{`,
      `  "tldr": "...",`,
      `  "updates": ["..."],`,
      `  "decisions": ["..."],`,
      `  "todo": [{"who": "@xxx", "what": "..."}],`,
      `  "open_questions": ["..."],`,
      `  "tags": ["..."]`,
      `}`,
      ``,
      `[可用 tag 清单 — 优先复用]`,
      ``,
      args.tagContext,
      ``,
      `[输入]`,
      `群名: ${args.chatName}`,
      `时间范围: ${args.interpretation}`,
      `对话记录(${args.messageCount} 条):`,
      ``,
      args.messageBlock,
    ].join('\n');
  }

  const updatesRules = args.style === 'topic' ? UPDATES_RULES_TOPIC : UPDATES_RULES_PERSON;
  return [
    `你是 router 群聊摘要助手。把下面的群聊压缩成结构化 JSON,作为 router 上的一条 entry 保存。`,
    ``,
    `[字段]`,
    ``,
    `tldr — 1 句话总览,≤30 汉字。说群里今天最重要的那件事,不要"大家讨论了 X"这种元描述。`,
    ``,
    ...updatesRules,
    ``,
    `decisions — 已**明确达成共识**的决定。每条 ≤50 汉字。`,
    `  要有"就这样"、"OK 就 X"、"那么 X" 这类拍板语气才算;"我觉得 X 好"或"试试 X 看看"放 updates。`,
    ``,
    `todo — { who?, what },what ≤40 汉字。`,
    `  新分配出来的任务(@某人 你来 X)或明确承诺(我下午做完 X)才放这里;普通自陈放 updates。`,
    `  who: 原文有 @某人就填,无 @ 但语义清楚也可填名字。`,
    ``,
    `open_questions — 被提出但未解决的实质疑问。每条 ≤50 汉字。`,
    ``,
    `tags — ${TAG_RULES_FOR_LLM}`,
    `  不要写 "lark-summary",服务端会自动加。`,
    ``,
    `[全局]`,
    ``,
    `- 全程中文。`,
    `- 提到群成员时,姓名前**必须**加 @ (例: @Hx Zhang),不论原文是否有 @。`,
    `- 不发明对话里没有的内容。信息不足就给 []空数组,别写"无"/"暂无"。`,
    ``,
    `[输出 — 严格 JSON,不要 \`\`\`json 包裹]`,
    ``,
    `{`,
    `  "tldr": "...",`,
    `  "updates": ["..."],`,
    `  "decisions": ["..."],`,
    `  "todo": [{"who": "@xxx", "what": "..."}],`,
    `  "open_questions": ["..."],`,
    `  "tags": ["..."]`,
    `}`,
    ``,
    `[可用 tag 清单 — 优先复用]`,
    ``,
    args.tagContext,
    ``,
    `[输入]`,
    `群名: ${args.chatName}`,
    `时间范围: ${args.interpretation}`,
    `对话记录(${args.messageCount} 条):`,
    ``,
    args.messageBlock,
  ].join('\n');
}
