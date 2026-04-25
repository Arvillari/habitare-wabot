/**
 * server.js — Puente WhatsApp ↔ Habitare OS
 *
 * Usa whatsapp-web.js (protocolo WhatsApp Web vía Chromium headless).
 * - Al arrancar por primera vez muestra QR en logs → escanea con teléfono del bot.
 * - Sesión persistente en SESSION_PATH (configurar Volume en Railway).
 * - Recibe mensajes → POST a HABITARE_WEBHOOK_URL.
 * - Expone POST /send para que Habitare envíe mensajes.
 */

const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// ═══════════════════════════════════════════════════════════════════════
// CONFIG (desde Railway env vars)
// ═══════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

// Puerto HARDCODED a 3000 — evita discrepancias con Target Port de Railway
const PORT              = 3000;
const HABITARE_WEBHOOK  = process.env.HABITARE_WEBHOOK_URL;
const SHARED_SECRET     = process.env.SHARED_SECRET;
let   SESSION_PATH      = process.env.SESSION_PATH || '/data/wwebjs_auth';

if (!HABITARE_WEBHOOK || !SHARED_SECRET) {
    console.error('❌ Falta variable de entorno: HABITARE_WEBHOOK_URL y/o SHARED_SECRET');
    process.exit(1);
}

// Si el path configurado no es escribible (no hay volumen montado), fallback a /tmp
try {
    fs.mkdirSync(SESSION_PATH, { recursive: true });
    fs.accessSync(SESSION_PATH, fs.constants.W_OK);
} catch (e) {
    const fallback = '/tmp/wwebjs_auth';
    console.warn(`⚠️  SESSION_PATH "${SESSION_PATH}" no escribible (${e.code}). Fallback a ${fallback}`);
    console.warn('    SIN VOLUMEN PERSISTENTE la sesión se pierde al reiniciar — tendrás que re-escanear QR.');
    SESSION_PATH = fallback;
    fs.mkdirSync(SESSION_PATH, { recursive: true });
}

console.log('🔧 Config:');
console.log('  Webhook: ' + HABITARE_WEBHOOK);
console.log('  Session path: ' + SESSION_PATH);
console.log('  Port: ' + PORT);
console.log('  Chromium: ' + (process.env.PUPPETEER_EXECUTABLE_PATH || '(auto)'));

// ═══════════════════════════════════════════════════════════════════════
// Express API
// ═══════════════════════════════════════════════════════════════════════
const app = express();
app.use(express.json({ limit: '12mb' }));

let estadoBot = 'iniciando';
let ultimoQR = null;

// ═══════════════════════════════════════════════════════════════════════
// WhatsApp client
// ═══════════════════════════════════════════════════════════════════════
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_PATH }),
    puppeteer: {
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
        headless: true
    }
});

client.on('qr', (qr) => {
    ultimoQR = qr;
    estadoBot = 'esperando_qr';
    console.log('\n\n📱 ESCANEA ESTE QR CON WHATSAPP DEL NÚMERO DEL BOT:\n');
    qrcode.generate(qr, { small: true });
    console.log('\n  (Ve también a https://habitare-wabot-production.up.railway.app/qr para verlo en navegador si prefieres.)\n');
});

client.on('loading_screen', (percent, msg) => {
    console.log(`⏳ Cargando ${percent}% - ${msg}`);
});

client.on('authenticated', () => {
    console.log('🔐 Sesión autenticada, conectando...');
    estadoBot = 'autenticando';
});

client.on('ready', () => {
    console.log('✅ Bot listo y conectado a WhatsApp');
    ultimoQR = null;
    estadoBot = 'activo';
});

client.on('auth_failure', (msg) => {
    console.error('❌ Auth failure:', msg);
    estadoBot = 'auth_fail';
});

client.on('disconnected', (reason) => {
    console.warn('⚠️  Desconectado:', reason);
    estadoBot = 'desconectado';
    // Reconectar automático tras 5s
    setTimeout(() => {
        console.log('🔄 Reintentando...');
        client.initialize().catch(e => console.error('Retry error:', e));
    }, 5000);
});

// ═══════════════════════════════════════════════════════════════════════
// Forward mensajes entrantes → webhook Habitare
// ═══════════════════════════════════════════════════════════════════════
client.on('message', async (msg) => {
    if (msg.fromMe) return;          // ignorar mensajes propios
    if (msg.isStatus) return;         // ignorar status
    if (msg.from.endsWith('@g.us')) return;  // ignorar grupos

    try {
        const contact = await msg.getContact().catch(() => ({}));
        const numero = msg.from.replace(/@c\.us$/, '');

        const payload = {
            secret: SHARED_SECRET,
            from: msg.from,
            numero: numero,                   // "521998xxx" (sin +)
            numero_mx: '+' + numero,          // "+521998xxx"
            text: msg.body || '',
            name: contact.pushname || contact.name || contact.shortName || '',
            timestamp: msg.timestamp,
            has_media: msg.hasMedia,
            message_id: msg.id ? msg.id._serialized : null,
            type: msg.type
        };

        // Adjuntar media si es imagen/documento (cap a 5 MB)
        if (msg.hasMedia) {
            try {
                const media = await msg.downloadMedia();
                if (media && media.data.length < 5 * 1024 * 1024) {
                    payload.media_mime = media.mimetype;
                    payload.media_filename = media.filename || 'adjunto';
                    payload.media_base64 = media.data;
                } else {
                    payload.media_error = 'demasiado grande (>5MB)';
                }
            } catch (e) {
                payload.media_error = e.message;
            }
        }

        const resp = await fetch(HABITARE_WEBHOOK, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(25000)
        });

        // Habitare puede responder inmediatamente con reply_text
        const data = await resp.json().catch(() => ({}));
        if (data.reply_text) {
            await msg.reply(data.reply_text);
        }

    } catch (e) {
        console.error('❌ Error reenviando msg al webhook:', e.message);
    }
});

// ═══════════════════════════════════════════════════════════════════════
// HTTP API (Habitare usa /send para enviar)
// ═══════════════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
    res.json({
        service: 'habitare-wabot',
        estado: estadoBot,
        tiene_qr_pendiente: !!ultimoQR,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    // Siempre 200 mientras el proceso esté vivo — Railway solo mata si el proceso muere
    res.status(200).json({
        ok: estadoBot !== 'error_init',
        estado: estadoBot,
        conectado: estadoBot === 'activo',
        ts: Date.now()
    });
});

// Mostrar QR en navegador (útil si no ves la terminal de Railway)
app.get('/qr', (req, res) => {
    if (!ultimoQR) return res.send('<h1>No hay QR pendiente</h1><p>Estado: ' + estadoBot + '</p>');
    const url = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' + encodeURIComponent(ultimoQR);
    res.send(`
        <!DOCTYPE html><html><head><title>WhatsApp QR</title>
        <meta http-equiv="refresh" content="15"></head>
        <body style="background:#111;color:#eee;font-family:sans-serif;text-align:center;padding:30px;">
            <h1>Escanea con WhatsApp del bot</h1>
            <p>Abre WhatsApp → Ajustes → Dispositivos vinculados → Vincular</p>
            <img src="${url}" style="background:white;padding:16px;border-radius:8px;margin:20px;">
            <p style="color:#888;font-size:12px;">Se refresca cada 15s. Estado: ${estadoBot}</p>
        </body></html>
    `);
});

app.post('/send', async (req, res) => {
    const { secret, numero, text, media_base64, media_mime, media_filename } = req.body || {};

    if (secret !== SHARED_SECRET) {
        return res.status(403).json({ ok: false, error: 'secret inválido' });
    }
    if (estadoBot !== 'activo') {
        return res.status(503).json({ ok: false, error: `bot no listo: ${estadoBot}` });
    }
    if (!numero || (!text && !media_base64)) {
        return res.status(400).json({ ok: false, error: 'numero + (text o media) requeridos' });
    }

    try {
        // Normalizar número a formato wa: solo dígitos, con LADA país
        let num = String(numero).replace(/[^\d]/g, '');
        if (num.length === 10) num = '52' + num;   // México default
        const chatId = num + '@c.us';

        let sent;
        if (media_base64) {
            const media = new MessageMedia(media_mime || 'image/png', media_base64, media_filename || 'file');
            sent = await client.sendMessage(chatId, media, { caption: text || '' });
        } else {
            sent = await client.sendMessage(chatId, text);
        }
        res.json({ ok: true, message_id: sent.id._serialized, to: chatId });
    } catch (e) {
        console.error('❌ /send error:', e.message);
        res.status(500).json({ ok: false, error: e.message });
    }
});

// Logout (dejar de usar sesión actual — forzaría nuevo QR)
app.post('/logout', async (req, res) => {
    if (req.body?.secret !== SHARED_SECRET) return res.status(403).json({ ok: false });
    try {
        await client.logout();
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// Arranque
// ═══════════════════════════════════════════════════════════════════════
// Escuchar en 0.0.0.0 explícito (Docker) + puerto fijo
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP escuchando en 0.0.0.0:${PORT} (todas las interfaces)`);
    console.log(`   GET /          → status básico`);
    console.log(`   GET /health    → health check`);
    console.log(`   GET /qr        → QR visual para escanear`);
    console.log(`   POST /send     → enviar mensaje (con SHARED_SECRET)`);
});

console.log('🚀 Inicializando WhatsApp client...');
client.initialize().catch((err) => {
    console.error('❌ Error al inicializar:', err);
    estadoBot = 'error_init';
});
