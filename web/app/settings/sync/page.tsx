"use client";

import { useEffect, useState } from 'react';
import { getUserPreferences, updateUserPreferences, type SyncPreferences } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function SyncSettingsPage() {
  const t = useT();
  const [prefs, setPrefs] = useState<SyncPreferences | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getUserPreferences().then(setPrefs).catch(e => setError(String(e)));
  }, []);

  async function patch(p: Partial<SyncPreferences>) {
    setError('');
    try {
      const updated = await updateUserPreferences(p);
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(String(e));
    }
  }

  if (error) return <div className="p-6 text-red-500">{t("settings.sync.errorPrefix")}{error}</div>;
  if (!prefs) return <div className="p-6">{t("settings.sync.loading")}</div>;

  return (
    <div className="max-w-xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-semibold">{t("settings.sync.title")}</h1>
      <p className="text-sm text-(--muted)">{t("settings.sync.subtitle")}</p>

      <section className="border border-(--card-border) rounded-lg p-4 space-y-3">
        <div className="font-medium">{t("settings.sync.modeHeading")}</div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="radio" checked={prefs.sync_mode === 'active'} onChange={() => patch({ sync_mode: 'active' })} className="mt-1" />
          <div>
            <div className="font-medium">{t("settings.sync.modeActive")}</div>
            <div className="text-sm text-(--muted)">{t("settings.sync.modeActiveDesc")}</div>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="radio" checked={prefs.sync_mode === 'passive'} onChange={() => patch({ sync_mode: 'passive' })} className="mt-1" />
          <div>
            <div className="font-medium">{t("settings.sync.modePassive")}</div>
            <div className="text-sm text-(--muted)">{t("settings.sync.modePassiveDesc")}</div>
          </div>
        </label>
      </section>

      <section className="border border-(--card-border) rounded-lg p-4 space-y-3">
        <div className="font-medium">{t("settings.sync.previewHeading")}</div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="radio" checked={prefs.preview_mode === 'always'} onChange={() => patch({ preview_mode: 'always' })} className="mt-1" />
          <div className="text-sm">{t("settings.sync.previewAlways")}</div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="radio" checked={prefs.preview_mode === 'never'} onChange={() => patch({ preview_mode: 'never' })} className="mt-1" />
          <div className="text-sm">{t("settings.sync.previewNever")}</div>
        </label>
      </section>

      {saved && <div className="text-green-500 text-sm">{t("settings.sync.saved")}</div>}
    </div>
  );
}
