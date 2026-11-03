/** Error carrying the backend's plain-language message plus the HTTP status. */
export class ApiError extends Error {
  status: number;
  code?: string;
  field?: string;
  endpoint?: string;
  constructor(status: number, message: string, opts: { code?: string; field?: string; endpoint?: string } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = opts.code;
    this.field = opts.field;
    this.endpoint = opts.endpoint;
  }
}
/** Live response did not match the contract. */
export class ContractError extends ApiError {
  issues: { path: string; message: string }[];
  constructor(endpoint: string, issues: { path: string; message: string }[]) {
    const first = issues[0];
    super(502, `The server's answer for "${endpoint}" doesn't match the contract${first ? ` (field "${first.path || '(root)'}": ${first.message})` : ''}.`, { code: 'contract_mismatch', endpoint, field: first?.path });
    this.name = 'ContractError';
    this.issues = issues;
  }
}
export type Actor = { role: 'owner' } | { role: 'agent'; agentId: number; name: string };
