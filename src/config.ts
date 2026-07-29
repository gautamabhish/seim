import { SeimConfig, SeimMode } from './types';

export const DEFAULT_STUDIO_PATH = '/asdfghjklkjhgfdsasdfghj';

export const DEFAULT_SECURITY_CONFIG: NonNullable<SeimConfig['security']> = {
  blockAuthenticationChanges: true,
  blockAuthorizationChanges: true,
  blockPaymentChanges: true,
  blockSecretUsage: true,
  allowedPatternModels: ['sequential-async', 'n-plus-one', 'missing-cache', 'inefficient-loop', 'redundant-serialization', 'blocking-op'],
};

export const DEFAULT_EXPERIMENT_CONFIG: NonNullable<SeimConfig['experiment']> = {
  confidenceThreshold: 0.92,
  canaryPercent: 5,
  rollbackLatencyMs: 1.2,
  rollbackErrorRate: 1.5,
  minSampleSize: 100,
  shadowCooldownMs: 60000,
  shadowAllowedMethods: ['GET'],
};

export function getDefaultConfig(): SeimConfig {
  return {
    mode: 'restrict' as SeimMode,
    studioPath: DEFAULT_STUDIO_PATH,
    businessRules: [],
    securityRules: [],
    ai: {
      generatorModel: 'gpt-4',
      reviewerModel: 'gpt-4',
      verifierModel: 'gpt-4',
      baseUrl: 'https://api.openai.com/v1/chat/completions',
      enabled: false,
    },
    experiment: { ...DEFAULT_EXPERIMENT_CONFIG },
    storage: {
      type: 'memory',
    },
    security: { ...DEFAULT_SECURITY_CONFIG },
    learning: {
      enabled: true,
    },
  };
}

export function mergeConfig(user: Partial<SeimConfig> = {}): SeimConfig {
  const defaults = getDefaultConfig();
  return {
    ...defaults,
    ...user,
    businessRules: [...(user.businessRules ?? defaults.businessRules)],
    securityRules: [...(user.securityRules ?? defaults.securityRules)],
    ai: { ...defaults.ai, ...user.ai },
    experiment: { ...defaults.experiment, ...(user.experiment ?? {}) },
    storage: { ...defaults.storage, ...(user.storage ?? {}) },
    security: { ...defaults.security, ...(user.security ?? {}) },
    learning: { ...defaults.learning, ...(user.learning ?? {}) },
  };
}
