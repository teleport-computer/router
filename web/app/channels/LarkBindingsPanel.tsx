"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  getLarkBindings,
  LarkBindingsError,
  deleteLarkBinding,
  setLarkBindingPushEnabled,
  setLarkBindingWatchEnabled,
  setLarkBindingArchive,
  setLarkBindingSummaryStyle,
  getLarkWatchObservations,
  getLarkAutoSummary,
  setLarkAutoSummary,
  type LarkChatBinding,
  type Channel,
  type SummaryStyle,
  type LarkWatchObservation,
  type LarkAutoCadence,
  type LarkAutoSummaryPrefs,
} from "@/lib/api";

interface Props {
  channelId: string;
  /** Team's channels — used to populate the archive-target dropdown. */
  availableChannels?: Channel[];
}

export default function LarkBindingsPanel({ channelId, availableChannels = [] }: Props) {
  const t = useT();
  const [bindings, setBindings] = useState<LarkChatBinding[] | null>(null);
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  async function load() {
    setError("");
    try { setBindings(await getLarkBindings(channelId)); }
    catch (e) {
      // 404 happens when the tag isn't in the caller's team (or doesn't exist
      // yet from the bindings API's perspective). Treat as "no bindings" so
      // the panel shows the friendly empty state, not a red error stripe.
      if (e instanceof LarkBindingsError && e.status === 404) {
        setBindings([]);
      } else {
        setError(String(e));
      }
    }
  }
  useEffect(() => { load(); }, [channelId]);

  async function unbind(chatId: string) {
    if (!confirm(t("lark.bindings.card.unbindConfirm"))) return;
    try { await deleteLarkBinding(chatId); load(); }
    catch (e) { setError(String(e)); }
  }

  function patchLocal(chatId: string, patch: Partial<LarkChatBinding>) {
    setBindings(prev => prev?.map(b => b.chatId === chatId ? { ...b, ...patch } : b) ?? prev);
  }

  async function togglePush(chatId: string, next: boolean) {
    patchLocal(chatId, { pushEnabled: next });
    try { await setLarkBindingPushEnabled(chatId, next); }
    catch (e) { setError(String(e)); load(); }
  }
  async function toggleWatch(chatId: string, next: boolean) {
    patchLocal(chatId, { watchEnabled: next });
    try { await setLarkBindingWatchEnabled(chatId, next); }
    catch (e) { setError(String(e)); load(); }
  }
  async function changeArchive(chatId: string, next: string) {
    const val = next === "__main__" ? null : next;
    patchLocal(chatId, { archiveChannelId: val ?? undefined });
    try { await setLarkBindingArchive(chatId, val); }
    catch (e) { setError(String(e)); load(); }
  }
  async function changeStyle(chatId: string, next: SummaryStyle) {
    patchLocal(chatId, { summaryStyle: next });
    try { await setLarkBindingSummaryStyle(chatId, next); }
    catch (e) { setError(String(e)); load(); }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{t("lark.bindings.title")}</h3>
          <p className="mt-1 text-sm text-(--muted) leading-relaxed max-w-2xl">
            {t("lark.bindings.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHelpOpen(v => !v)}
          className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-(--card-border) text-(--muted) hover:border-(--accent) hover:text-foreground transition-colors cursor-pointer"
        >
          {helpOpen ? t("lark.bindings.helpHide") : `❓ ${t("lark.bindings.helpToggle")}`}
        </button>
      </div>

      {/* Help block */}
      {helpOpen && (
        <div className="rounded-xl border border-(--card-border) bg-(--accent-light) p-4 space-y-3">
          <div className="text-sm font-semibold text-foreground">{t("lark.bindings.helpStepsTitle")}</div>
          <ol className="space-y-2.5 text-sm">
            <li>
              <div className="font-medium text-foreground">{t("lark.bindings.helpStep1Title")}</div>
              <div className="text-(--muted) text-[13px] mt-0.5">{t("lark.bindings.helpStep1Body")}</div>
            </li>
            <li>
              <div className="font-medium text-foreground">{t("lark.bindings.helpStep2Title")}</div>
              <div className="text-(--muted) text-[13px] mt-0.5 font-mono">
                {t("lark.bindings.helpStep2Body", { channelId })}
              </div>
            </li>
            <li>
              <div className="font-medium text-foreground">{t("lark.bindings.helpStep3Title")}</div>
              <div className="text-(--muted) text-[13px] mt-0.5">{t("lark.bindings.helpStep3Body")}</div>
            </li>
          </ol>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Loading / empty / list */}
      {!bindings && !error && (
        <div className="text-sm text-(--muted)">{t("lark.bindings.loading")}</div>
      )}

      {bindings && bindings.length === 0 && (
        <div className="rounded-xl border border-dashed border-(--card-border) p-8 text-center">
          <div className="text-3xl mb-2">📭</div>
          <div className="text-sm font-medium text-foreground mb-1">
            {t("lark.bindings.emptyTitle")}
          </div>
          <div className="text-xs text-(--muted) font-mono">
            {t("lark.bindings.emptyHint", { channelId })}
          </div>
        </div>
      )}

      {bindings && bindings.length > 0 && (
        <div className="space-y-3">
          {bindings.map(b => (
            <BindingCard
              key={b.chatId}
              binding={b}
              availableChannels={availableChannels}
              onUnbind={() => unbind(b.chatId)}
              onTogglePush={(v: boolean) => togglePush(b.chatId, v)}
              onToggleWatch={(v: boolean) => toggleWatch(b.chatId, v)}
              onChangeArchive={(v: string) => changeArchive(b.chatId, v)}
              onChangeStyle={(v: SummaryStyle) => changeStyle(b.chatId, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface BindingCardProps {
  binding: LarkChatBinding;
  availableChannels: Channel[];
  onUnbind: () => void;
  onTogglePush: (v: boolean) => void;
  onToggleWatch: (v: boolean) => void;
  onChangeArchive: (v: string) => void;
  onChangeStyle: (v: SummaryStyle) => void;
}

function BindingCard({ binding: b, availableChannels, onUnbind, onTogglePush, onToggleWatch, onChangeArchive, onChangeStyle }: BindingCardProps) {
  const t = useT();
  const pushOn = b.pushEnabled === true;
  const watchOn = b.watchEnabled === true;
  const archiveSelected = b.archiveChannelId && b.archiveChannelId !== b.channelId
    ? b.archiveChannelId
    : "__main__";
  const initial = (b.chatName?.trim() || b.chatId).slice(0, 1).toUpperCase();

  return (
    <div className="rounded-xl border border-(--card-border) bg-background overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-(--card-border) bg-(--accent-light)/30">
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 size-9 rounded-lg bg-(--accent)/15 text-(--accent) flex items-center justify-center font-semibold text-sm">
            {initial}
          </div>
          <div className="min-w-0">
            <div className="font-medium text-sm text-foreground truncate">{b.chatName || "(unnamed group)"}</div>
            <div className="text-[11px] text-(--muted) font-mono truncate">
              {t("lark.bindings.card.chatIdLabel")}: {b.chatId}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={onUnbind}
          className="shrink-0 text-xs px-2.5 py-1 rounded-lg border border-transparent text-red-600 hover:bg-red-500/10 hover:border-red-500/30 transition-colors cursor-pointer"
        >
          {t("lark.bindings.card.unbind")}
        </button>
      </div>

      {/* Card body */}
      <div className="p-4 space-y-4">
        <ToggleRow
          icon="📤"
          title={t("lark.bindings.card.pushTitle")}
          body={t("lark.bindings.card.pushBody")}
          enabled={pushOn}
          onChange={onTogglePush}
        />

        <hr className="border-(--card-border)" />

        <ToggleRow
          icon="🔍"
          title={t("lark.bindings.card.watchTitle")}
          body={t("lark.bindings.card.watchBody")}
          enabled={watchOn}
          onChange={onToggleWatch}
        />

        {/* Watch observations log: collapsed by default; lazy-loads on open. */}
        <div className="ml-11">
          <WatchObservations chatId={b.chatId} defaultOpen={false} />
        </div>

        <hr className="border-(--card-border)" />

        <AutoSummaryRow chatId={b.chatId} />

        <hr className="border-(--card-border)" />

        <div className="flex items-start gap-3">
          <div className="shrink-0 size-8 rounded-lg bg-(--card-border)/40 flex items-center justify-center text-base">
            📁
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">
              {t("lark.bindings.card.archiveTitle")}
            </div>
            <div className="text-[12px] text-(--muted) leading-relaxed mt-0.5 mb-2">
              {t("lark.bindings.card.archiveBody")}
            </div>
            <select
              value={archiveSelected}
              onChange={e => onChangeArchive(e.target.value)}
              className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)"
            >
              <option value="__main__">
                {t("lark.bindings.card.archiveDefaultLabel", { channel: b.channelId })}
              </option>
              {availableChannels
                .filter(c => c.id !== b.channelId)
                .map(c => (
                  <option key={c.id} value={c.id}>#{c.id} — {c.name}</option>
                ))}
            </select>
          </div>
        </div>

        <hr className="border-(--card-border)" />

        <div className="flex items-start gap-3">
          <div className="shrink-0 size-8 rounded-lg bg-(--card-border)/40 flex items-center justify-center text-base">
            ✍️
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground">
              {t("lark.bindings.card.styleTitle")}
            </div>
            <div className="text-[12px] text-(--muted) leading-relaxed mt-0.5 mb-2">
              {t("lark.bindings.card.styleBody")}
            </div>
            <select
              value={b.summaryStyle ?? 'person'}
              onChange={e => onChangeStyle(e.target.value as SummaryStyle)}
              className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)"
            >
              <option value="person">{t("lark.bindings.card.stylePerson")}</option>
              <option value="topic">{t("lark.bindings.card.styleTopic")}</option>
              <option value="free">{t("lark.bindings.card.styleFree")}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  icon: string;
  title: string;
  body: string;
  enabled: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow({ icon, title, body, enabled, onChange }: ToggleRowProps) {
  const t = useT();
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <div className="shrink-0 size-8 rounded-lg bg-(--card-border)/40 flex items-center justify-center text-base">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <span
            className={`shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              enabled
                ? "bg-(--accent)/15 text-(--accent)"
                : "bg-(--card-border)/40 text-(--muted)"
            }`}
          >
            {enabled ? t("lark.bindings.card.stateOn") : t("lark.bindings.card.stateOff")}
          </span>
        </div>
        <div className="text-[12px] text-(--muted) leading-relaxed mt-0.5">{body}</div>
      </div>
      <Switch checked={enabled} onChange={onChange} />
    </label>
  );
}

interface AutoSummaryRowProps {
  chatId: string;
}

function AutoSummaryRow({ chatId }: AutoSummaryRowProps) {
  const [prefs, setPrefs] = useState<LarkAutoSummaryPrefs | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    getLarkAutoSummary(chatId)
      .then(p => { if (!cancelled) setPrefs(p); })
      .catch(e => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [chatId]);

  if (err) return <div className="text-xs text-red-500 ml-11">{err}</div>;
  if (!prefs) return null;

  async function patch(next: Partial<LarkAutoSummaryPrefs>) {
    setErr("");
    const optimistic = { ...prefs, ...next } as LarkAutoSummaryPrefs;
    setPrefs(optimistic);
    try {
      const updated = await setLarkAutoSummary(chatId, {
        enabled: next.enabled,
        cadence: next.cadence,
        fireHour: next.fireHour,
      });
      setPrefs(updated);
    } catch (e) {
      setErr(String(e));
      // revert by re-fetching
      getLarkAutoSummary(chatId).then(setPrefs).catch(() => {});
    }
  }

  const showHour = prefs.cadence === 'daily' || prefs.cadence === 'weekly';

  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 size-8 rounded-lg bg-(--card-border)/40 flex items-center justify-center text-base">
        🕐
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">Auto summary · 定期自动总结</div>
            <div className="text-[12px] text-(--muted) leading-relaxed mt-0.5">
              Scheduled summarize → posted to chat + saved to router. 按时自动总结群聊，存到 router。
            </div>
          </div>
          <Switch checked={prefs.enabled} onChange={v => patch({ enabled: v })} />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <select
            value={prefs.cadence}
            onChange={e => patch({ cadence: e.target.value as LarkAutoCadence })}
            className="text-sm px-2.5 py-1.5 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)"
          >
            <option value="daily">📆 Daily · 每天</option>
            <option value="weekly">🗓️ Weekly (Mon) · 每周一</option>
            <option value="hourly:6">⏱️ Every 6h · 每 6 小时</option>
            <option value="hourly:12">⏱️ Every 12h · 每 12 小时</option>
          </select>
          {showHour && (
            <select
              value={String(prefs.fireHour)}
              onChange={e => patch({ fireHour: parseInt(e.target.value, 10) })}
              className="text-sm px-2.5 py-1.5 rounded-lg border border-(--card-border) bg-background text-foreground focus:outline-none focus:border-(--accent) focus:ring-2 focus:ring-(--accent-light)"
              title="Asia/Shanghai"
            >
              {[0, 6, 9, 12, 15, 18, 21].map(h => (
                <option key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</option>
              ))}
            </select>
          )}
          {prefs.lastRunAt && (
            <span className="text-[11px] text-(--muted-light) self-center">
              last run {fmtElapsed(prefs.lastRunAt)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface WatchObservationsProps {
  chatId: string;
  /** Open by default when watch is enabled, otherwise collapsed. */
  defaultOpen?: boolean;
}

function fmtElapsed(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 60_000) return 'just now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function WatchObservations({ chatId, defaultOpen = false }: WatchObservationsProps) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const [items, setItems] = useState<LarkWatchObservation[] | null>(null);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    if (!open) return;
    if (items !== null) return;  // cached
    setLoadErr("");
    getLarkWatchObservations(chatId, 20)
      .then(setItems)
      .catch(e => setLoadErr(String(e)));
  }, [open, chatId, items]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-[12px] text-(--accent) hover:underline cursor-pointer"
      >
        {open ? `▾ ${t("lark.bindings.card.watchObsHide")}` : `▸ ${t("lark.bindings.card.watchObsToggle")}`}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {loadErr && <div className="text-xs text-red-600">{loadErr}</div>}
          {!loadErr && items === null && <div className="text-[12px] text-(--muted)">…</div>}
          {items && items.length === 0 && (
            <div className="text-[12px] text-(--muted) italic">{t("lark.bindings.card.watchObsEmpty")}</div>
          )}
          {items && items.length > 0 && (
            <ul className="space-y-2">
              {items.map(o => (
                <li key={o.id} className="rounded border border-(--card-border) p-2 bg-(--card-border)/15">
                  <div className="text-[10px] text-(--muted) mb-1">{fmtElapsed(o.ranAt)}</div>
                  {o.observations.map((obs, i) => {
                    const labelKey = `lark.bindings.card.watchObsKind${obs.kind.charAt(0).toUpperCase()}${obs.kind.slice(1)}`;
                    const label = t(labelKey);
                    const showLabel = label !== labelKey ? label : obs.kind;
                    return (
                      <div key={i} className="text-[12px] mb-1">
                        <span className="font-medium text-(--accent)">{showLabel}: </span>
                        <span className="text-foreground">{obs.content}</span>
                        {obs.suggested_action && (
                          <span className="block text-[11px] text-(--muted) mt-0.5">
                            → <code>{obs.suggested_action}</code>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
}

function Switch({ checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => { e.preventDefault(); onChange(!checked); }}
      className={`shrink-0 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? "bg-(--accent)" : "bg-(--card-border)"
      } cursor-pointer focus:outline-none focus:ring-2 focus:ring-(--accent-light)`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-1"
        }`}
      />
    </button>
  );
}
