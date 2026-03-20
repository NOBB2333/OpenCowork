import type { BuiltinProviderPreset } from './types'

export const minimaxCodingPreset: BuiltinProviderPreset = {
  builtinId: 'minimax-coding',
  name: 'MiniMax（套餐）',
  type: 'anthropic',
  defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
  homepage: 'https://platform.minimaxi.com/subscribe/coding-plan',
  apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  defaultEnabled: true,
  defaultModels: [
    // Coding Plan models (official docs: same Anthropic endpoint, dedicated Coding Plan key)
    {
      id: 'MiniMax-M2.5',
      name: 'MiniMax M2.5',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      supportsFunctionCall: true
    },
    {
      id: 'MiniMax-M2.5-highspeed',
      name: 'MiniMax M2.5 Highspeed',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      supportsFunctionCall: true
    },
    {
      id: 'MiniMax-M2.1',
      name: 'MiniMax M2.1',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      supportsFunctionCall: true
    },
    {
      id: 'MiniMax-M2',
      name: 'MiniMax M2',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      supportsFunctionCall: true
    }
  ]
}

export const minimaxPreset: BuiltinProviderPreset = {
  builtinId: 'minimax',
  name: 'MiniMax（官方）',
  type: 'anthropic',
  defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
  homepage: 'https://www.minimaxi.com',
  apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  defaultModels: [
    // OpenRouter USD pricing references:
    // M2.5: https://openrouter.ai/minimax/minimax-m2.5
    // M2.1: https://openrouter.ai/minimax/minimax-m2.1
    // M2: https://openrouter.ai/minimax/minimax-m2
    {
      id: 'MiniMax-M2.5',
      name: 'MiniMax M2.5',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      supportsFunctionCall: true,
      inputPrice: 0.3,
      outputPrice: 1.1
    },
    {
      id: 'MiniMax-M2.5-highspeed',
      name: 'MiniMax M2.5 Highspeed',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      supportsFunctionCall: true
    },
    {
      id: 'MiniMax-M2.1',
      name: 'MiniMax M2.1',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      supportsFunctionCall: true,
      inputPrice: 0.27,
      outputPrice: 0.95
    },
    {
      id: 'MiniMax-M2.1-highspeed',
      name: 'MiniMax M2.1 Highspeed',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      supportsFunctionCall: true
    },
    {
      id: 'MiniMax-M2',
      name: 'MiniMax M2',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      supportsFunctionCall: true,
      inputPrice: 0.255,
      outputPrice: 1
    }
  ]
}
