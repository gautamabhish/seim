import { VariantRegistry } from '../src/variantRegistry';

describe('VariantRegistry', () => {
  let registry: VariantRegistry;

  beforeEach(() => {
    registry = new VariantRegistry();
  });

  it('should register and activate prebuilt handler variants', () => {
    const handlerA = () => 'standard';
    const handlerB = () => 'batched';

    registry.register('/api/users', {
      name: 'standard',
      handler: handlerA,
      description: 'Standard single-query user handler',
    });

    registry.register('/api/users', {
      name: 'batched-query',
      handler: handlerB,
      requires: ['userRepository'],
      description: 'High-throughput batched user handler',
    });

    expect(registry.getVariants('/api/users')).toHaveLength(2);
    expect(registry.getActiveVariant('/api/users')).toBeUndefined();

    const activated = registry.activateVariant('/api/users', 'batched-query');
    expect(activated).toBe(true);
    expect(registry.getActiveVariant('/api/users')?.name).toBe('batched-query');
    expect(registry.getActiveVariant('/api/users')?.handler).toBe(handlerB);

    registry.deactivateVariant('/api/users');
    expect(registry.getActiveVariant('/api/users')).toBeUndefined();
  });

  it('should return false when activating nonexistent variant', () => {
    expect(registry.activateVariant('/api/users', 'nonexistent')).toBe(false);
  });
});
