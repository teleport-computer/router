import { describe, expect, it } from 'vitest';
import { buildSummaryCard, buildErrorCard, buildEntryCard, buildNotificationCard, buildBindingGuideCard, buildRateLimitGuideCard, buildP2pHelpCard, buildP2pUnknownSlashCard, buildSaveEntryConfirmCard, buildSettingsCard } from './card-builder.js';

describe('buildSummaryCard', () => {
  it('renders all sections when populated', () => {
    const card = buildSummaryCard({
      summary: {
        tldr: 'foo',
        updates: ['u1'],
        decisions: ['d1'],
        todo: [{ who: '@a', what: 't1' }],
        open_questions: ['q1'],
        tags: [],
      },
      interpretation: '最近 1h',
      chatName: 'Demo',
    });
    const flat = JSON.stringify(card);
    expect(flat).toContain('TL;DR');
    expect(flat).toContain('Updates');
    expect(flat).toContain('Decisions');
    expect(flat).toContain('Todo');
    expect(flat).toContain('Open questions');
    expect(flat).toContain('foo');
    expect(flat).toContain('u1');
    expect(flat).toContain('d1');
    expect(flat).toContain('t1');
    expect(flat).toContain('q1');
    expect(flat).toContain('Demo');
    expect(flat).toContain('最近 1h');
  });

  it('skips empty sections (no "无" rendering)', () => {
    const card = buildSummaryCard({
      summary: { tldr: 'foo', updates: [], decisions: [], todo: [], open_questions: [], tags: [] },
      interpretation: 'x',
      chatName: 'D',
    });
    const flat = JSON.stringify(card);
    expect(flat).not.toContain('Updates');
    expect(flat).not.toContain('Decisions');
    expect(flat).not.toContain('Todo');
    expect(flat).not.toContain('Open questions');
    expect(flat).not.toContain('无');
    expect(flat).toContain('foo');
  });
});

describe('buildErrorCard', () => {
  it('produces a plain card with the message', () => {
    const card = buildErrorCard('something went wrong');
    expect(JSON.stringify(card)).toContain('something went wrong');
  });
});

describe('buildEntryCard', () => {
  const entry = {
    id: 'e1', handle: 'alice', teamId: 't', client: 'desktop' as const,
    content: 'c', summary: 'an entry summary', tags: ['feedling','design'],
    role: 'frontend', timestamp: 1745960000000,
  };
  it('renders a button-less card with the summary, tags, link and timestamp', () => {
    const card = buildEntryCard({ entry: entry as any, channelName: 'feedling', publicUrl: 'https://r.x' });
    const flat = JSON.stringify(card);
    expect(flat).toContain('an entry summary');
    expect(flat).toContain('feedling');
    expect(flat).toContain('查看详情');
    // No action block / button-driven UI
    expect(flat).not.toContain('"tag":"action"');
    expect(flat).not.toContain('mark_read');
  });
});

import { buildBindingResultCard } from './card-builder.js';

describe('buildBindingResultCard', () => {
  it('renders success message with tag link', () => {
    const card = buildBindingResultCard({ kind: 'success', message: '已连接到 #feedling', publicUrl: 'https://r.x', channelId: 'feedling' });
    const flat = JSON.stringify(card);
    expect(flat).toContain('已连接');
    expect(flat).toContain('#feedling');
    expect(flat).toContain('https://r.x/tags/feedling');
  });

  it('renders error message in red template', () => {
    const card = buildBindingResultCard({ kind: 'error', message: '找不到 channel #foo' });
    const flat = JSON.stringify(card);
    expect(flat).toContain('red');
    expect(flat).toContain('找不到');
  });

  it('omits link block when channelId not provided', () => {
    const card = buildBindingResultCard({ kind: 'success', message: 'ok' });
    expect(JSON.stringify(card)).not.toContain('查看 channel');
  });
});

import { buildHelpCard } from './card-builder.js';

describe('buildHelpCard', () => {
  it('lists slash-prefixed commands and their Chinese aliases', () => {
    const card = buildHelpCard();
    const flat = JSON.stringify(card);
    expect(flat).toContain('/connect');
    expect(flat).toContain('/disconnect');
    expect(flat).toContain('/archive');
    expect(flat).toContain('/push');
    expect(flat).toContain('/watch');
    expect(flat).toContain('/style');
    expect(flat).toContain('/settings');
    expect(flat).toContain('/summarize');
    expect(flat).toContain('/连接');
    expect(flat).toContain('/解绑');
    expect(flat).toContain('/归档');
    expect(flat).toContain('/推送');
    expect(flat).toContain('/观察');
    expect(flat).toContain('/风格');
    expect(flat).toContain('/设置');
    expect(flat).toContain('/帮助');
  });
});

describe('buildSummaryCard with saveOptions', () => {
  const baseArgs = {
    summary: { tldr: 't', updates: ['u'], decisions: [], todo: [], open_questions: [], tags: [] },
    interpretation: 'x',
    chatName: 'D',
  };
  it('omits action block when saveOptions absent', () => {
    const card = buildSummaryCard(baseArgs);
    expect(JSON.stringify(card)).not.toContain('"tag":"action"');
    expect(JSON.stringify(card)).not.toContain('select_static');
  });
  it('renders dropdown + save button when saveOptions present', () => {
    const card = buildSummaryCard({
      ...baseArgs,
      saveOptions: {
        summaryToken: 'tk_abc',
        channels: [{ id: 'feedling', name: 'feedling' }, { id: 'shipped', name: 'shipped' }],
        defaultChannelId: 'feedling',
      },
    });
    const flat = JSON.stringify(card);
    expect(flat).toContain('select_static');
    expect(flat).toContain('feedling');
    expect(flat).toContain('shipped');
    expect(flat).toContain('📤 Push');
    expect(flat).toContain('save_summary');
    expect(flat).toContain('tk_abc');
  });
  it('prepends (no tag) option as first dropdown entry', () => {
    const card = buildSummaryCard({
      ...baseArgs,
      saveOptions: {
        summaryToken: 'tk_abc',
        channels: [{ id: 'feedling', name: 'feedling' }],
        defaultChannelId: 'feedling',
      },
    });
    const flat = JSON.stringify(card);
    expect(flat).toContain('(no tag)');
    expect(flat).toContain('__none__');
    // The "(no tag)" plain_text must appear BEFORE the first tag option.
    expect(flat.indexOf('(no tag)')).toBeLessThan(flat.indexOf('#feedling'));
  });
  it('uses __none__ as initial selection when defaultChannelId is empty', () => {
    const card = buildSummaryCard({
      ...baseArgs,
      saveOptions: {
        summaryToken: 'tk_abc',
        channels: [{ id: 'feedling', name: 'feedling' }],
        defaultChannelId: '',
      },
    });
    const flat = JSON.stringify(card);
    expect(flat).toContain('"initial_option":"__none__"');
    expect(flat).toContain('"channel_id":"__none__"');
  });
  it('caps options to 50', () => {
    const channels = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, name: `c${i}` }));
    const card = buildSummaryCard({
      ...baseArgs,
      saveOptions: { summaryToken: 'tk', channels, defaultChannelId: 'c0' },
    });
    const flat = JSON.stringify(card);
    expect(flat).toContain('c0');
    expect(flat).toContain('c49');
    expect(flat).not.toContain('c50');
  });
});

describe('buildNotificationCard', () => {
  const baseLink = 'https://router.feedling.app/entry?id=ent123';

  it('renders mention with channel subtitle', () => {
    const card = buildNotificationCard({
      type: 'mention',
      fromHandle: 'andrew',
      preview: '看一下 timeline 的设计',
      channel: 'frontend',
      link: baseLink,
    });
    expect(card.header.title.content).toBe('💬 @andrew 提到你');
    const md = JSON.stringify(card.elements);
    expect(md).toContain('在 #frontend');
    expect(md).toContain('看一下 timeline 的设计');
    expect(md).toContain('在 router 查看');
    expect(md).toContain(baseLink);
  });

  it('renders comment without channel subtitle when channel is missing', () => {
    const card = buildNotificationCard({
      type: 'comment',
      fromHandle: 'leo',
      preview: '我觉得这个方案...',
      channel: undefined,
      link: 'https://x/entry?id=e1#comment-c1',
    });
    expect(card.header.title.content).toBe('📝 @leo 评论了你的 entry');
    const md = JSON.stringify(card.elements);
    expect(md).not.toContain('在 #');
    expect(md).toContain('comment-c1');
  });

  it('renders reply card', () => {
    const card = buildNotificationCard({
      type: 'reply',
      fromHandle: 'sam',
      preview: 'agree',
      channel: undefined,
      link: baseLink,
    });
    expect(card.header.title.content).toBe('↩ @sam 回复了你');
  });

  it('falls back when preview empty', () => {
    const card = buildNotificationCard({
      type: 'mention',
      fromHandle: 'a',
      preview: '',
      channel: undefined,
      link: baseLink,
    });
    expect(JSON.stringify(card.elements)).toContain('(无内容预览)');
  });

  it('truncates preview at 200 chars', () => {
    const long = 'x'.repeat(300);
    const card = buildNotificationCard({
      type: 'mention',
      fromHandle: 'a',
      preview: long,
      channel: undefined,
      link: baseLink,
    });
    const md = JSON.stringify(card.elements);
    expect(md).toContain('…');
    expect(md).not.toContain('x'.repeat(250));
  });
});

describe('buildBindingGuideCard', () => {
  it('renders all 4 capability sections + bind link', () => {
    const card = buildBindingGuideCard('https://r.test');
    expect(card.header.title.content).toContain('Router Bot');
    const flat = JSON.stringify(card.elements);
    // 4 capabilities
    expect(flat).toContain('私信我问问题');
    expect(flat).toContain('接收 @ 你的通知');
    expect(flat).toContain('总结讨论');
    expect(flat).toContain('账号恢复');
    // Button URL
    expect(flat).toContain('https://r.test/settings#lark-binding');
  });
});

describe('buildRateLimitGuideCard', () => {
  it('renders limit explanation + cli setup link', () => {
    const card = buildRateLimitGuideCard('https://r.test');
    expect(card.header.title.content).toContain('喘口气');
    const flat = JSON.stringify(card.elements);
    expect(flat).toContain('5 次');
    expect(flat).toContain('Claude Code');
    expect(flat).toContain('https://r.test/setup/cli');
  });

  it('strips trailing slash from publicUrl', () => {
    const card = buildRateLimitGuideCard('https://r.test/');
    expect(JSON.stringify(card.elements)).toContain('https://r.test/setup/cli');
    expect(JSON.stringify(card.elements)).not.toContain('r.test//setup');
  });
});

describe('buildP2pHelpCard', () => {
  it('renders DM-focused sections + settings + cli buttons', () => {
    const card = buildP2pHelpCard('https://r.test');
    expect(card.header.title.content).toContain('私聊帮助');
    const flat = JSON.stringify(card.elements);
    expect(flat).toContain('直接说人话');
    expect(flat).toContain('接收通知');
    expect(flat).toContain('5 次/分钟');
    expect(flat).toContain('https://r.test/settings');
    expect(flat).toContain('https://r.test/setup/cli');
  });

  it('strips trailing slash from publicUrl', () => {
    const card = buildP2pHelpCard('https://r.test/');
    expect(JSON.stringify(card.elements)).not.toContain('r.test//');
  });
});

describe('buildSaveEntryConfirmCard', () => {
  it('renders author + content + tags + view button with entry url', () => {
    const card = buildSaveEntryConfirmCard({
      author: 'taco',
      content: '决定用 Zustand',
      tags: ['decision', 'frontend', 'lark-bot-save'],
      entryId: 'mnk5xyz',
      channelName: 'Frontend',
      publicUrl: 'https://r.test',
    });
    expect(card.header.title.content).toContain('@taco');
    const flat = JSON.stringify(card.elements);
    expect(flat).toContain('决定用 Zustand');
    expect(flat).toContain('decision');
    expect(flat).toContain('frontend');
    // implementation-detail tag is hidden from chips
    expect(flat).not.toContain('#lark-bot-save');
    expect(flat).toContain('https://r.test/entry?id=mnk5xyz');
    expect(flat).toContain('Frontend');
  });

  it('shows "无 tag" hint when no channelName supplied', () => {
    const card = buildSaveEntryConfirmCard({
      author: 'taco',
      content: 'X',
      tags: ['lark-bot-save'],
      entryId: 'mnk5abc',
      publicUrl: 'https://r.test',
    });
    const flat = JSON.stringify(card.elements);
    expect(flat).toContain('无 tag');
  });

  it('truncates long content to 400 chars in preview', () => {
    const long = 'a'.repeat(500);
    const card = buildSaveEntryConfirmCard({
      author: 'taco', content: long, tags: ['lark-bot-save'],
      entryId: 'x', publicUrl: 'https://r.test',
    });
    const flat = JSON.stringify(card.elements);
    expect(flat).toContain('a'.repeat(400) + '…');
  });
});

describe('buildP2pUnknownSlashCard', () => {
  it('echoes the offending command in body', () => {
    const card = buildP2pUnknownSlashCard('/summarize');
    expect(card.header.title.content).toContain('私聊里只支持 /help');
    const flat = JSON.stringify(card.elements);
    expect(flat).toContain('/summarize');
    expect(flat).toContain('/help');
  });
});

import { buildWeeklyBriefCard } from './card-builder.js';

describe('buildWeeklyBriefCard', () => {
  const baseInput = {
    dateLabel: 'Week of May 7',
    publicUrl: 'https://router.example.com',
    teamOverviewMd: null,
    personalCalloutMd: null,
    milestones: [],
    realtimeMentionsCount: 0,
    realtimeRepliesCount: 0,
    fallbackChannelEntries: [],
  };

  it('renders header with title + date subtitle', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: 'Andrew shipped design v2.',
    });
    expect(card.header.title.content).toBe('Router Weekly Brief');
    const text = JSON.stringify(card.elements);
    expect(text).toContain('Week of May 7');
  });

  it('renders team overview as a paragraph (not a list) when LLM provided one', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: 'Andrew shipped design tokens v2 to #design; Samantha kicked off the onboarding revamp in #onboarding.',
    });
    const text = JSON.stringify(card.elements);
    expect(text).toContain('Team activity');
    expect(text).toContain('Andrew shipped design tokens v2');
    // not a bulleted list — no leading "•"
    expect(text).not.toMatch(/Team activity[^"]*\\n•/);
  });

  it('falls back to channel entry list when teamOverviewMd is null', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: null,
      fallbackChannelEntries: [
        { summary: 'design token v2 review', url: 'https://x/e/a' },
        { summary: 'sentry hook added to deploy', url: 'https://x/e/b' },
      ],
    });
    const text = JSON.stringify(card.elements);
    expect(text).toContain('Team activity');
    expect(text).toContain('design token v2 review');
    expect(text).toContain('https://x/e/a');
  });

  it('omits team activity entirely when no LLM and no fallback entries', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      milestones: [{ summary: 'KnowMate v0.9 launched', url: 'https://x/e/g' }],
    });
    const text = JSON.stringify(card.elements);
    expect(text).not.toContain('Team activity');
  });

  it('renders personal callout when LLM found a connection', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: 'team did stuff',
      personalCalloutMd: 'Claire is migrating tables you also touched — sync soon.',
    });
    const text = JSON.stringify(card.elements);
    expect(text).toContain('For you');
    expect(text).toContain('Claire is migrating tables');
  });

  it('omits personal callout when LLM returned null (no connection)', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: 'team did stuff',
      personalCalloutMd: null,
    });
    const text = JSON.stringify(card.elements);
    expect(text).not.toContain('For you');
  });

  it('shows milestones list (≤3, with overflow notice)', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      summary: `milestone ${i}`,
      url: `https://x/m/${i}`,
    }));
    const card = buildWeeklyBriefCard({ ...baseInput, milestones: items });
    const text = JSON.stringify(card.elements);
    expect(text).toContain('Milestones');
    for (let i = 0; i < 3; i++) expect(text).toContain(`milestone ${i}`);
    expect(text).not.toContain('milestone 3');
    expect(text).toContain('and 2 more');
  });

  it('omits milestones section when empty', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: 'team did stuff',
    });
    const text = JSON.stringify(card.elements);
    expect(text).not.toContain('Milestones');
  });

  it('shows realtime activity footer line when counts > 0 (count only, no content)', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: 'team activity',
      realtimeMentionsCount: 3,
      realtimeRepliesCount: 1,
    });
    const text = JSON.stringify(card.elements);
    expect(text).toContain('3 mentions');
    expect(text).toContain('1 reply');
    expect(text).toContain('already in your inbox');
  });

  it('uses singular form for count of 1', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: 'x',
      realtimeMentionsCount: 1,
      realtimeRepliesCount: 0,
    });
    const text = JSON.stringify(card.elements);
    expect(text).toContain('1 mention');
    expect(text).not.toContain('1 mentions');
  });

  it('omits realtime footer when both counts are 0', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: 'x',
    });
    const text = JSON.stringify(card.elements);
    expect(text).not.toContain('already in your inbox');
  });

  it('always shows "View full brief" button at bottom', () => {
    const card = buildWeeklyBriefCard({
      ...baseInput,
      teamOverviewMd: 'x',
    });
    const text = JSON.stringify(card.elements);
    expect(text).toContain('View full brief on web');
    expect(text).toContain('https://router.example.com/brief');
  });

  it('truncates fallback channel entry summaries to 60 chars', () => {
    const longSummary = 'a'.repeat(100);
    const card = buildWeeklyBriefCard({
      ...baseInput,
      fallbackChannelEntries: [{ summary: longSummary, url: 'https://x/e/a' }],
    });
    const text = JSON.stringify(card.elements);
    expect(text).toContain('a'.repeat(59) + '…');
    expect(text).not.toContain('a'.repeat(60));
  });
});

describe('buildSettingsCard rebind/disconnect (bound state)', () => {
  function baseArgs() {
    return {
      chatId: 'oc_1',
      lastSummaryAt: null,
      pushEnabled: false,
      watchEnabled: false,
      summaryStyle: 'person' as const,
      archiveSelected: '__main__',
      autoSummary: { enabled: false, cadence: 'daily' as const, fireHour: 9 },
      now: 0,
    };
  }

  it('shows Switch tag dropdown + Disconnect button when bound', () => {
    const card = buildSettingsCard({
      ...baseArgs(),
      boundChannel: { id: 'router', name: 'router' },
      availableChannels: [
        { id: 'router', name: 'router' },
        { id: 'other', name: 'other' },
      ],
    });
    const flat = JSON.stringify(card);
    expect(flat).toContain('settings.rebind');
    expect(flat).toContain('settings.disconnect');
    expect(flat).toContain('Switch tag');
    expect(flat).toContain('Disconnect');
    // Bound channel must NOT appear in the switch options
    expect(flat).toMatch(/"value":"other"/);
    expect(flat).not.toMatch(/"action":"settings\.rebind".*"value":"router"/s);
  });

  it('hides Switch tag dropdown when no other channels available, still shows Disconnect', () => {
    const card = buildSettingsCard({
      ...baseArgs(),
      boundChannel: { id: 'router', name: 'router' },
      availableChannels: [{ id: 'router', name: 'router' }],
    });
    const flat = JSON.stringify(card);
    expect(flat).not.toContain('settings.rebind');
    expect(flat).toContain('settings.disconnect');
  });

  it('does NOT show rebind/disconnect when unbound', () => {
    const card = buildSettingsCard({
      ...baseArgs(),
      boundChannel: null,
      availableChannels: [],
      connectableChannels: [{ id: 'router', name: 'router' }],
    });
    const flat = JSON.stringify(card);
    expect(flat).not.toContain('settings.rebind');
    expect(flat).not.toContain('settings.disconnect');
    // Unbound state still surfaces the existing connect dropdown
    expect(flat).toContain('settings.connect');
  });
});
