// Notification permission, subscribe, unsubscribe, test.
import { api, loadConfig } from './supabase.js';

export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

/**
 * 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on'
 */
export async function pushStatus() {
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return Notification.permission === 'granted' && sub ? 'on' : 'off';
}

export const STATUS_TEXT = {
  unsupported: 'Not supported in this browser',
  'ios-install': 'Install required (iOS)',
  blocked: 'Blocked in browser settings',
  off: 'Off',
  on: 'On',
};

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribeNow(reg) {
  const { vapidPublicKey } = await loadConfig();
  if (!vapidPublicKey) throw new Error('VAPID_PUBLIC_KEY is not set on the server.');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  const r = await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  if (!r.ok) throw new Error(r.message || 'Could not save the subscription.');
  return sub;
}

/** Must be called from a user gesture. */
export async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await api('/api/push/subscribe', { method: 'POST', body: { subscription: existing.toJSON() } });
  } else {
    await subscribeNow(reg);
  }
  return 'on';
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/api/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }
  return 'off';
}

export function sendTest() {
  return api('/api/push/test', { method: 'POST' });
}

/**
 * On every app open: if permission is granted, make sure the server has the
 * current subscription, and re-subscribe if the browser rotated or dropped it.
 */
export async function resyncPush() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
    } else {
      await subscribeNow(reg);
    }
  } catch {
    /* quiet: Settings shows the real state */
  }
}
