import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { runWebChatLogin, type WebChatPlatform } from '~/lib/.server/webchat';

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { platform, sessionId, timeoutMs } = await request.json<{
      platform: WebChatPlatform;
      sessionId: string;
      timeoutMs?: number;
    }>();

    if (!platform || !sessionId) {
      return json({ error: 'platform y sessionId son obligatorios' }, { status: 400 });
    }

    await runWebChatLogin({ platform, sessionId, timeoutMs });

    return json({ ok: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error desconocido' }, { status: 500 });
  }
}
