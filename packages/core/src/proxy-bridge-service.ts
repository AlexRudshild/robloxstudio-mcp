import { BridgeService, type PluginInstance } from './bridge-service.js';
import { v4 as uuidv4 } from 'uuid';

export class ProxyBridgeService extends BridgeService {
  private primaryBaseUrl: string;
  readonly proxyInstanceId: string;
  private proxyRequestTimeout = 30000;
  private cachedInstances: PluginInstance[] = [];
  private refreshTimer?: ReturnType<typeof setInterval>;
  private static REFRESH_INTERVAL_MS = 1000;

  constructor(primaryBaseUrl: string) {
    super();
    this.primaryBaseUrl = primaryBaseUrl;
    this.proxyInstanceId = uuidv4();
    // The proxy's own instances map is always empty — plugins register with
    // the primary. Mirror the primary's list so getInstances() consumers
    // (get_connected_instances) see the real peers.
    this.refreshInstances();
    this.refreshTimer = setInterval(() => this.refreshInstances(), ProxyBridgeService.REFRESH_INTERVAL_MS);
  }

  private async refreshInstances(): Promise<void> {
    try {
      const res = await fetch(`${this.primaryBaseUrl}/instances`);
      if (!res.ok) return;
      const body = (await res.json()) as { instances?: PluginInstance[] };
      if (Array.isArray(body.instances)) this.cachedInstances = body.instances;
    } catch {
      // Primary unreachable — keep last-known list
    }
  }

  override getInstances(): PluginInstance[] {
    return this.cachedInstances;
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  override async sendRequest(endpoint: string, data: any, target = 'edit'): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.proxyRequestTimeout);

    try {
      const response = await fetch(`${this.primaryBaseUrl}/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint, data, target, proxyInstanceId: this.proxyInstanceId }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text();
        let parsed: any;
        try { parsed = JSON.parse(body); } catch { /* leave undefined */ }
        if (parsed?.error) {
          const err = new Error(parsed.error) as Error & { errorCode?: string; retryable?: boolean; availableTargets?: string[] };
          if (parsed.errorCode) err.errorCode = parsed.errorCode;
          if (parsed.retryable !== undefined) err.retryable = parsed.retryable;
          if (parsed.availableTargets) err.availableTargets = parsed.availableTargets;
          throw err;
        }
        throw new Error(`Proxy request failed (${response.status}): ${body}`);
      }

      const result = await response.json() as { response?: any; error?: string };
      if (result.error) {
        throw new Error(result.error);
      }
      return result.response;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Proxy request timeout');
      }
      throw err;
    }
  }

  override cleanupOldRequests(): void {
    // No-op: primary bridge owns the pending request state
  }

  override clearAllPendingRequests(): void {
    // No-op: primary bridge owns the pending request state
  }
}
