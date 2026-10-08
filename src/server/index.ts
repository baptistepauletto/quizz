import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { usingDefaultPin } from './auth';
import { pictureType, PICTURES_DIR, resolvePicture } from './pictures';
import { prepRoutes } from './prep';
import { Room } from './room';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0'; // bind to the LAN so phones can reach us
const CLIENT_DIR = path.resolve('dist/client');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

// VirtualBox / VMware / WSL / Docker adapters have private IPs too, but phones cannot reach them.
const VIRTUAL_ADAPTER = /virtual|vbox|vmware|vethernet|hyper-v|wsl|docker|bluetooth|loopback|tailscale|zerotier|\btap\b|\btun\b/i;

/** Private-network IPv4 addresses of this machine, the real Wi-Fi/Ethernet one first. */
// Default subnets of VirtualBox host-only (56), Docker (17), etc. Adapter names are often just "Ethernet 3".
const VIRTUAL_SUBNET = /^(192\.168\.56\.|192\.168\.99\.|172\.17\.|172\.18\.|10\.0\.2\.)/;
const WIFI_NAME = /wi-?fi|wlan|wireless/i;

function lanAddresses(): string[] {
  const found: Array<{ ip: string; penalty: number }> = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const addr of list ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const privateRank = addr.address.startsWith('192.168.')
        ? 0
        : addr.address.startsWith('10.')
          ? 1
          : /^172\.(1[6-9]|2\d|3[01])\./.test(addr.address)
            ? 2
            : 3;
      const penalty =
        (VIRTUAL_ADAPTER.test(name) ? 100 : 0) +
        (VIRTUAL_SUBNET.test(addr.address) ? 50 : 0) +
        (WIFI_NAME.test(name) ? 0 : 10) +
        privateRank;
      found.push({ ip: addr.address, penalty });
    }
  }
  return found.sort((a, b) => a.penalty - b.penalty).map((f) => f.ip);
}

const app = Fastify({ logger: { level: 'warn' } });
const room = new Room();

await app.register(websocket);
await app.register(prepRoutes);

app.register(async (ws) => {
  ws.get('/ws', { websocket: true }, (socket) => room.attach(socket));
});

app.get('/api/info', async () => ({ ips: lanAddresses(), port: PORT }));

// Sprint photos. The path is relative to the pictures folder; nothing outside it is served.
fs.mkdirSync(PICTURES_DIR, { recursive: true });
app.get('/media/*', async (req, reply) => {
  const wild = (req.params as { '*': string })['*'] ?? '';
  const file = resolvePicture(wild);
  if (!file) return reply.code(404).send({ error: 'Not found' });
  return reply.type(pictureType(file)).header('Cache-Control', 'no-cache').send(fs.createReadStream(file));
});

// Serve the built client (npm run build) and fall back to index.html for client-side routes.
app.get('/*', async (req, reply) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.startsWith('/api/') || urlPath.startsWith('/media/') || urlPath === '/ws') {
    return reply.code(404).send({ error: 'Not found' });
  }

  const index = path.join(CLIENT_DIR, 'index.html');
  if (!fs.existsSync(index)) {
    return reply
      .code(503)
      .type('text/plain')
      .send('The client is not built yet. Run "npm run build" first (or use "npm run dev" and open port 5173).');
  }

  const requested = path.normalize(path.join(CLIENT_DIR, urlPath));
  const inside = requested.startsWith(CLIENT_DIR + path.sep);
  const isFile = inside && fs.existsSync(requested) && fs.statSync(requested).isFile();
  const file = isFile ? requested : index;
  if (isFile && urlPath.startsWith('/assets/')) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
  else reply.header('Cache-Control', 'no-cache');
  return reply.type(MIME[path.extname(file)] ?? 'application/octet-stream').send(fs.createReadStream(file));
});

await app.listen({ port: PORT, host: HOST });

const ips = lanAddresses();
const base = (ip: string) => `http://${ip}:${PORT}`;
console.log('\n  Quizz In is running\n');
console.log(`  TV      ${base('localhost')}/tv        (open this on the computer plugged into the TV)`);
console.log(`  Host    ${base(ips[0] ?? 'localhost')}/host      (your phone)`);
console.log(`  Prep    ${base(ips[0] ?? 'localhost')}/prep      (your phone, to review questions)`);
console.log(`  Players scan the QR code on the TV (${ips.map(base).join(', ') || 'no LAN address found'})`);
if (room.game) console.log(`\n  Resumed game ${room.game.joinCode} (${room.game.packTitle})`);
if (usingDefaultPin) console.log('\n  Using the default PIN 1234. Set HOST_PIN to choose your own, e.g. $env:HOST_PIN="4321"; npm start');
console.log('');
