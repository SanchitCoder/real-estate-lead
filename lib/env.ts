/** Server-side environment. NEVER import this from client components. */
export const DATA_MODE: 'mock' | 'live' = process.env.NEXT_PUBLIC_DATA_MODE === 'live' ? 'live' : 'mock';

export function serverEnv() {
  return {
    mode: DATA_MODE,
    baseUrl: (process.env.N8N_BASE_URL ?? '').replace(/\/+$/, ''),
    authHeaderName: process.env.N8N_WEBHOOK_AUTH_HEADER_NAME ?? 'X-RE-Key',
    authValue: process.env.N8N_WEBHOOK_AUTH_VALUE ?? '',
    /** "test" calls /webhook-test/ (editor test URLs) instead of /webhook/ */
    webhookMode: process.env.N8N_WEBHOOK_MODE === 'test' ? 'webhook-test' : 'webhook',
    ownerPassword: process.env.OWNER_PASSWORD ?? '',
    agentSeed: process.env.AGENT_LOGIN_SEED ?? '',
    sessionSecret: process.env.SESSION_SECRET ?? '',
  };
}
