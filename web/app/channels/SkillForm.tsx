"use client";

import { useState } from "react";
import type { Skill, SkillTrigger, SkillEffect } from "@/lib/api";
import { useT } from "@/lib/i18n";

const DEFAULT_DIGEST_TEMPLATE = `## Weekly Digest — #{tag} · {YYYY-MM-DD} ~ {YYYY-MM-DD}

Substitute the tag name and the actual start/end dates of the lookback window (inclusive, ISO format).

Classify each entry using ONLY its tags and its summary field. Do NOT use the entry body for classification — the body is only for writing prose inside a section.

Ignore any entry tagged with \`auto:digest\` — those are prior system-generated digests and must not be re-summarized.

If a section has no matching entries, write \`—\`. Do not invent content to fill empty sections.

### Shipped This Week
Delivered, merged, or launched work.
- Tag signals: \`#shipped\`, \`#done\`, \`#merged\`, \`#launched\`
- Summary fallback: summaries expressing completion
Each bullet: one-sentence description + author.

### Key Decisions
Architecture, direction, or tradeoff decisions.
- Tag signals: \`#decision\`, \`#rfc\`
- Summary fallback: summaries expressing a decision ("chose X over Y", "decided to…")
Each bullet: decision + rationale (if present) + author.

### In Progress & Next Week
Ongoing main-line work and explicit next steps.
- Tag signals: \`#wip\`, \`#next\`
- Summary fallback: summaries in progressive or future tense
Group by project or theme, not by author.

### Risks & Blockers
Blocked, delayed, at-risk, or awaiting-review work.
- Tag signals: \`#blocker\`, \`#risk\`, \`#urgent\`, \`#review-needed\`
- Summary fallback: summaries expressing blockage or risk
Each bullet: issue + scope of impact + current status.

### Team Patterns
2–3 sentences of lightweight retro signal based on the overall entry set. Examples: discussion-to-delivery ratio, rework on a single direction, concentration of effort, solo-vs-collaborative split. Qualitative only — do not fabricate numbers. Never evaluate individuals.

### By Author
One line per person: \`@handle — N entries — one-sentence highlight\`. Sorted by entry count descending. Credit/roll-call, not accountability.

### Summary
2–3 sentences on team tempo: this week's focus, overall pace and health, the one thing most worth attention next week.

Write in the same language as the majority of the entries.`;

export type SkillFormValues = {
  name: string;
  description: string;
  instructions: string;
  exposeAs: 'tool' | 'context' | 'both' | 'prewrite' | 'digest';
  triggers: SkillTrigger[];
  effects: SkillEffect[];
  digestConfig?: {
    schedule: 'weekly' | 'monthly';
    lookbackDays?: number;
    postToChannel?: boolean;
    webhookUrl?: string;
  };
};

type SkillKind = 'rewrite' | 'webhook' | 'digest';

function skillToKind(s?: Skill): SkillKind {
  if (!s) return 'rewrite';
  if (s.exposeAs === 'digest') return 'digest';
  if (s.exposeAs === 'prewrite') return 'rewrite';
  if (s.effects && s.effects.length > 0) return 'webhook';
  return 'rewrite';
}

const blank = (kind: SkillKind): SkillFormValues => {
  if (kind === 'digest') {
    return {
      name: '',
      description: '',
      instructions: DEFAULT_DIGEST_TEMPLATE,
      exposeAs: 'digest',
      triggers: [],
      effects: [],
      digestConfig: { schedule: 'weekly', postToChannel: true },
    };
  }
  if (kind === 'webhook') {
    return {
      name: '',
      description: '',
      instructions: '',
      exposeAs: 'context',
      triggers: [{ type: 'on_entry_write', filter: {} }],
      effects: [{ type: 'lark_webhook', url: '', template: 'card' }],
    };
  }
  return {
    name: '',
    description: '',
    instructions: '',
    exposeAs: 'prewrite',
    triggers: [],
    effects: [],
  };
};

export default function SkillForm({
  initial,
  mode,
  onSubmit,
  onCancel,
}: {
  initial?: Skill;
  mode: 'create' | 'edit';
  onSubmit: (values: SkillFormValues) => Promise<void> | void;
  onCancel: () => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<SkillKind>(() => skillToKind(initial));
  const [v, setV] = useState<SkillFormValues>(() => initial ? {
    name: initial.name,
    description: initial.description,
    instructions: initial.instructions,
    exposeAs: initial.exposeAs,
    triggers: initial.triggers || [],
    effects: initial.effects || [],
    digestConfig: initial.digestConfig ? { ...initial.digestConfig } : undefined,
  } : blank(kind));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const switchKind = (k: SkillKind) => {
    if (mode === 'edit') return; // can't change kind after creation
    setKind(k);
    // Preserve name/description, reset the rest to the kind defaults.
    // Keep name/description, but reset instructions to the new kind's default
    // (digest has a pre-filled template, rewrite/webhook start empty).
    const defaults = blank(k);
    setV(s => ({ ...defaults, name: s.name, description: s.description }));
  };

  // Webhook: edit the single trigger filter (tags + authors).
  const trigger = v.triggers[0];
  const tagsValue = (trigger?.type === 'on_entry_write' ? trigger.filter?.tags : undefined) || [];
  const authorsValue = (trigger?.type === 'on_entry_write' ? trigger.filter?.authors : undefined) || [];
  const updateTriggerFilter = (patch: { tags?: string[]; authors?: string[] }) => {
    setV(s => {
      const t = s.triggers[0];
      if (!t || t.type !== 'on_entry_write') return s;
      return {
        ...s,
        triggers: [{ ...t, filter: { ...t.filter, ...patch } }],
      };
    });
  };

  const effect = v.effects[0];
  const updateEffectUrl = (url: string) => {
    setV(s => {
      const e = s.effects[0];
      if (!e) return s;
      return { ...s, effects: [{ ...e, url }] };
    });
  };
  const updateEffectTemplate = (template: 'card' | 'text') => {
    setV(s => {
      const e = s.effects[0];
      if (!e || e.type !== 'lark_webhook') return s;
      return { ...s, effects: [{ ...e, template }] };
    });
  };

  const submit = async () => {
    if (!v.name.trim()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onSubmit(v);
    } catch (e: any) {
      setSubmitError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-(--card) rounded-2xl border border-(--card-border) p-5 space-y-4">
      {/* Kind selector — only on create */}
      {mode === 'create' && (
        <div className="grid grid-cols-3 gap-2">
          <button type="button" onClick={() => switchKind('rewrite')}
            className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
              kind === 'rewrite'
                ? 'border-(--accent) bg-(--accent-light)'
                : 'border-(--card-border) hover:border-(--accent)'
            }`}>
            <div className="text-sm font-semibold text-foreground mb-1">📖 {t("skillForm.kindRewrite")}</div>
            <p className="text-[11px] text-(--muted) leading-snug">
              {t("skillForm.kindRewriteDesc")}
            </p>
          </button>
          {/* Webhook skill creation is hidden — push to Lark groups now goes
              through the bot binding flow (`@bot connect <channel>`).
              Existing webhook skills are still editable when opened. */}
          <button type="button" onClick={() => switchKind('digest')}
            className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
              kind === 'digest'
                ? 'border-(--accent) bg-(--accent-light)'
                : 'border-(--card-border) hover:border-(--accent)'
            }`}>
            <div className="text-sm font-semibold text-foreground mb-1">📊 {t("skillForm.kindDigest")}</div>
            <p className="text-[11px] text-(--muted) leading-snug">
              {t("skillForm.kindDigestDesc")}
            </p>
          </button>
        </div>
      )}

      {/* Common fields */}
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("skillForm.name")}</label>
          <input
            type="text" value={v.name}
            onChange={e => setV(s => ({ ...s, name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
            disabled={mode === 'edit'}
            placeholder={kind === 'rewrite' ? t("skillForm.namePlaceholderRewrite") : kind === 'digest' ? t("skillForm.namePlaceholderDigest") : t("skillForm.namePlaceholderWebhook")}
            className="w-full text-sm px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) disabled:opacity-60"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("skillForm.description")}</label>
          <input
            type="text" value={v.description}
            onChange={e => setV(s => ({ ...s, description: e.target.value }))}
            placeholder={t("skillForm.descriptionPlaceholder")}
            className="w-full text-sm px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)"
          />
        </div>
      </div>

      {/* Channel skill body */}
      {kind === 'rewrite' && (
        <div>
          <label className="block text-[11px] font-medium text-(--muted) mb-1">
            {t("skillForm.instructionsLabel")} <span className="text-(--muted-light)">{t("skillForm.instructionsSubLabel")}</span>
          </label>
          <textarea value={v.instructions} rows={14}
            onChange={e => setV(s => ({ ...s, instructions: e.target.value }))}
            placeholder={t("skillForm.instructionsPlaceholder")}
            className="w-full text-sm px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) resize-y placeholder:text-(--muted-light) font-mono"
          />
          <p className="text-[11px] text-(--muted-light) mt-1 leading-relaxed">
            {t("skillForm.instructionsHint")}
          </p>
        </div>
      )}

      {/* Webhook-specific fields */}
      {kind === 'webhook' && (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("skillForm.webhookUrl")}</label>
            <input type="url" value={effect?.url || ''}
              onChange={e => updateEffectUrl(e.target.value)}
              placeholder={t("skillForm.webhookUrlPlaceholder")}
              className="w-full text-sm px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light) font-mono"
            />
            <p className="text-[11px] text-(--muted-light) mt-1">
              {t("skillForm.webhookUrlHint")}
            </p>
          </div>
          {effect?.type === 'lark_webhook' && (
            <div>
              <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("skillForm.larkFormat")}</label>
              <select value={effect.template || 'card'}
                onChange={e => updateEffectTemplate(e.target.value as 'card' | 'text')}
                className="w-full text-sm px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) cursor-pointer">
                <option value="card">{t("skillForm.larkCard")}</option>
                <option value="text">{t("skillForm.larkText")}</option>
              </select>
            </div>
          )}
          <fieldset className="border border-(--card-border) rounded-xl p-3">
            <legend className="text-[11px] font-semibold text-(--muted) px-1">{t("skillForm.triggerCondition")}</legend>
            <p className="text-[11px] text-(--muted-light) mb-2">
              {t("skillForm.triggerHint")}
            </p>
            <div className="space-y-2">
              <div>
                <label className="block text-[11px] text-(--muted) mb-1">{t("skillForm.filterTags")}</label>
                <input type="text" value={tagsValue.join(', ')}
                  onChange={e => updateTriggerFilter({
                    tags: e.target.value.split(',').map(tag => tag.trim().toLowerCase().replace(/^#/, '')).filter(Boolean),
                  })}
                  placeholder={t("skillForm.filterTagsPlaceholder")}
                  className="w-full text-[12px] px-2 py-1.5 rounded-lg border border-(--card-border) bg-background text-foreground placeholder:text-(--muted-light)" />
              </div>
              <div>
                <label className="block text-[11px] text-(--muted) mb-1">{t("skillForm.filterAuthors")}</label>
                <input type="text" value={authorsValue.join(', ')}
                  onChange={e => updateTriggerFilter({
                    authors: e.target.value.split(',').map(a => a.trim().replace(/^@/, '')).filter(Boolean),
                  })}
                  placeholder={t("skillForm.filterAuthorsPlaceholder")}
                  className="w-full text-[12px] px-2 py-1.5 rounded-lg border border-(--card-border) bg-background text-foreground placeholder:text-(--muted-light)" />
              </div>
            </div>
          </fieldset>
        </div>
      )}

      {/* Digest-specific fields */}
      {kind === 'digest' && (
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("skillForm.digestSchedule")}</label>
            <select value={v.digestConfig?.schedule || 'weekly'}
              onChange={e => setV(s => ({ ...s, digestConfig: { ...s.digestConfig, schedule: e.target.value as 'weekly' | 'monthly' } }))}
              className="w-full text-sm px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) cursor-pointer">
              <option value="weekly">{t("skillForm.digestWeekly")}</option>
              <option value="monthly">{t("skillForm.digestMonthly")}</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="postToChannel" checked={v.digestConfig?.postToChannel !== false}
              onChange={e => setV(s => ({ ...s, digestConfig: { ...s.digestConfig, schedule: s.digestConfig?.schedule || 'weekly', postToChannel: e.target.checked } }))}
              className="rounded border-(--card-border)" />
            <label htmlFor="postToChannel" className="text-[11px] text-(--muted)">{t("skillForm.digestPostToChannel")}</label>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("skillForm.digestWebhook")}</label>
            <input type="url" value={v.digestConfig?.webhookUrl || ''}
              onChange={e => setV(s => ({ ...s, digestConfig: { ...s.digestConfig, schedule: s.digestConfig?.schedule || 'weekly', webhookUrl: e.target.value } }))}
              placeholder={t("skillForm.digestWebhookPlaceholder")}
              className="w-full text-sm px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) font-mono" />
            <p className="text-[11px] text-(--muted-light) mt-1">{t("skillForm.digestWebhookHint")}</p>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-(--muted) mb-1">{t("skillForm.digestInstructions")}</label>
            <textarea value={v.instructions} rows={6}
              onChange={e => setV(s => ({ ...s, instructions: e.target.value }))}
              placeholder={t("skillForm.digestInstructionsPlaceholder")}
              className="w-full text-sm px-3 py-2 rounded-xl border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) resize-y placeholder:text-(--muted-light) font-mono" />
            <p className="text-[11px] text-(--muted-light) mt-1">{t("skillForm.digestInstructionsHint")}</p>
          </div>
        </div>
      )}

      {submitError && (
        <div className="p-3 bg-red-50 text-red-600 text-[12px] rounded-xl">{submitError}</div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="cursor-pointer text-xs text-(--muted) hover:text-foreground px-3 py-2">{t("common.cancel")}</button>
        <button type="button" onClick={submit} disabled={submitting || !v.name.trim() || (kind === 'webhook' && !effect?.url) || (kind === 'rewrite' && !v.instructions.trim())}
          className="cursor-pointer text-sm bg-(--accent) text-white px-4 py-2 rounded-lg hover:bg-(--accent-hover) disabled:opacity-50 transition-colors">
          {submitting ? t("common.saving") : (mode === 'create' ? (kind === 'rewrite' ? t("skillForm.createRewrite") : kind === 'digest' ? t("skillForm.createDigest") : t("skillForm.createWebhook")) : t("skillForm.saveChanges"))}
        </button>
      </div>
    </div>
  );
}
