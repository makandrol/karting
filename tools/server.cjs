const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8778;
const ROOT = path.resolve(__dirname, '..');
const TRACKS_JSON = path.join(ROOT, 'public/tracks/tracks.json');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ts': 'text/plain',
};

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // POST /save-tracks — зберегти tracks.json
  if (req.method === 'POST' && req.url === '/save-tracks') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        JSON.parse(body); // validate
        fs.writeFileSync(TRACKS_JSON, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        console.log('✅ tracks.json saved');
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET — serve static files
  let filePath = path.join(ROOT, req.url === '/' ? 'tools/path-editor.html' : req.url);
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`🏎️  Editor server: http://localhost:${PORT}/tools/path-editor.html`);
  console.log(`   Saves to: ${TRACKS_JSON}`);
});
