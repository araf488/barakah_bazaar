/** Per-dependency verdict. `disabled` means intentionally not configured. */
export type ComponentStatus = 'up' | 'down' | 'disabled';

export interface HealthReport {
  /** `degraded` whenever a dependency the API needs to serve traffic is down. */
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: ComponentStatus;
    authentication: ComponentStatus;
    storage: ComponentStatus;
    queue: ComponentStatus;
  };
}
