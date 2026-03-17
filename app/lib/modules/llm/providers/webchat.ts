import type { LanguageModelV1 } from 'ai';
import { BaseProvider } from '~/lib/modules/llm/base-provider';

export default class WebChatProvider extends BaseProvider {
  name = 'WebChat';
  config = {};
  staticModels = [
    {
      name: 'chatgpt',
      label: 'ChatGPT (web)',
      provider: this.name,
      maxTokenAllowed: 128000,
    },
    {
      name: 'claude',
      label: 'Claude (web)',
      provider: this.name,
      maxTokenAllowed: 200000,
    },
    {
      name: 'qwen',
      label: 'Qwen Chat (web)',
      provider: this.name,
      maxTokenAllowed: 128000,
    },
  ];

  getModelInstance(): LanguageModelV1 {
    throw new Error('WebChat provider uses Playwright bridge and does not expose AI SDK model instances.');
  }
}
