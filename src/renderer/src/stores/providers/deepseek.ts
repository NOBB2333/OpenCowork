import type { BuiltinProviderPreset } from './types'

export const deepseekPreset: BuiltinProviderPreset = {
  builtinId: 'deepseek',
  name: 'DeepSeek',
  type: 'openai-chat',
  defaultBaseUrl: 'https://api.deepseek.com/v1',
  homepage: 'https://platform.deepseek.com',
  apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  defaultModels: [
    {
      id: 'deepseek-chat',
      name: 'DeepSeek V3.2 (Chat)',
      icon: 'deepseek',
      enabled: true,
      contextLength: 128_000,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.26,
      outputPrice: 0.38,
      cacheCreationPrice: 0.26,
      cacheHitPrice: 0.026,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'deepseek-reasoner',
      name: 'DeepSeek V3.2 (Reasoner)',
      icon: 'deepseek',
      enabled: true,
      contextLength: 128_000,
      maxOutputTokens: 64_000,
      supportsVision: false,
      supportsFunctionCall: false,
      inputPrice: 0.7,
      outputPrice: 2.5,
      cacheCreationPrice: 0.7,
      cacheHitPrice: 0.07
    }
  ]
}
