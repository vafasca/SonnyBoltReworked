import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Browser, BrowserContext, Page } from 'playwright';

export const WEBCHAT_PROVIDER_NAME = 'WebChat';

export type WebChatPlatform = 'chatgpt' | 'claude' | 'qwen';

type BrowserPreference = 'chrome' | 'edge' | 'chromium';

interface PlatformConfig {
  url: string;
  inputSelectors: string[];
  outputSelectors: string[];
  submitSelectors: string[];
}

interface WebChatSessionState {
  lastChatUrl?: string;
  loginVerifiedAt?: string;
}

interface ActiveLoginSession {
  browser: Browser;
  context: BrowserContext;
  platform: WebChatPlatform;
  sessionId: string;
  sessionDir: string;
}

interface ActivePromptSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  sessionDir: string;
  platform: WebChatPlatform;
  sessionId: string;
  conversationId: string;
  lastUsedAt: number;
}

interface SessionStatus {
  hasStorageState: boolean;
  hasSessionState: boolean;
  lastChatUrl?: string;
  loginVerifiedAt?: string;
}

const PLATFORM_CONFIG: Record<WebChatPlatform, PlatformConfig> = {
  chatgpt: {
    url: 'https://chatgpt.com/',
    inputSelectors: ['#prompt-textarea', 'textarea[data-id="root"]', 'textarea', 'div[contenteditable="true"]'],
    outputSelectors: ['[data-message-author-role="assistant"]', 'article'],
    submitSelectors: ['button[data-testid="send-button"]', 'button[aria-label*="Send"]', 'button[type="submit"]'],
  },
  claude: {
    url: 'https://claude.ai/chats',
    inputSelectors: ['div[contenteditable="true"]', 'textarea'],
    outputSelectors: ['[data-is-streaming="false"]', 'div[data-testid="message-content"]'],
    submitSelectors: ['button[aria-label*="Send"]', 'button[type="submit"]'],
  },
  qwen: {
    url: 'https://chat.qwen.ai/',
    inputSelectors: ['textarea', 'div[contenteditable="true"]'],
    outputSelectors: ['.assistant-message', '[data-role="assistant"]'],
    submitSelectors: ['button[aria-label*="Send"]', 'button[type="submit"]'],
  },
};

const activeLoginSessions = new Map<string, ActiveLoginSession>();
const activePromptSessions = new Map<string, ActivePromptSession>();

const PROMPT_SESSION_IDLE_MS = 10 * 60 * 1000;

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

function getSessionDir(platform: WebChatPlatform, sessionId: string) {
  return path.join(getSessionRoot(), sanitize(platform), sanitize(sessionId));
}

function getSessionStatePath(sessionDir: string) {
  return path.join(sessionDir, 'session-state.json');
}

function getStorageStatePath(sessionDir: string) {
  return path.join(sessionDir, 'storage-state.json');
}

function getActiveLoginKey(platform: WebChatPlatform, sessionId: string) {
  return `${platform}:${sessionId}`;
}

function getActivePromptKey(platform: WebChatPlatform, sessionId: string, conversationId: string) {
  return `${platform}:${sessionId}:${conversationId}`;
}

function resolveChannel(preference: BrowserPreference): 'chrome' | 'msedge' | undefined {
  if (preference === 'chrome') {
    return 'chrome';
  }

  if (preference === 'edge') {
    return 'msedge';
  }

  return undefined;
}

function getBrowserPreference(serverEnv?: Record<string, string>): BrowserPreference {
  const envValue = (serverEnv?.WEBCHAT_BROWSER || process.env.WEBCHAT_BROWSER || 'chromium').toLowerCase();

  if (envValue === 'chrome' || envValue === 'edge') {
    return envValue;
  }

  return 'chromium';
}

export function resolveConversationIdFromReferer(referer?: string | null) {
  if (!referer) {
    return 'default';
  }

  try {
    const url = new URL(referer);
    const parts = url.pathname.split('/').filter(Boolean);
    const chatIndex = parts.findIndex((part) => part === 'chat');

    if (chatIndex >= 0 && parts[chatIndex + 1]) {
      return parts[chatIndex + 1];
    }

    return 'default';
  } catch {
    return 'default';
  }
}

async function readSessionState(sessionDir: string): Promise<WebChatSessionState> {
  try {
    const stateFile = getSessionStatePath(sessionDir);
    const content = await fs.readFile(stateFile, 'utf-8');
    const parsed = JSON.parse(content) as WebChatSessionState;

    return parsed || {};
  } catch {
    return {};
  }
}

async function writeSessionState(sessionDir: string, state: WebChatSessionState) {
  const stateFile = getSessionStatePath(sessionDir);
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf-8');
}

async function hasFile(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createContextForPlatform(options: {
  sessionDir: string;
  headless: boolean;
  serverEnv?: Record<string, string>;
}) {
  const { chromium } = await getPlaywright();
  const channel = resolveChannel(getBrowserPreference(options.serverEnv));

  const browser = await chromium.launch({
    headless: options.headless,
    channel,
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled'],
  });

  const storageStatePath = getStorageStatePath(options.sessionDir);
  const hasStorageState = await hasFile(storageStatePath);

  const context = await browser.newContext({
    viewport: null,
    storageState: hasStorageState ? storageStatePath : undefined,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  return { browser, context, storageStatePath };
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

async function writePrompt(input: any, prompt: string) {
  const tagName = await input.evaluate((node: Element) => node.tagName.toLowerCase()).catch(() => '');
  const isContentEditable = await input.evaluate((node: Element) => (node as HTMLElement).isContentEditable);

  await input.click({ timeout: 10_000 });

  if (tagName === 'textarea' || tagName === 'input') {
    await input.fill(prompt);
    return;
  }

  if (isContentEditable) {
    await input.evaluate((node: Element) => {
      (node as HTMLElement).innerHTML = '';
    });
    await input.type(prompt, { delay: 8 });

    return;
  }

  await input.fill(prompt);
}

async function submitPrompt(page: any, input: any, submitSelectors: string[]) {
  for (const selector of submitSelectors) {
    const button = page.locator(selector).first();
    const count = await button.count();

    if (count === 0) {
      continue;
    }

    const isDisabled = await button.isDisabled().catch(() => false);

    if (!isDisabled) {
      await button.click().catch(() => undefined);
      return;
    }
  }

  await input.press('Enter');
}

function assertNoAuthError(url: string) {
  if (url.includes('/api/auth/error')) {
    throw new Error(
      'La sesión web parece inválida (auth/error). Repite login en /api/webchat-login y confirma con PUT para guardar storageState.',
    );
  }
}

async function closePromptSession(key: string) {
  const session = activePromptSessions.get(key);

  if (!session) {
    return;
  }

  try {
    await session.context.close();
    await session.browser.close();
  } catch {
    // ignore close errors
  }

  activePromptSessions.delete(key);
}

async function cleanupIdlePromptSessions() {
  const now = Date.now();
  const entries = Array.from(activePromptSessions.entries());

  for (const [key, session] of entries) {
    if (!session.browser.isConnected() || now - session.lastUsedAt > PROMPT_SESSION_IDLE_MS) {
      await closePromptSession(key);
    }
  }
}

async function getOrCreatePromptSession(options: {
  platform: WebChatPlatform;
  sessionId: string;
  conversationId: string;
  headless: boolean;
  serverEnv?: Record<string, string>;
  startUrl: string;
}) {
  await cleanupIdlePromptSessions();

  const key = getActivePromptKey(options.platform, options.sessionId, options.conversationId);
  const existing = activePromptSessions.get(key);

  if (existing && existing.browser.isConnected()) {
    existing.lastUsedAt = Date.now();
    return { key, session: existing, storageStatePath: getStorageStatePath(existing.sessionDir) };
  }

  if (existing) {
    await closePromptSession(key);
  }

  const sessionDir = getSessionDir(options.platform, options.sessionId);
  await ensureDir(sessionDir);

  const { browser, context, storageStatePath } = await createContextForPlatform({
    sessionDir,
    headless: options.headless,
    serverEnv: options.serverEnv,
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(options.startUrl, { waitUntil: 'domcontentloaded' });

  const created: ActivePromptSession = {
    browser,
    context,
    page,
    sessionDir,
    platform: options.platform,
    sessionId: options.sessionId,
    conversationId: options.conversationId,
    lastUsedAt: Date.now(),
  };

  activePromptSessions.set(key, created);

  return { key, session: created, storageStatePath };
}

export async function getWebChatSessionStatus(options: { platform: WebChatPlatform; sessionId: string }) {
  const { platform, sessionId } = options;
  const sessionDir = getSessionDir(platform, sessionId);
  const storageStatePath = getStorageStatePath(sessionDir);
  const sessionStatePath = getSessionStatePath(sessionDir);
  const [hasStorageState, hasSessionState] = await Promise.all([hasFile(storageStatePath), hasFile(sessionStatePath)]);

  const sessionState = hasSessionState ? await readSessionState(sessionDir) : {};

  const status: SessionStatus = {
    hasStorageState,
    hasSessionState,
    lastChatUrl: sessionState.lastChatUrl,
    loginVerifiedAt: sessionState.loginVerifiedAt,
  };

  return status;
}

export async function runWebChatPrompt(options: {
  platform: WebChatPlatform;
  prompt: string;
  sessionId: string;
  conversationId?: string;
  headless?: boolean;
  serverEnv?: Record<string, string>;
}) {
  const { platform, prompt, sessionId, conversationId = 'default', headless = true, serverEnv } = options;
  const config = PLATFORM_CONFIG[platform];

  if (!config) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const sessionDir = getSessionDir(platform, sessionId);
  await ensureDir(sessionDir);

  const sessionState = await readSessionState(sessionDir);
  const startUrl = sessionState.lastChatUrl || config.url;

  const { session, storageStatePath } = await getOrCreatePromptSession({
    platform,
    sessionId,
    conversationId,
    headless,
    serverEnv,
    startUrl,
  });

  const page = session.page;

  assertNoAuthError(page.url());

  const input = await pickFirstLocator(page, config.inputSelectors);

  if (!input) {
    throw new Error(
      'No se encontró caja de texto. Asegúrate de iniciar sesión con POST /api/webchat-login y luego confirmar con PUT /api/webchat-login.',
    );
  }

  await writePrompt(input, prompt);
  await submitPrompt(page, input, config.submitSelectors);

  const response = await waitForStableResponse(page, config.outputSelectors);

  if (!response) {
    throw new Error('No se pudo obtener una respuesta del chat web.');
  }

  await session.context.storageState({ path: storageStatePath });

  await writeSessionState(sessionDir, {
    ...sessionState,
    lastChatUrl: page.url(),
    loginVerifiedAt: sessionState.loginVerifiedAt,
  });

  session.lastUsedAt = Date.now();

  return response;
}

export async function startWebChatLogin(options: {
  platform: WebChatPlatform;
  sessionId: string;
  serverEnv?: Record<string, string>;
}) {
  const { platform, sessionId, serverEnv } = options;
  const config = PLATFORM_CONFIG[platform];

  if (!config) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const sessionDir = getSessionDir(platform, sessionId);
  await ensureDir(sessionDir);

  const sessionState = await readSessionState(sessionDir);
  const sessionKey = getActiveLoginKey(platform, sessionId);
  const previous = activeLoginSessions.get(sessionKey);

  if (previous) {
    try {
      await previous.context.close();
      await previous.browser.close();
    } catch {
      // ignore stale browser close errors
    }

    activeLoginSessions.delete(sessionKey);
  }

  const { browser, context } = await createContextForPlatform({
    sessionDir,
    headless: false,
    serverEnv,
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.goto(sessionState.lastChatUrl || config.url, { waitUntil: 'domcontentloaded' });

  activeLoginSessions.set(sessionKey, {
    browser,
    context,
    platform,
    sessionId,
    sessionDir,
  });

  return {
    sessionKey,
    currentUrl: page.url(),
    message:
      'Navegador abierto para login. Completa captcha/login y luego llama PUT /api/webchat-login para confirmar y guardar sesión.',
  };
}

export async function confirmWebChatLogin(options: {
  platform: WebChatPlatform;
  sessionId: string;
  sessionKey?: string;
}) {
  const computedSessionKey = options.sessionKey || getActiveLoginKey(options.platform, options.sessionId);
  const activeSession = activeLoginSessions.get(computedSessionKey);

  if (!activeSession) {
    throw new Error('No hay sesión de login activa para confirmar.');
  }

  const storageStatePath = getStorageStatePath(activeSession.sessionDir);
  const page = activeSession.context.pages()[0];

  if (page) {
    assertNoAuthError(page.url());
  }

  await activeSession.context.storageState({ path: storageStatePath });

  const previousState = await readSessionState(activeSession.sessionDir);
  await writeSessionState(activeSession.sessionDir, {
    ...previousState,
    lastChatUrl: page?.url() || previousState.lastChatUrl,
    loginVerifiedAt: new Date().toISOString(),
  });

  await activeSession.context.close();
  await activeSession.browser.close();
  activeLoginSessions.delete(computedSessionKey);

  return {
    ok: true,
    sessionKey: computedSessionKey,
    message: 'Sesión confirmada y storageState guardado.',
  };
}

export async function cancelWebChatLogin(options: {
  platform: WebChatPlatform;
  sessionId: string;
  sessionKey?: string;
}) {
  const computedSessionKey = options.sessionKey || getActiveLoginKey(options.platform, options.sessionId);
  const activeSession = activeLoginSessions.get(computedSessionKey);

  if (activeSession) {
    try {
      await activeSession.context.close();
      await activeSession.browser.close();
    } catch {
      // ignore stale browser close errors
    }

    activeLoginSessions.delete(computedSessionKey);
  }

  return {
    ok: true,
    sessionKey: computedSessionKey,
  };
}
