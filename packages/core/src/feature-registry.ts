export type FeatureName = string;

export interface FeatureInfo {
  name: FeatureName;
  description: string;
  toolCount: number;
}

export class FeatureRegistry {
  private enabled: Set<FeatureName>;
  private listeners: Set<() => void> = new Set();
  private readonly always: ReadonlySet<FeatureName>;

  constructor(initial: FeatureName[], always: FeatureName[] = ['core', 'meta']) {
    this.always = new Set(always);
    this.enabled = new Set([...always, ...initial]);
  }

  isEnabled(feature: FeatureName): boolean {
    return this.enabled.has(feature);
  }

  isAlwaysOn(feature: FeatureName): boolean {
    return this.always.has(feature);
  }

  enable(feature: FeatureName): boolean {
    if (this.enabled.has(feature)) return false;
    this.enabled.add(feature);
    this.emit();
    return true;
  }

  disable(feature: FeatureName): boolean {
    if (this.always.has(feature)) return false;
    if (!this.enabled.has(feature)) return false;
    this.enabled.delete(feature);
    this.emit();
    return true;
  }

  getEnabled(): FeatureName[] {
    return [...this.enabled];
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch {
        // listeners must not throw; ignore
      }
    }
  }
}
