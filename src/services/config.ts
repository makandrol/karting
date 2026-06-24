// `import.meta.env` exists only under Vite. Guard so the module can also be
// imported from plain Node (e.g. tsx audit scripts) without crashing.
const viteEnvObj = (import.meta as any).env as Record<string, string> | undefined;

/** Read a Vite env var, falling back to process.env under plain Node. */
export function viteEnv(key: string): string | undefined {
  return viteEnvObj?.[key] ?? (typeof process !== 'undefined' ? process.env?.[key] : undefined);
}

export const COLLECTOR_URL = viteEnv('VITE_COLLECTOR_URL') || 'https://ekarting.duckdns.org';
