const http = require('http');

const PORT = process.env.PORT || 3000;

// Request data is shown on the page, so special characters are escaped first
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title, heading, messages, req) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #fbdff0; color: #1a1a1a; margin: 0; }
    nav { display: flex; gap: 22px; padding: 18px 40px; font-weight: 600; }
    nav a { color: inherit; text-decoration: none; }
    nav a:hover { color: #c23b7a; }
    main { max-width: 640px; margin: 30px auto; padding: 0 20px; }
    h1 { font-size: 2.4rem; margin-bottom: 8px; }
    .meta { margin-top: 28px; padding: 14px 18px; background: #f6d3ea; border-radius: 10px; font-size: 0.95rem; }
  </style>
</head>
<body>
  <nav><strong>CRAFT.CO</strong><a href="/home">Home</a><a href="/about">About</a><a href="/api/products">Products (JSON)</a></nav>
  <main>
    <h1>${heading}</h1>
    ${messages.map((m) => `<p>${m}</p>`).join('\n    ')}
    <div class="meta">
      <div>Request URL: ${escapeHtml(req.url)}</div>
      <div>Request Method: ${escapeHtml(req.method)}</div>
    </div>
  </main>
</body>
</html>`;
}

const products = [
  { id: 'keychain', name: 'Crochet Keychain', price: 149 },
  { id: 'backpack', name: 'Crochet Backpack', price: 799 },
  { id: 'sweater', name: 'Handmade Sweater', price: 1299 },
  { id: 'bunny', name: 'Crochet Bunny Toy', price: 499 }
];

const server = http.createServer((req, res) => {
  let status = 200;
  let type = 'text/html; charset=utf-8';
  let body;

  // Ignore any ?query=string when choosing the route
  const route = req.url.split('?')[0];

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    status = 405;
    type = 'text/plain; charset=utf-8';
    body = 'Method Not Allowed';
  } else if (route === '/' || route === '/home') {
    body = page('Craft.co | Home', 'Welcome to Craft.co!', [
      'A store that is built by hands.',
      'Browse crochet keychains, backpacks, sweaters, bunny toys and customised photo frames.'
    ], req);
  } else if (route === '/about') {
    body = page('Craft.co | About', 'About Craft.co', [
      'Every piece at Craft.co is made by a person, one stitch at a time.',
      'Cannot find what you have in mind? Send us a reference image and we will make it your way.'
    ], req);
  } else if (route === '/api/products') {
    type = 'application/json; charset=utf-8';
    body = JSON.stringify(products, null, 2);
  } else {
    status = 404;
    body = page('Craft.co | Not Found', '404: Page not found', [
      'Sorry, we could not find the page you asked for.',
      '<a href="/home">Go back to the home page</a>'
    ], req);
  }

  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
  console.log(`${req.method} ${req.url} -> ${status}`);
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
