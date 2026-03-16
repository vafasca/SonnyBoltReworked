import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import {
  cancelWebChatLogin,
  confirmWebChatLogin,
  getDefaultSessionId,
  getWebChatSessionStatus,
  startWebChatLogin,
  type WebChatPlatform,
} from '~/lib/.server/webchat';

function normalizePlatform(value: string | null): WebChatPlatform | null {
  if (value === 'chatgpt' || value === 'claude' || value === 'qwen') {
    return value;
  }

  return null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const platform = normalizePlatform(url.searchParams.get('platform'));
  const sessionId = url.searchParams.get('sessionId');

  if (!platform) {
    return json({ error: 'platform inválido' }, { status: 400 });
  }

  const resolvedSessionId = sessionId || getDefaultSessionId(platform);
  const status = await getWebChatSessionStatus({ platform, sessionId: resolvedSessionId });

  return json({
    ok: true,
    platform,
    sessionId: resolvedSessionId,
    status,
  });
}

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const method = request.method.toUpperCase();
    const body = await request.json<{
      platform?: WebChatPlatform;
      sessionId?: string;
      sessionKey?: string;
    }>();

    const platform = body.platform;

    if (!platform || !['chatgpt', 'claude', 'qwen'].includes(platform)) {
      return json({ error: 'platform es obligatorio y debe ser válido' }, { status: 400 });
    }

    const sessionId = body.sessionId || getDefaultSessionId(platform);

    if (method === 'POST') {
      const result = await startWebChatLogin({
        platform,
        sessionId,
        serverEnv: context.cloudflare?.env as Record<string, string> | undefined,
      });

      return json({ ok: true, ...result });
    }

    if (method === 'PUT') {
      const result = await confirmWebChatLogin({
        platform,
        sessionId,
        sessionKey: body.sessionKey,
      });

      return json(result);
    }

    if (method === 'DELETE') {
      const result = await cancelWebChatLogin({
        platform,
        sessionId,
        sessionKey: body.sessionKey,
      });

      return json(result);
    }

    return json({ error: `Método ${method} no soportado` }, { status: 405 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error desconocido' }, { status: 500 });
  }
}
