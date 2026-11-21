// Pluggable request delivery. submitRequest(req, cfg) -> { ok, via, error? }
//   cfg.webhookUrl set  -> POST (ntfy.sh URLs get a text/plain body + headers; everything else gets JSON)
//   otherwise           -> open a prefilled mailto: link (call this synchronously from a tap)
import { CONFIG } from './config.js';

const KEY = 'ws.requests.v1';
export const loadRequests = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } };
export const saveRequests = (r) => localStorage.setItem(KEY, JSON.stringify(r.slice(-50)));

export function buildRequest({ theme, mood, music }) {
  return { id: 'req-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: new Date().toISOString(),
    theme: theme.trim(), mood: (mood || '').trim(), music: (music || '').trim(), app: 'writing-sessions', status: 'pending' };
}
export function requestText(r) {
  return `Theme request (${r.id})\n\nTheme: ${r.theme}\nMood: ${r.mood || '-'}\nMusic notes: ${r.music || '-'}\nSent: ${r.createdAt}`;
}
export function mailtoUrl(r, to, subject = CONFIG.REQUEST_MAILTO_SUBJECT) {
  return `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(requestText(r))}`;
}

export async function postWebhook(r, url) {
  const isNtfy = /^https:\/\/ntfy\.sh\//.test(url);
  const res = await fetch(url, isNtfy
    ? { method: 'POST', body: requestText(r), headers: { Title: 'Writing Session request', Tags: 'writing_hand', Priority: '3' } }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
}

/** Returns a promise for webhook delivery, or opens mailto synchronously. */
export function submitRequest(r, settings) {
  const url = (settings.webhookUrl || CONFIG.REQUEST_WEBHOOK_URL || '').trim();
  const to = (settings.mailtoTo || CONFIG.REQUEST_MAILTO_TO || '').trim();
  if (url) {
    return postWebhook(r, url).then(() => ({ ok: true, via: 'webhook' }), (e) => ({ ok: false, via: 'webhook', error: String(e.message || e) }));
  }
  location.href = mailtoUrl(r, to);
  return Promise.resolve({ ok: true, via: 'mailto', hasRecipient: !!to });
}
