const http = require('http');

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html'
  });

  res.end(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Node.js Server</title>
    </head>
    <body>
      <h1>Welcome to Node.js!</h1>
      <p>This is a server-side application.</p>
      <p>Request URL: ${req.url}</p>
      <p>Request Method: ${req.method}</p>
    </body>
    </html>
  `);
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
