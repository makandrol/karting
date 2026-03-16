/**
 * Analytics — page views + session duration tracking.
 * Sends heartbeat every 30s to measure real time on site.
 */

const COLLECTOR_URL = import.meta.env.VITE_COLLECTOR_URL || 'http://150.230.157.143:3001';
const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

let sessionId: string | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

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

export function trackPageView(path: string, user?: { email: string; name: string } | null) {
  send('pageview', {
    path,
    email: user?.email || null,
    name: user?.name || null,
    userAgent: navigator.userAgent,
  });

  // Start heartbeat if not running
  if (!heartbeatTimer) {
    heartbeatTimer = setInterval(() => {
      send('heartbeat', {});
    }, HEARTBEAT_INTERVAL);

    // Stop heartbeat when tab becomes hidden
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      } else {
        if (!heartbeatTimer) {
          send('heartbeat', {});
          heartbeatTimer = setInterval(() => send('heartbeat', {}), HEARTBEAT_INTERVAL);
        }
      }
    });
  }
}
