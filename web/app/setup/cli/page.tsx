"use client";

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@/lib/i18n';

// Inner component holds useSearchParams() so the outer page can wrap it in
// <Suspense>. Next.js requires this at build time — without the boundary the
// page can't be prerendered and the build fails.
function CliCallbackInner() {
  const t = useT();
  const params = useSearchParams();
  const port = params.get('port');
  const nonce = params.get('nonce');
  const [status, setStatus] = useState<'waiting' | 'sending' | 'done' | 'error'>('waiting');
  const [error, setError] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(3);

  useEffect(() => {
    if (!port || !nonce) { setStatus('error'); setError(t('setup.cliCallback.missingParams')); return; }
    (async () => {
      try {
        const r = await fetch('/api/cli/generate-key', { method: 'POST', credentials: 'include' });
        if (!r.ok) {
          if (r.status === 401) {
            window.location.href = '/?return=' + encodeURIComponent(window.location.pathname + window.location.search);
            return;
          }
          throw new Error('generate-key failed: ' + r.status);
        }
        const { key } = await r.json();
        // Mirror the freshly-rotated key into localStorage so /settings, the
        // home page, and any future tab can render it. Without this, the
        // user's only view of their key is `cat ~/.routerrc` — confusing for
        // anyone expecting a UI surface.
        try { localStorage.setItem('router_key', key); } catch {}
        setStatus('sending');
        await fetch(`http://localhost:${port}/key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, nonce }),
        });
        setStatus('done');
      } catch (e: any) {
        setStatus('error');
        setError(e?.message ?? String(e));
      }
    })();
  }, [port, nonce]);

  useEffect(() => {
    if (status !== 'done') return;
    const tick = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(tick);
          window.close();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [status]);

  return (
    <div className="max-w-md mx-auto py-20 text-center">
      <h1 className="text-xl font-semibold mb-4">{t('setup.cliCallback.title')}</h1>
      {status !== 'error' && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-left text-xs text-amber-900 leading-relaxed">
          <p className="font-medium mb-1">{t('setup.cliCallback.rotateNoticeTitle')}</p>
          <p>{t('setup.cliCallback.rotateNoticeBody')}</p>
        </div>
      )}
      {status === 'waiting' && <p>{t('setup.cliCallback.generating')}</p>}
      {status === 'sending' && <p>{t('setup.cliCallback.sending')}</p>}
      {status === 'done' && (
        <>
          <p className="text-green-600">{t('setup.cliCallback.done', { countdown })}</p>
          <p className="text-sm text-(--muted) mt-2">{t('setup.cliCallback.doneFallback')}</p>
        </>
      )}
      {status === 'error' && <p className="text-red-600">{t('setup.cliCallback.error', { message: error })}</p>}
    </div>
  );
}

export default function CliCallbackPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto py-20 text-center">Loading…</div>}>
      <CliCallbackInner />
    </Suspense>
  );
}
