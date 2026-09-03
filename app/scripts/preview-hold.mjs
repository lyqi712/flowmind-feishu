import http from 'node:http';

const TARGET_PORT = 5179;
const LISTEN_PORT = Number(process.env.PORT || process.env.PREVIEW_HOLD_PORT || 5188);

const server = http.createServer((req, res) => {
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${TARGET_PORT}` }
  }, incoming => {
    res.writeHead(incoming.statusCode || 502, incoming.headers);
    incoming.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('FlowMind UI is not running on 5179');
  });
  req.pipe(upstream);
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  process.stdout.write(`preview-hold listening on http://127.0.0.1:${LISTEN_PORT} -> 5179\n`);
});
