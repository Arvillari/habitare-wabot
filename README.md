# habitare-wabot

Puente WhatsApp ↔ Habitare OS usando `whatsapp-web.js`.

## Qué hace

- Conecta un número de WhatsApp (el del bot) al protocolo de WhatsApp Web.
- Reenvía cada mensaje entrante a un webhook en Habitare (`POST /app/whatsapp_webhook.php`).
- Expone una API `POST /send` para que Habitare envíe mensajes.

## Despliegue en Railway

1. Fork / crear este repo en GitHub.
2. En Railway → **New Project** → **Deploy from GitHub** → elige este repo.
3. En **Settings → Variables**, configura:
   - `HABITARE_WEBHOOK_URL` = `https://habitare.lat/app/whatsapp_webhook.php`
   - `SHARED_SECRET` = genera una cadena larga (ej. 64 caracteres hex)
4. En **Settings → Volumes**, crea un volumen:
   - Mount Path: `/data`
   - Tamaño: 1 GB (más que suficiente para la sesión)
5. Deploy. Ve a los **Logs**.
6. Cuando aparezca el QR, escanéalo desde el WhatsApp del número del bot.
7. Cuando veas "✅ Bot listo", está listo.

## Verificación

`GET /health` → `{"ok": true, "estado": "activo"}`

## Enviar mensaje desde Habitare

```bash
curl -X POST https://TU-BOT.up.railway.app/send \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "TU_SHARED_SECRET",
    "numero": "5219981234567",
    "text": "Hola"
  }'
```

## Ver el QR si no tienes acceso a los logs

Abre en navegador `https://TU-BOT.up.railway.app/qr` — se muestra el QR embebido.
