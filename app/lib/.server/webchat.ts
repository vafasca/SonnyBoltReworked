import path from 'node:path';
import { promises as fs } from 'node:fs';

export const WEBCHAT_PROVIDER_NAME = 'WebChat';

export type WebChatPlatform = 'chatgpt' | 'claude' | 'qwen';

interface PlatformConfig {
  url: string;
  inputSelectors: string[];
  outputSelectors: string[];
}

const PLATFORM_CONFIG: Record<WebChatPlatform, PlatformConfig> = {
  chatgpt: {
    url: 'https://chatgpt.com/',
    inputSelectors: ['#prompt-textarea', 'textarea[data-id="root"]', 'textarea'],
    outputSelectors: ['[data-message-author-role="assistant"]', 'article'],
  },
  claude: {
    url: 'https://claude.ai/chats',
    inputSelectors: ['div[contenteditable="true"]', 'textarea'],
    outputSelectors: ['[data-is-streaming="false"]', 'div[data-testid="message-content"]'],
  },
  qwen: {
    url: 'https://chat.qwen.ai/',
    inputSelectors: ['textarea', 'div[contenteditable="true"]'],
    outputSelectors: ['.assistant-message', '[data-role="assistant"]'],
  },
};

function getSessionRoot() {
  return process.env.WEBCHAT_SESSION_DIR || path.join(process.cwd(), '.webchat-sessions');
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function getPlaywright() {
  return import('playwright');
}

async function pickFirstLocator(page: any, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();

    if ((await locator.count()) > 0) {
      return locator;
    }
  }

  return null;
}

export function getDefaultSessionId(platform: WebChatPlatform) {
  return `default-${platform}`;
}

export function resolveWebChatSessionId(options: { apiKeys?: Record<string, string>; platform: WebChatPlatform }) {
  const { apiKeys, platform } = options;

  return (
    apiKeys?.[`${WEBCHAT_PROVIDER_NAME}:${platform}`] ||
    apiKeys?.[WEBCHAT_PROVIDER_NAME] ||
    getDefaultSessionId(platform)
  );
}

export function resolveWebChatHeadless(serverEnv?: Record<string, string>) {
  const value = serverEnv?.WEBCHAT_HEADLESS || process.env.WEBCHAT_HEADLESS;

  if (!value) {
    return false;
  }

  return value === 'true' || value === '1';
}

async function waitForStableResponse(page: any, selectors: string[]) {
  let stableTicks = 0;
  let previous = '';

  for (let i = 0; i < 90; i++) {
    const locator = await pickFirstLocator(page, selectors);
    const current = (
      (await locator
        ?.last()
        .innerText()
        .catch(() => '')) || ''
    ).trim();

    if (current && current === previous) {
      stableTicks += 1;
    } else {
      stableTicks = 0;
      previous = current;
    }

    if (current && stableTicks >= 4) {
      return current;
    }

    await page.waitForTimeout(1000);
  }

  return previous;
}

export async function runWebChatPrompt(options: {
  platform: WebChatPlatform;
  prompt: string;
  sessionId: string;
  headless?: boolean;
}) {
  const { platform, prompt, sessionId, headless = true } = options;
  const config = PLATFORM_CONFIG[platform];

  if (!config) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const { chromium } = await getPlaywright();
  const sessionDir = path.join(getSessionRoot(), sanitize(platform), sanitize(sessionId));
  await ensureDir(sessionDir);

  const context = await chromium.launchPersistentContext(sessionDir, {
    headless,
    viewport: { width: 1440, height: 900 },
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(config.url, { waitUntil: 'domcontentloaded' });

    const input = await pickFirstLocator(page, config.inputSelectors);

    if (!input) {
      throw new Error(
        'No se encontró caja de texto en la plataforma. Inicia sesión primero con /api/webchat-login y reutiliza el mismo sessionId.',
      );
    }

    await input.click({ timeout: 10_000 });
    await input.fill(prompt);
    await input.press('Enter');

    const response = await waitForStableResponse(page, config.outputSelectors);

    if (!response) {
      throw new Error('No se pudo obtener una respuesta del chat web.');
    }

    return response;
  } finally {
    await context.close();
  }
}

export async function runWebChatLogin(options: { platform: WebChatPlatform; sessionId: string; timeoutMs?: number }) {
  const { platform, sessionId, timeoutMs = 180_000 } = options;
  const config = PLATFORM_CONFIG[platform];

  if (!config) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const { chromium } = await getPlaywright();
  const sessionDir = path.join(getSessionRoot(), sanitize(platform), sanitize(sessionId));
  await ensureDir(sessionDir);

  const context = await chromium.launchPersistentContext(sessionDir, {
    headless: false,
    viewport: { width: 1440, height: 900 },
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(config.url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(timeoutMs);
  await context.close();
}
