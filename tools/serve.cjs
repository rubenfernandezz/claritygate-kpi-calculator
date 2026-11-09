const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const allowed = new Map([
  ['/index.html', 'text/html; charset=utf-8'],
  ['/metrics-calculator.css', 'text/css; charset=utf-8'],
  ['/metrics-calculator.js', 'text/javascript; charset=utf-8'],
  ['/metric-guide.js', 'text/javascript; charset=utf-8'],
  ['/assets/claritygate-icon.png', 'image/png'],
]);
function createAppServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!allowed.has(pathname) || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, {'Content-Type': allowed.get(pathname), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store'});
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(path.join(root, pathname)).pipe(res);
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  createAppServer().listen(port, '127.0.0.1', () => console.log('Calculator: http://127.0.0.1:' + port));
}
module.exports = { createAppServer };
