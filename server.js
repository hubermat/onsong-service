const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const WebSocket = require('ws');
const { URL } = require('url');
const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const archiver = require('archiver');

const execAsync = promisify(exec);

const PORT = process.env.PORT || 3001;
const SERVICE_URL = 'wss://onsong.feg-karlsruhe.de:443';

// Note: SSL certificates are optional when using nginx for SSL termination
// If you need HTTPS directly from Node.js, uncomment the certificate loading below
const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

// Uncomment for direct HTTPS (without nginx):
// if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
//   console.error('SSL certificates not found!');
//   console.error('Please run: npm run setup-cert');
//   process.exit(1);
// }
//
// const sslOptions = {
//   key: fs.readFileSync(keyPath),
//   cert: fs.readFileSync(certPath)
// };

// Create Express app
const app = express();
app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Allow requests from church.tools domains and localhost for testing
  if (origin) {
    if (origin.endsWith('.church.tools') ||
        origin.endsWith('.krz.tools') ||
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin.includes('.test')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AUTH, X-ID, ONSONGIP, ONSONGPORT');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
});

// Connection registry: Map of "churchToolsUrl:uuid" -> { churchToolsUrl, secret, uuid, location, public, ws, requestHandlers }
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

// Find and authenticate connection with UUID validation and optional secret check
function findAndAuthenticateConnection(churchToolsUrl, secret, uuid) {
  if (!uuid) {
    return { error: 'Missing UUID', status: 401 };
  }

  const connectionKey = `${churchToolsUrl}:${uuid}`;
  const conn = connections.get(connectionKey);

  if (!conn) {
    return { error: 'No proxy connected', status: 403 };
  }

  // Only check secret if proxy is not public
  if (!conn.public && conn.secret !== secret) {
    return { error: 'Invalid secret', status: 403 };
  }

  return { conn };
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

// Helper function to build proxy package (using pre-built executables)
async function buildProxyExecutable(os, churchToolsUrl, secret, location, isPublic, uuid) {
  const buildId = crypto.randomBytes(16).toString('hex');
  const tempDir = path.join(__dirname, 'downloads', buildId);
  const buildsDir = path.join(__dirname, 'builds');

  try {
    // Create temp directory
    await fs.promises.mkdir(tempDir, { recursive: true });
    console.log(`Created temp directory: ${tempDir}`);

    // Determine executable names
    const executableNames = {
      'macos': 'onsong-proxy-macos',
      'linux': 'onsong-proxy-linux',
      'windows': 'onsong-proxy-windows.exe'
    };

    const prebuiltName = executableNames[os];
    if (!prebuiltName) {
      throw new Error(`Unsupported OS: ${os}`);
    }

    const prebuiltPath = path.join(buildsDir, prebuiltName);

    // Check if pre-built executable exists
    if (!fs.existsSync(prebuiltPath)) {
      throw new Error(`Pre-built executable not found: ${prebuiltPath}. Please run 'npm run build-executables' first.`);
    }

    // Copy pre-built executable to temp directory
    const outputName = os === 'windows' ? 'onsong-proxy.exe' : 'onsong-proxy';
    const outputPath = path.join(tempDir, outputName);
    await fs.promises.copyFile(prebuiltPath, outputPath);
    console.log(`Copied pre-built executable: ${prebuiltName}`);

    // Make executable on Unix systems
    if (os !== 'windows') {
      await fs.promises.chmod(outputPath, 0o755);
    }

    // Generate config.json
    const configPath = path.join(tempDir, 'config.json');
    const config = {
      serviceUrl: SERVICE_URL,
      churchToolsUrl: churchToolsUrl,
      secret: secret,
      location: location,
      public: isPublic,
      uuid: uuid,
      validateCertificate: false
    };
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(`Generated config.json`);

    // Copy INSTALL.md if it exists
    const installMdSource = path.join(__dirname, 'proxy-template', 'INSTALL.md');
    if (fs.existsSync(installMdSource)) {
      const installMdDest = path.join(tempDir, 'INSTALL.md');
      await fs.promises.copyFile(installMdSource, installMdDest);
    }

    // Create ZIP file with executable, config.json, and INSTALL.md
    const zipName = os === 'windows' ? 'onsong-proxy-windows.zip' : `onsong-proxy-${os}.zip`;
    const zipPath = path.join(tempDir, zipName);

    console.log(`Creating ZIP package: ${zipPath}`);
    await createZipPackage(tempDir, zipPath);
    console.log(`ZIP package created`);

    return { buildId, zipPath, zipName };
  } catch (error) {
    // Clean up on error
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.error(`Error cleaning up ${tempDir}:`, cleanupError.message);
    }
    throw error;
  }
}

// Helper function to create ZIP package
function createZipPackage(tempDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`ZIP created: ${archive.pointer()} total bytes`);
      resolve();
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add all files from temp directory (except the ZIP itself)
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stat = fs.statSync(filePath);

      if (stat.isFile() && !file.endsWith('.zip')) {
        archive.file(filePath, { name: file });
        console.log(`  Added to ZIP: ${file}`);
      }
    }

    archive.finalize();
  });
}

// Helper function to cleanup build directory
async function cleanupBuild(buildId) {
  const tempDir = path.join(__dirname, 'downloads', buildId);
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    console.log(`Cleaned up temp directory: ${tempDir}`);
  } catch (error) {
    console.error(`Error cleaning up ${tempDir}:`, error.message);
  }
}

// Download endpoint
app.get('/download', async (req, res) => {
  const { os, churchToolsUrl, secret, location, public: publicParam } = req.query;

  // Validate parameters
  if (!os || !churchToolsUrl || !secret) {
    return res.status(400).json({
      error: 'Missing required parameters',
      message: 'Required query parameters: os (macos|linux|windows), churchToolsUrl, secret'
    });
  }

  if (!['macos', 'linux', 'windows'].includes(os)) {
    return res.status(400).json({
      error: 'Invalid OS',
      message: 'OS must be one of: macos, linux, windows'
    });
  }

  // Parse optional parameters with defaults
  const proxyLocation = location || '';
  const isPublic = publicParam === 'true' || publicParam === '1';

  // Generate UUID for this proxy instance
  const proxyUuid = crypto.randomUUID();

  console.log(`Building proxy executable for ${os}, ChurchTools: ${churchToolsUrl}, Location: ${proxyLocation}, Public: ${isPublic}, UUID: ${proxyUuid}`);

  try {
    const { buildId, zipPath, zipName } = await buildProxyExecutable(os, churchToolsUrl, secret, proxyLocation, isPublic, proxyUuid);

    // Set appropriate headers for ZIP file
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    // Stream the ZIP file
    const fileStream = fs.createReadStream(zipPath);

    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error streaming file' });
      }
    });

    fileStream.on('end', async () => {
      console.log(`File streamed successfully: ${zipName}`);
      // Clean up after streaming is complete
      await cleanupBuild(buildId);
    });

    fileStream.pipe(res);
  } catch (error) {
    console.error('Error building executable:', error);
    res.status(500).json({
      error: 'Build failed',
      message: error.message
    });
  }
});

// Proxy check endpoint - validates registration with full authentication (including secret for public proxies)
app.get('/proxycheck', async (req, res) => {
  const referrer = req.headers['referer'] || req.headers['referrer'];
  const secret = req.headers['x-auth'];
  const uuid = req.headers['x-id'];

  if (!uuid) {
    return res.status(401).json({ error: 'Missing X-ID header' });
  }

  if (!secret) {
    return res.status(401).json({ error: 'Missing X-AUTH header' });
  }

  const churchToolsUrl = getChurchToolsUrl(referrer);
  if (!churchToolsUrl) {
    return res.status(400).json({ error: 'Invalid or missing referrer' });
  }

  const connectionKey = `${churchToolsUrl}:${uuid}`;
  const conn = connections.get(connectionKey);

  // Check if connection exists and secret matches (always check secret for proxycheck)
  if (!conn || conn.secret !== secret) {
    return res.status(200).json({ registered: false });
  }

  return res.status(200).json({ registered: true });
});

// Discover endpoint
app.get('/discover', async (req, res) => {
  const referrer = req.headers['referer'] || req.headers['referrer'];
  const secret = req.headers['x-auth'];
  const uuid = req.headers['x-id'];

  if (!uuid) {
    return res.status(401).json({ error: 'Missing X-ID header' });
  }

  const churchToolsUrl = getChurchToolsUrl(referrer);
  if (!churchToolsUrl) {
    return res.status(400).json({ error: 'Invalid or missing referrer' });
  }

  const authResult = findAndAuthenticateConnection(churchToolsUrl, secret, uuid);
  if (authResult.error) {
    return res.status(authResult.status).json({
      error: authResult.error,
      message: authResult.error
    });
  }

  const conn = authResult.conn;

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
  const uuid = req.headers['x-id'];
  const targetIp = req.headers['onsongip'];

  if (!uuid) {
    return res.status(401).json({ error: 'Missing X-ID header' });
  }

  if (!targetIp) {
    return res.status(400).json({ error: 'Missing ONSONGIP header' });
  }

  const churchToolsUrl = getChurchToolsUrl(referrer);
  if (!churchToolsUrl) {
    return res.status(400).json({ error: 'Invalid or missing referrer' });
  }

  const authResult = findAndAuthenticateConnection(churchToolsUrl, secret, uuid);
  if (authResult.error) {
    return res.status(authResult.status).json({
      error: authResult.error,
      message: authResult.error
    });
  }

  const conn = authResult.conn;

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
//const server = https.createServer(sslOptions, app);
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  let registeredKey = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'register') {
        // Register proxy connection
        const { churchToolsUrl, secret, proxyVersion, uuid, location, public: isPublic } = message;

        if (!churchToolsUrl || !secret || !uuid) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Missing churchToolsUrl, secret, or uuid'
          }));
          ws.close();
          return;
        }

        registeredKey = `${churchToolsUrl}:${uuid}`;

        connections.set(registeredKey, {
          churchToolsUrl: churchToolsUrl,
          secret: secret,
          uuid: uuid,
          location: location || '',
          public: isPublic || false,
          ws: ws,
          requestHandlers: {},
          registeredAt: new Date(),
          proxyVersion: proxyVersion || 'unknown'
        });

        console.log(`Proxy registered: ${churchToolsUrl} (version: ${proxyVersion}, UUID: ${uuid}, location: ${location || 'none'}, public: ${isPublic || false})`);
        console.log(`Active connections: ${connections.size}`);

        ws.send(JSON.stringify({
          type: 'registered',
          message: 'Successfully registered'
        }));
      } else if (message.type === 'discover-response' || message.type === 'api-response') {
        // Handle response from proxy
        if (registeredKey) {
          const conn = connections.get(registeredKey);
          if (conn && conn.requestHandlers[message.requestId]) {
            conn.requestHandlers[message.requestId](message);
          }
        }
      } else if (message.type === 'pong') {
        // Pong response to keep-alive ping
        console.log(`Pong received from ${registeredKey}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error.message);
    }
  });

  ws.on('close', () => {
    if (registeredKey) {
      console.log(`Proxy disconnected: ${registeredKey}`);
      connections.delete(registeredKey);
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
  console.log(`HTTP Port: ${PORT} (SSL handled by nginx)`);
  console.log(`WebSocket: ws://localhost:${PORT} (proxied to wss:// by nginx)`);
  console.log('========================================');
  console.log('\nEndpoints:');
  console.log('  GET  /health                - Health check');
  console.log('  GET  /download              - Download proxy executable');
  console.log('  GET  /proxycheck            - Check if proxy is registered (always requires secret)');
  console.log('  GET  /discover              - Discover OnSong devices');
  console.log('  ALL  /api/*                 - Proxy API requests');
  console.log('\nRequired Headers:');
  console.log('  X-ID      - Proxy UUID (required for /proxycheck, /discover, and /api)');
  console.log('  X-AUTH    - Authentication secret');
  console.log('              - Always required for /proxycheck');
  console.log('              - Required for /discover and /api if proxy is not public');
  console.log('  ONSONGIP  - Target device IP (for /api)');
  console.log('  Referer   - ChurchTools URL');
  console.log('\nCORS Enabled for:');
  console.log('  *.church.tools domains');
  console.log('  *.krz.tools domains');
  console.log('  localhost/127.0.0.1 (testing)');
  console.log('  *.test domains (testing)');
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
