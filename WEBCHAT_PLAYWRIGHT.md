# Integración WebChat por Playwright

Se agregó un proveedor nuevo: `WebChat`.

## Qué hace

- Permite enviar prompts a chats web mediante Playwright.
- Modelos disponibles:
  - `chatgpt`
  - `claude`
  - `qwen`
- Las sesiones persisten por carpeta local en `.webchat-sessions/<plataforma>/<sessionId>`.
- Se guardan:
  - `storage-state.json` (cookies/localStorage de login)
  - `session-state.json` (`lastChatUrl` para seguir en el mismo hilo)

## Flujo correcto de login persistente

1. Abrir navegador de login:

```bash
curl -X POST http://localhost:5173/api/webchat-login \
  -H 'content-type: application/json' \
  -d '{"platform":"chatgpt","sessionId":"mi-cuenta"}'
```

2. En la ventana del navegador:
   - completa captcha/login
   - espera a ver el chat normal

3. Confirmar y guardar sesión:

```bash
curl -X PUT http://localhost:5173/api/webchat-login \
  -H 'content-type: application/json' \
  -d '{"platform":"chatgpt","sessionId":"mi-cuenta"}'
```

4. (Opcional) Ver estado de sesión:

```bash
curl "http://localhost:5173/api/webchat-login?platform=chatgpt&sessionId=mi-cuenta"
```

5. (Opcional) Cancelar login abierto:

```bash
curl -X DELETE http://localhost:5173/api/webchat-login \
  -H 'content-type: application/json' \
  -d '{"platform":"chatgpt","sessionId":"mi-cuenta"}'
```

## Uso en chat

Selecciona proveedor `WebChat` y modelo `chatgpt`, `claude` o `qwen`.
La app enviará el prompt al chat web y devolverá el último bloque de respuesta detectado.

## Variables útiles

- `WEBCHAT_SESSION_DIR`: ruta base opcional para sesiones persistentes.
- `WEBCHAT_HEADLESS`: `true|false` para ejecución de prompts.
- `WEBCHAT_BROWSER`: `chromium` (default), `chrome`, `edge`.

## Limitaciones

- Los selectores de UI pueden cambiar por proveedor.
- En entornos sin navegador disponible, Playwright puede fallar.
- Usa `sessionId` por defecto `default-<modelo>` cuando no se especifica uno.
- Puedes sobreescribir por cookie en `apiKeys` con `WebChat:<plataforma>` (ej. `WebChat:chatgpt`).
