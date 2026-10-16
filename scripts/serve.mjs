import { createServer } from 'node:http';

import { readFile, stat } from 'node:fs/promises';

import { resolve, extname, sep } from 'node:path';

const root = resolve(process.argv[2] || 'public');

const port = Number(process.env.PORT || 5173);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8'
};

const server = createServer((async (request, response) => {
  try {
    if (![ 'GET', 'HEAD' ].includes(request.method)) {
      response.writeHead(405);
      response.end();
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    let path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if ((await stat(path)).isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(301, {
          Location: url.pathname + '/' + url.search
        });
        response.end();
        return;
      }
      path = resolve(path, 'index.html');
    }
    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': types[extname(path)] || 'application/octet-stream',
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8'
    });
    response.end('Not found');
  }
}));

server.listen(port, '127.0.0.1', (() => console.log(`HayDex: http://localhost:${port}`)));

for (const signal of [ 'SIGINT', 'SIGTERM' ]) process.on(signal, (() => server.close((() => process.exit(0)))));
