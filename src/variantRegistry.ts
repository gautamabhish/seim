export interface HandlerVariant<THandler = any> {
  name: string;
  handler: THandler;
  requires?: string[];
  description?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export class VariantRegistry<THandler = any> {
  private variants = new Map<string, HandlerVariant<THandler>[]>();
  private activeVariants = new Map<string, string>(); // routePattern -> variantName

  /**
   * Register a prebuilt handler variant for a route pattern.
   * SEIM can activate it instantly in realtime without AI/closure reconstruction risk.
   */
  public register(routePattern: string, variant: HandlerVariant<THandler>): void {
    const list = this.variants.get(routePattern) || [];
    const idx = list.findIndex((v) => v.name === variant.name);
    if (idx >= 0) {
      list[idx] = variant;
    } else {
      list.push(variant);
    }
    this.variants.set(routePattern, list);
  }

  public getVariants(routePattern: string): HandlerVariant<THandler>[] {
    return this.variants.get(routePattern) || [];
  }

  public getVariant(routePattern: string, name: string): HandlerVariant<THandler> | undefined {
    return this.getVariants(routePattern).find((v) => v.name === name);
  }

  public activateVariant(routePattern: string, name: string): boolean {
    const variant = this.getVariant(routePattern, name);
    if (!variant) return false;

    this.activeVariants.set(routePattern, name);
    return true;
  }

  public deactivateVariant(routePattern: string): void {
    this.activeVariants.delete(routePattern);
  }

  public getActiveVariant(routePattern: string): HandlerVariant<THandler> | undefined {
    const name = this.activeVariants.get(routePattern);
    if (!name) return undefined;
    return this.getVariant(routePattern, name);
  }

  public listAll(): Map<string, HandlerVariant<THandler>[]> {
    return new Map(this.variants);
  }

  public clear(): void {
    this.variants.clear();
    this.activeVariants.clear();
  }
}
