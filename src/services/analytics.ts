/**
 * Simple analytics — sends page views to collector.
 * No cookies, no external services. Just a POST to our own server.
 */

const COLLECTOR_URL = import.meta.env.VITE_COLLECTOR_URL || 'http://150.230.157.143:3001';

export function trackPageView(path: string, user?: { email: string; name: string } | null) {
  try {
    fetch(`${COLLECTOR_URL}/analytics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        email: user?.email || null,
        name: user?.name || null,
        userAgent: navigator.userAgent,
      }),
    }).catch(() => {}); // fire and forget
  } catch {
    // ignore
  }
}
