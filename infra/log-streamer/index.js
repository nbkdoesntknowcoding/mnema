/**
 * Mnema log-streamer — isolated sidecar with Docker-socket access.
 *
 * Tails `docker logs --follow` for a named compose service and streams the lines
 * as SSE. Secrets are redacted before they leave this process. Reachable ONLY on
 * the internal Docker network (no published port); the admin API proxies to it
 * after re-checking staff access. This is the only container that touches the
 * Docker socket, so the privilege boundary stays here.
 */
const http = require('http');
const { PassThrough } = require('stream');
const Docker = require('dockerode');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const PROJECT = process.env.COMPOSE_PROJECT || 'mnema-prod';
const PORT = parseInt(process.env.PORT || '9000', 10);
const ALLOWED = new Set(['api', 'workers', 'collab', 'meeting-bot', 'pipecat-meeting']);

// Redact anything that looks like a credential before a line is emitted.
const KV_RE = /((?:api[_-]?key|token|secret|password|passwd|authorization|auth|bearer)["']?\s*[:=]\s*)("?)([^\s"',}]+)/gi;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-]+/gi;
const SK_RE = /\b(sk|rk|whsec|pk)[-_][A-Za-z0-9]{8,}\b/gi;
function redact(line) {
  return String(line)
    .replace(KV_RE, (_m, k, q) => `${k}${q}***`)
    .replace(BEARER_RE, 'Bearer ***')
    .replace(SK_RE, (m) => `${m.slice(0, 6)}***`);
}

async function findContainer(service) {
  const list = await docker.listContainers({
    all: false,
    filters: JSON.stringify({ label: [`com.docker.compose.service=${service}`] }),
  });
  const match = list.find((c) => c.Labels['com.docker.compose.project'] === PROJECT) || list[0];
  return match ? docker.getContainer(match.Id) : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }

  const m = url.pathname.match(/^\/logs\/([a-z0-9-]+)$/i);
  if (!m) { res.writeHead(404); return res.end('not found'); }
  const service = m[1];
  if (!ALLOWED.has(service)) { res.writeHead(400); return res.end('unknown service'); }
  const tail = Math.min(2000, Math.max(1, parseInt(url.searchParams.get('tail') || '200', 10) || 200));

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const container = await findContainer(service).catch(() => null);
  if (!container) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'container_not_found', service })}\n\n`);
    return res.end();
  }

  let logStream;
  try {
    logStream = await container.logs({ follow: true, stdout: true, stderr: true, tail, timestamps: false });
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: 'logs_failed' })}\n\n`);
    return res.end();
  }

  // docker logs are an 8-byte-framed multiplexed stream — demux into one text stream.
  const out = new PassThrough();
  container.modem.demuxStream(logStream, out, out);

  let buf = '';
  out.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      res.write(`data: ${JSON.stringify({ line: redact(line) })}\n\n`);
    }
  });

  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 25000);
  const cleanup = () => { clearInterval(ping); try { logStream.destroy(); } catch { /* noop */ } };
  req.on('close', cleanup);
  logStream.on('end', () => { try { res.write('event: end\ndata: {}\n\n'); } catch { /* noop */ } cleanup(); res.end(); });
  logStream.on('error', () => { cleanup(); res.end(); });
});

server.listen(PORT, () => console.log(`[log-streamer] listening on :${PORT} (project=${PROJECT})`));
