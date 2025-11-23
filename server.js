const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');
const { URL } = require('url');

const PORT = process.env.PORT || 8443;
const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

// Check if certificates exist
if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
  console.error('SSL certificates not found!');
  console.error('Please run: npm run setup-cert');
  console.error('For production, use certificates from a trusted CA.');
  process.exit(1);
}

// Load SSL certificates
const sslOptions = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

// Create Express app
const app = express();
app.use(express.json());

// Connection registry: Map of churchToolsUrl -> { secret, ws, requestHandlers }
const connections = new Map();

// Request ID counter
let requestIdCounter = 0;

// Get ChurchTools hostname from referrer
function getChurchToolsUrl(referrer) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return url.hostname;
  } catch (error) {
    return null;
  }
}

// Find connection by ChurchTools URL and secret
function findConnection(churchToolsUrl, secret) {
  const conn = connections.get(churchToolsUrl);
  if (!conn || conn.secret !== secret) {
    return null;
  }
  return conn;
}

// Send request to proxy and wait for response
function sendToProxy(conn, type, data, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const requestId = `req-${++requestIdCounter}`;

    const timeoutTimer = setTimeout(() => {
      delete conn.requestHandlers[requestId];
      reject(new Error('Request timeout'));
    }, timeout);

    conn.requestHandlers[requestId] = (response) => {
      clearTimeout(timeoutTimer);
      delete conn.requestHandlers[requestId];
      resolve(response);
    };

    conn.ws.send(JSON.stringify({
      type: type,
      requestId: requestId,
      ...data
    }));
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connections: connections.size,
    uptime: process.uptime()
  });
});

// Discover endpoint
app.get('/discover', async (req, res) => {
  const referrer = req.headers['referer'] || req.headers['referrer'];
  const secret = req.headers['x-auth'];

  if (!secret) {
    return res.status(401).json({ error: 'Missing X-AUTH header' });
  }

  const churchToolsUrl = getChurchToolsUrl(referrer);
  if (!churchToolsUrl) {
    return res.status(400).json({ error: 'Invalid or missing referrer' });
  }

  const conn = findConnection(churchToolsUrl, secret);
  if (!conn) {
    return res.status(403).json({
      error: 'No proxy connected',
      message: 'No OnSong proxy is connected for this ChurchTools instance with the provided credentials'
    });
  }

  try {
    const response = await sendToProxy(conn, 'discover', {});

    if (response.success) {
      res.json({
        success: true,
        devices: response.devices
      });
    } else {
      res.status(500).json({
        error: 'Discovery failed',
        message: response.error
      });
    }
  } catch (error) {
    console.error('Discovery error:', error.message);
    res.status(504).json({
      error: 'Gateway timeout',
      message: error.message
    });
  }
});

// API proxy endpoint
app.all('/api/*', async (req, res) => {
  const referrer = req.headers['referer'] || req.headers['referrer'];
  const secret = req.headers['x-auth'];
  const targetIp = req.headers['onsongip'];

  if (!secret) {
    return res.status(401).json({ error: 'Missing X-AUTH header' });
  }

  if (!targetIp) {
    return res.status(400).json({ error: 'Missing ONSONGIP header' });
  }

  const churchToolsUrl = getChurchToolsUrl(referrer);
  if (!churchToolsUrl) {
    return res.status(400).json({ error: 'Invalid or missing referrer' });
  }

  const conn = findConnection(churchToolsUrl, secret);
  if (!conn) {
    return res.status(403).json({
      error: 'No proxy connected',
      message: 'No OnSong proxy is connected for this ChurchTools instance'
    });
  }

  try {
    // Forward headers (excluding proxy-specific ones)
    const forwardHeaders = { ...req.headers };
    delete forwardHeaders['x-auth'];
    delete forwardHeaders['onsongip'];
    delete forwardHeaders['host'];
    delete forwardHeaders['referer'];
    delete forwardHeaders['referrer'];

    const targetPort = req.headers['onsongport'] || 80;

    const response = await sendToProxy(conn, 'api-request', {
      targetIp: targetIp,
      targetPort: parseInt(targetPort, 10),
      method: req.method,
      path: req.url,
      headers: forwardHeaders,
      body: req.body
    });

    if (response.success) {
      // Forward response headers
      if (response.headers) {
        Object.keys(response.headers).forEach(key => {
          res.setHeader(key, response.headers[key]);
        });
      }

      res.status(response.statusCode || 200).json(response.data);
    } else {
      res.status(502).json({
        error: 'Bad Gateway',
        message: response.error
      });
    }
  } catch (error) {
    console.error('API proxy error:', error.message);
    res.status(504).json({
      error: 'Gateway timeout',
      message: error.message
    });
  }
});

// Create HTTPS server
const server = https.createServer(sslOptions, app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  let registeredUrl = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'register') {
        // Register proxy connection
        const { churchToolsUrl, secret, proxyVersion } = message;

        if (!churchToolsUrl || !secret) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Missing churchToolsUrl or secret'
          }));
          ws.close();
          return;
        }

        registeredUrl = churchToolsUrl;

        connections.set(churchToolsUrl, {
          secret: secret,
          ws: ws,
          requestHandlers: {},
          registeredAt: new Date(),
          proxyVersion: proxyVersion || 'unknown'
        });

        console.log(`Proxy registered: ${churchToolsUrl} (version: ${proxyVersion})`);
        console.log(`Active connections: ${connections.size}`);

        ws.send(JSON.stringify({
          type: 'registered',
          message: 'Successfully registered'
        }));
      } else if (message.type === 'discover-response' || message.type === 'api-response') {
        // Handle response from proxy
        if (registeredUrl) {
          const conn = connections.get(registeredUrl);
          if (conn && conn.requestHandlers[message.requestId]) {
            conn.requestHandlers[message.requestId](message);
          }
        }
      } else if (message.type === 'pong') {
        // Pong response to keep-alive ping
        console.log(`Pong received from ${registeredUrl}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error.message);
    }
  });

  ws.on('close', () => {
    if (registeredUrl) {
      console.log(`Proxy disconnected: ${registeredUrl}`);
      connections.delete(registeredUrl);
      console.log(`Active connections: ${connections.size}`);
    } else {
      console.log('Unregistered connection closed');
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
});

// Keep-alive ping every 30 seconds
setInterval(() => {
  connections.forEach((conn, url) => {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify({ type: 'ping' }));
    }
  });
}, 30000);

// Start server
server.listen(PORT, () => {
  console.log('\n========================================');
  console.log('OnSong Service Started');
  console.log('========================================');
  console.log(`HTTPS Port: ${PORT}`);
  console.log(`WebSocket: wss://your-domain:${PORT}`);
  console.log('========================================');
  console.log('\nEndpoints:');
  console.log('  GET  /health                - Health check');
  console.log('  GET  /discover              - Discover OnSong devices');
  console.log('  ALL  /api/*                 - Proxy API requests');
  console.log('\nRequired Headers:');
  console.log('  X-AUTH    - Authentication secret');
  console.log('  ONSONGIP  - Target device IP (for /api)');
  console.log('  Referer   - ChurchTools URL');
  console.log('========================================\n');
});

// Graceful shutdown
function shutdown() {
  console.log('\n\nShutting down service...');

  wss.clients.forEach((ws) => {
    ws.close();
  });

  server.close(() => {
    console.log('Service stopped.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
