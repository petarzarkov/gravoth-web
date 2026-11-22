/** `GET /api/meta`: the server's version, and the oldest game version it still serves. */
export interface MetaInfo {
  readonly service: 'gravoth';
  readonly version: string;
  readonly commit: string;
  readonly minGameVersion: string;
}

/** `GET /api/health`: always 200 while the process serves; the parts say whether Postgres and the rules checker answer. */
export interface HealthView {
  readonly status: 'ok';
  readonly uptimeSeconds: number;
  readonly database: 'up' | 'down';
  readonly validator: 'up' | 'down';
}
