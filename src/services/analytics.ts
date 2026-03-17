/**
 * Analytics — page views + session duration tracking.
 * Sends heartbeat every 30s to measure real time on site.
 */

import { COLLECTOR_URL } from './config';

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

let sessionId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let visibilityListenerAdded = false;

function getSessionId(): string {
  if (!sessionId) {
    sessionId = `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return sessionId;
}

function send(type: string, data: Record<string, unknown>) {
  try {
    fetch(`${COLLECTOR_URL}/analytics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, sessionId: getSessionId(), ...data }),
    }).catch(() => {});
  } catch {}
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => send('heartbeat', {}), HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

export function trackPageView(path: string, user?: { email: string; name: string } | null) {
  send('pageview', {
    path,
    email: user?.email || null,
    name: user?.name || null,
    userAgent: navigator.userAgent,
  });

  startHeartbeat();

  if (!visibilityListenerAdded) {
    visibilityListenerAdded = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopHeartbeat();
      } else {
        send('heartbeat', {});
        startHeartbeat();
      }
    });
  }
}
