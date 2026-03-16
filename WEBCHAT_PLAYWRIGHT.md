# Integración WebChat por Playwright

Se agregó un proveedor nuevo: `WebChat`.

## Qué hace

- Permite enviar prompts a chats web mediante Playwright.
- Modelos disponibles:
  - `chatgpt`
  - `claude`
  - `qwen`
- Las sesiones persisten por carpeta local en `.webchat-sessions/<plataforma>/<sessionId>`.

## Login persistente

Usa este endpoint para abrir el navegador, iniciar sesión manualmente y guardar la sesión:

```bash
curl -X POST http://localhost:5173/api/webchat-login \
  -H 'content-type: application/json' \
  -d '{"platform":"chatgpt","sessionId":"mi-cuenta","timeoutMs":180000}'
```

> Nota: este endpoint abre Chromium en modo visible (`headless: false`).

## Uso en chat

Selecciona proveedor `WebChat` y modelo `chatgpt`, `claude` o `qwen`.
La app enviará el prompt al chat web y devolverá el último bloque de respuesta detectado.

## Variables útiles

- `WEBCHAT_SESSION_DIR`: ruta base opcional para sesiones persistentes.

## Limitaciones

- Los selectores de UI pueden cambiar por proveedor.
- En entornos sin navegador disponible, Playwright puede fallar.
- Actualmente usa `sessionId` por defecto `default-<modelo>` cuando se llama desde `/api/chat`.
