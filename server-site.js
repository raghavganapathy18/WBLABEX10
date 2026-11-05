/*
  Craft.co: Node.js server that serves the website AND handles its forms.
  Uses only built-in Node modules (http, fs, path, crypto).

  Run:  node server-site.js      then open  http://localhost:3000
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MAX_BODY = 100 * 1024; // 100 KB is plenty for these forms

/* ---------------- Data helpers (small JSON files) ---------------- */
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return [];
  }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // swap in the new file in one step
}

/* ---------------- Catalogue ---------------- */
const PRODUCTS = [
  { id: 'keychain', name: 'Crochet Keychain', price: 149, category: 'keychain' },
  { id: 'backpack', name: 'Crochet Backpack', price: 799, category: 'bag' },
  { id: 'sweater', name: 'Handmade Sweater', price: 1299, category: 'apparel' },
  { id: 'bunny', name: 'Crochet Bunny Toy', price: 499, category: 'soft-toy' },
  { id: 'frame-large', name: 'Customised Photo Frame Large', price: 599, category: 'photo-frame' },
  { id: 'frame-medium', name: 'Customised Photo Frame Medium', price: 199, category: 'photo-frame' },
  { id: 'frame-small', name: 'Customised Photo Frame Small', price: 99, category: 'photo-frame' }
];
const CATEGORIES = ['photo-frame', 'keychain', 'bag', 'apparel', 'soft-toy'];
const SOURCES = ['TV', 'Magazine', 'Social', 'Friends', 'Others', 'Connection'];
const PAYMENTS = ['COD', 'Card', 'Netbanking', 'UPI'];

/* ---------------- Validation ---------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;

function validateOrder(b) {
  const errors = [];
  if (!isText(b.name, 80)) errors.push('Name is required (up to 80 characters).');
  if (typeof b.phone !== 'string' || !/^\d{10}$/.test(b.phone)) errors.push('Phone number must be exactly 10 digits.');
  if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email) || b.email.length > 120) errors.push('A valid email address is required.');
  if (!CATEGORIES.includes(b.category)) errors.push('Please choose a valid category.');
  if (b.expectedDate) {
    if (typeof b.expectedDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.expectedDate)) errors.push('Expected date is not valid.');
    else if (b.expectedDate < todayISO()) errors.push('Expected date cannot be in the past.');
  }
  if (b.sources !== undefined && (!Array.isArray(b.sources) || !b.sources.every((s) => SOURCES.includes(s)))) errors.push('Invalid "how did you hear about us" choice.');
  if (b.payment !== undefined && !PAYMENTS.includes(b.payment)) errors.push('Invalid payment mode.');
  if (b.feedback !== undefined && (typeof b.feedback !== 'string' || b.feedback.length > 1000)) errors.push('Feedback must be 1000 characters or fewer.');
  if (b.rate !== undefined && !(Number.isInteger(b.rate) && b.rate >= 1 && b.rate <= 10)) errors.push('Rating must be a whole number from 1 to 10.');
  if (b.referenceImageName !== undefined && (typeof b.referenceImageName !== 'string' || b.referenceImageName.length > 200)) errors.push('Reference image name is too long.');
  return errors;
}

function validateSignup(b) {
  const errors = [];
  if (!isText(b.name, 80)) errors.push('Name is required (up to 80 characters).');
  if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email) || b.email.length > 120) errors.push('A valid email address is required.');
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200) errors.push('Password must be at least 8 characters.');
  return errors;
}

/* ---------------- Passwords (never stored in plain text) ---------------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return attempt.length === real.length && crypto.timingSafeEqual(attempt, real);
}

/* ---------------- Response helpers ---------------- */
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS });
  res.end(JSON.stringify(data));
}
function sendHtml(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
  res.end(html);
}
function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function isLocal(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const type = (req.headers['content-type'] || '').split(';')[0].trim();
    if (type !== 'application/json') return reject({ status: 415, message: 'Send the data as application/json.' });
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (tooBig) return; // keep reading (and ignoring) so the client can receive our reply
      size += chunk.length;
      if (size > MAX_BODY) {
        tooBig = true;
        chunks.length = 0;
        reject({ status: 413, message: 'The request is too large.', close: true });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooBig) return;
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
        resolve(data);
      } catch (err) {
        reject({ status: 400, message: 'The request body is not valid JSON.' });
      }
    });
    req.on('error', () => reject({ status: 400, message: 'The request could not be read.' }));
  });
}

/* ---------------- API routes ---------------- */
async function handleApi(req, res, route) {
  if (route === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
  }

  if (route === '/api/products' && req.method === 'GET') {
    return sendJson(res, 200, PRODUCTS);
  }

  if (route === '/api/orders' && req.method === 'POST') {
    const body = await readBody(req);
    const errors = validateOrder(body);
    if (errors.length) return sendJson(res, 400, { ok: false, errors });

    const orders = readJson(ORDERS_FILE);
    const order = {
      id: 'CR-' + String(orders.length + 1).padStart(4, '0'),
      receivedAt: new Date().toISOString(),
      name: body.name.trim(),
      phone: body.phone,
      email: body.email.trim(),
      category: body.category,
      expectedDate: body.expectedDate || null,
      referenceImageName: body.referenceImageName || null,
      sources: body.sources || [],
      payment: body.payment || 'COD',
      feedback: (body.feedback || '').trim(),
      rate: body.rate || null
    };
    orders.push(order);
    writeJson(ORDERS_FILE, orders);
    return sendJson(res, 201, { ok: true, id: order.id, message: 'Order request received.' });
  }

  if (route === '/api/orders' && req.method === 'GET') {
    if (!isLocal(req)) return sendJson(res, 403, { ok: false, errors: ['Orders can only be viewed on the server computer.'] });
    return sendJson(res, 200, readJson(ORDERS_FILE));
  }

  if (route === '/api/signup' && req.method === 'POST') {
    const body = await readBody(req);
    const errors = validateSignup(body);
    if (errors.length) return sendJson(res, 400, { ok: false, errors });

    const users = readJson(USERS_FILE);
    const email = body.email.trim().toLowerCase();
    if (users.some((u) => u.email === email)) {
      return sendJson(res, 409, { ok: false, errors: ['An account with this email already exists. Please sign in.'] });
    }
    users.push({ name: body.name.trim(), email, password: hashPassword(body.password), createdAt: new Date().toISOString() });
    writeJson(USERS_FILE, users);
    return sendJson(res, 201, { ok: true, name: body.name.trim(), message: 'Account created.' });
  }

  if (route === '/api/signin' && req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.username !== 'string' || typeof body.password !== 'string' || !body.username.trim() || !body.password) {
      return sendJson(res, 400, { ok: false, errors: ['Enter your email and password.'] });
    }
    const id = body.username.trim().toLowerCase();
    const user = readJson(USERS_FILE).find((u) => u.email === id || u.name.toLowerCase() === id);
    // The same message is used for "no such user" and "wrong password"
    if (!user || !checkPassword(body.password, user.password)) {
      return sendJson(res, 401, { ok: false, errors: ['Invalid email or password.'] });
    }
    return sendJson(res, 200, { ok: true, name: user.name, message: 'Signed in.' });
  }

  const known = ['/api/health', '/api/products', '/api/orders', '/api/signup', '/api/signin'];
  if (known.includes(route)) return sendJson(res, 405, { ok: false, errors: ['Method not allowed.'] });
  return sendJson(res, 404, { ok: false, errors: ['Unknown API endpoint.'] });
}

/* ---------------- Admin page: view received orders (this computer only) ---------------- */
function adminOrdersPage(req, res) {
  if (!isLocal(req)) return sendHtml(res, 403, '<h1>403</h1><p>This page can only be opened on the server computer.</p>');
  const orders = readJson(ORDERS_FILE).slice().reverse();
  const rows = orders.map((o) => `<tr>
    <td>${escapeHtml(o.id)}</td><td>${escapeHtml(new Date(o.receivedAt).toLocaleString())}</td>
    <td>${escapeHtml(o.name)}</td><td>${escapeHtml(o.phone)}</td><td>${escapeHtml(o.email)}</td>
    <td>${escapeHtml(o.category)}</td><td>${escapeHtml(o.expectedDate || '-')}</td>
    <td>${escapeHtml(o.payment)}</td><td>${escapeHtml(o.feedback || '-')}</td></tr>`).join('');
  sendHtml(res, 200, `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Craft.co | Orders received</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;background:#fbdff0;color:#1a1a1a;margin:0;padding:30px}
table{border-collapse:collapse;background:#fff;width:100%;font-size:.9rem}th,td{border:1px solid #bbb;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f6d3ea}.wrap{overflow-x:auto}</style></head><body>
<h1>Orders received (${orders.length})</h1><p><a href="/">Back to the website</a></p>
<div class="wrap"><table><thead><tr><th>ID</th><th>Received</th><th>Name</th><th>Phone</th><th>Email</th><th>Category</th><th>Expected</th><th>Payment</th><th>Feedback</th></tr></thead>
<tbody>${rows || '<tr><td colspan="9">No orders yet.</td></tr>'}</tbody></table></div></body></html>`);
}

/* ---------------- Static files (the website) ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, route) {
  let rel;
  try {
    rel = decodeURIComponent(route);
  } catch (err) {
    return sendHtml(res, 400, '<h1>400</h1><p>Bad request.</p>');
  }
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  // Stop requests like /../server-site.js from leaving the public folder
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendHtml(res, 403, '<h1>403</h1><p>Forbidden.</p>');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return sendHtml(res, 404, `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Not found</title></head>
<body style="font-family:Segoe UI,Arial,sans-serif;background:#fbdff0;text-align:center;padding:80px 20px">
<h1>404: Page not found</h1><p>We could not find that page.</p><p><a href="/">Back to the home page</a></p></body></html>`);
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, ...SECURITY_HEADERS });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

/* ---------------- The server ---------------- */
const server = http.createServer(async (req, res) => {
  const route = req.url.split('?')[0];
  const started = Date.now();
  res.on('finish', () => console.log(`${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started} ms)`));

  try {
    if (route.startsWith('/api/')) return await handleApi(req, res, route);
    if (route === '/admin/orders') return adminOrdersPage(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD', ...SECURITY_HEADERS });
      return res.end('Method Not Allowed');
    }
    return serveStatic(req, res, route);
  } catch (err) {
    if (err && err.status) {
      if (err.close) {
        // Reply first, then drop the connection so nobody can keep streaming data at us
        res.setHeader('Connection', 'close');
        res.on('finish', () => req.destroy());
      }
      return sendJson(res, err.status, { ok: false, errors: [err.message] });
    }
    console.error('Unexpected error:', err);
    return sendJson(res, 500, { ok: false, errors: ['Something went wrong on the server.'] });
  }
});

server.listen(PORT, () => {
  console.log(`Craft.co server running at http://localhost:${PORT}`);
  console.log(`Orders received can be viewed at http://localhost:${PORT}/admin/orders`);
});
