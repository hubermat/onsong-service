# OnSong Service

Middle-layer service that routes requests between ChurchTools (in the browser) and onsong-proxy instances (on local networks). This service runs on a cloud VM with a public HTTPS endpoint.

## Overview

The OnSong Service:
- Accepts WebSocket connections from onsong-proxy instances
- Tracks active connections by ChurchTools URL and authentication secret
- Receives HTTPS API requests from ChurchTools
- Validates authentication and routes requests to appropriate proxy
- Returns responses from devices back to ChurchTools

## Architecture

```
ChurchTools (Browser)
    ↓ HTTPS (X-AUTH header)
onsong-service (Cloud VM) ← You are here
    ↓ WebSocket
onsong-proxy (Local Network)
    ↓ HTTP
OnSong Device (iPad/iPhone)
```

This architecture solves the mixed-content problem in browsers by ensuring all browser communication uses HTTPS.

## Prerequisites

- **Node.js** (v14 or higher)
- **SSL Certificate** from a trusted CA (Let's Encrypt recommended)
- A server/VM with:
  - Public IP address
  - Domain name pointing to the server
  - Ports 80, 443, and 8443 open

## Installation

1. Clone or upload the project to your server

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build pre-built proxy executables:
   ```bash
   npm run build-executables
   ```

   This creates executable files in the `builds/` directory for all platforms.
   This step only needs to be done once (or when proxy code changes).

4. Set up SSL certificates:

   **Option A: Let's Encrypt (Recommended for Production)**

   See [LETSENCRYPT.md](./LETSENCRYPT.md) for detailed instructions.

   **Option B: Self-Signed (Development/Testing Only)**
   ```bash
   npm run setup-cert
   ```

5. Configure server (optional):

   Set custom port via environment variable:
   ```bash
   export PORT=443
   ```

## Usage

### Starting the Service

```bash
npm start
```

Or with custom port:
```bash
PORT=443 npm start
```

**Example Output:**
```
========================================
OnSong Service Started
========================================
HTTPS Port: 8443
WebSocket: wss://your-domain:8443
========================================

Endpoints:
  GET  /health                - Health check
  GET  /discover              - Discover OnSong devices
  ALL  /api/*                 - Proxy API requests

Required Headers:
  X-AUTH    - Authentication secret
  ONSONGIP  - Target device IP (for /api)
  Referer   - ChurchTools URL
========================================
```

### Running as a System Service

For production, run as a systemd service:

Create `/etc/systemd/system/onsong-service.service`:
```ini
[Unit]
Description=OnSong Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/onsongService
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=443

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable onsong-service
sudo systemctl start onsong-service
sudo systemctl status onsong-service
```

View logs:
```bash
sudo journalctl -u onsong-service -f
```

## API Endpoints

### Health Check

**GET /health**

Check service status and see active connections.

**Response:**
```json
{
  "status": "ok",
  "connections": 2,
  "uptime": 3600.5
}
```

### Download Proxy Executable

**GET /download**

Generates and downloads a ZIP package containing the OnSong proxy with custom configuration.

**Query Parameters:**
- `os` (required): Target operating system - one of: `macos`, `linux`, `windows`
- `churchToolsUrl` (required): Your ChurchTools instance hostname (e.g., `mychurch.church.tools`)
- `secret` (required): Authentication secret for the proxy
- `location` (optional): Proxy location name (e.g., "Main Sanctuary", "Youth Room")
- `public` (optional): Set to `true` or `1` to make this a public proxy (skips secret check for /api and /discover)

**Example Request (macOS/Linux):**
```bash
curl "https://onsong.feg-karlsruhe.de:443/download?os=macos&churchToolsUrl=mychurch.church.tools&secret=my-secret-key&location=Main%20Sanctuary&public=false" \
  -o onsong-proxy-macos.zip

# Unzip the package
unzip onsong-proxy-macos.zip

# Install as a system service (recommended)
./onsong-proxy --install

# Or run manually
./onsong-proxy
```

**Windows Example:**
```bash
curl "https://onsong.feg-karlsruhe.de:443/download?os=windows&churchToolsUrl=mychurch.church.tools&secret=my-secret-key" \
  -o onsong-proxy-windows.zip

# Extract the ZIP file, then run as administrator:
onsong-proxy.exe --install

# Or run manually:
onsong-proxy.exe
```

**Package Contents:**
- `onsong-proxy` (or `onsong-proxy.exe` on Windows) - Standalone executable
- `config.json` - Configuration file with your parameters
- `INSTALL.md` - Platform-specific installation instructions

**Note:** The executable reads `config.json` at runtime. Keep both files in the same directory.

**Service Installation:**

The executable includes built-in service installation for automatic startup on system boot:

- **macOS:** Installs as launchd service in `~/Library/LaunchAgents/`
- **Windows:** Installs as scheduled task with SYSTEM privileges
- **Linux:** Installs as systemd service (requires sudo)

```bash
# Install as service (auto-start on boot)
./onsong-proxy --install

# Uninstall service
./onsong-proxy --uninstall
```

**Important Notes:**

- **macOS Security:** You may see "Cannot be opened because the developer cannot be verified." Go to System Settings → Privacy & Security → Allow Anyway. See [CODE_SIGNING.md](./CODE_SIGNING.md) for details.
- **Windows SmartScreen:** Click "More info" → "Run anyway" if Windows Defender blocks the executable.
- **User-Friendly:** Double-click the executable from Finder/Explorer - no terminal knowledge required!

**How It Works:**
1. Service receives request with OS, ChurchTools URL, secret, location, and public parameters
2. Generates unique UUID for this proxy instance
3. Copies pre-built executable from `builds/` directory (instant - no compilation!)
4. Generates `config.json` with user's parameters:
   - `serviceUrl`: Fixed to `wss://onsong.feg-karlsruhe.de:443`
   - `churchToolsUrl`: From query parameter
   - `secret`: From query parameter
   - `location`: From query parameter (optional)
   - `public`: From query parameter (optional)
   - `uuid`: Generated by service
5. Creates ZIP package with executable, config.json, and INSTALL.md
6. Streams ZIP file to client
7. Cleans up temporary directory

**Building Pre-built Executables:**

Before the service can generate downloads, you must build the executables once:

```bash
npm run build-executables
```

This creates three pre-built executables in the `builds/` directory:
- `onsong-proxy-macos` (macOS x64)
- `onsong-proxy-linux` (Linux x64)
- `onsong-proxy-windows.exe` (Windows x64)

Rebuild executables only when the proxy code changes.

**Features:**
- **Instant downloads** - no build process, just copy and package
- External config file (`config.json`) for easy customization
- Self-installing as system service
- Works on macOS, Linux, and Windows
- Automatic cleanup of build artifacts
- Concurrent downloads supported (unique temp directories)
- Includes user-friendly installation guide

**Download Times:**
- ~1-2 seconds (instant - just copying pre-built files)

**ZIP Package Contents:**
- Pre-built executable (50-70 MB)
- `config.json` (~200 bytes)
- `INSTALL.md` (installation guide)

### Device Discovery

**GET /discover**

Discover OnSong devices on the local network via connected proxy.

**Required Headers:**
- `X-AUTH`: Authentication secret (must match proxy)
- `Referer`: ChurchTools URL (e.g., `https://your-instance.church.tools`)

**Example Request:**
```bash
curl https://onsong.your-domain.com/discover \
  -H "X-AUTH: your-secret-key" \
  -H "Referer: https://your-instance.church.tools"
```

**Example Response:**
```json
{
  "success": true,
  "devices": [
    {
      "name": "Jason's iPad",
      "type": "http",
      "host": "jasons-ipad.local",
      "addresses": ["192.168.1.50"],
      "port": 8080,
      "txt": {
        "role": "server"
      }
    }
  ]
}
```

### API Proxy

**ALL /api/\***

Proxy any HTTP request to an OnSong device.

**Required Headers:**
- `X-AUTH`: Authentication secret
- `ONSONGIP`: Target device IP address
- `Referer`: ChurchTools URL

**Optional Headers:**
- `ONSONGPORT`: Target device port (default: 80)

**Example Request:**
```bash
curl https://onsong.your-domain.com/api/songs \
  -H "X-AUTH: your-secret-key" \
  -H "ONSONGIP: 192.168.1.50" \
  -H "Referer: https://your-instance.church.tools"
```

**Example POST Request:**
```bash
curl -X POST https://onsong.your-domain.com/api/setlist \
  -H "X-AUTH: your-secret-key" \
  -H "ONSONGIP: 192.168.1.50" \
  -H "Referer: https://your-instance.church.tools" \
  -H "Content-Type: application/json" \
  -d '{"name": "Sunday Service", "songs": [1, 2, 3]}'
```

## Authentication & Security

### Connection Registration

When onsong-proxy connects, it registers with:
```json
{
  "type": "register",
  "churchToolsUrl": "your-instance.church.tools",
  "secret": "your-secret-key",
  "proxyVersion": "2.0.0"
}
```

The service stores this mapping and uses it to route requests.

### Request Validation

For each ChurchTools request, the service:
1. Extracts ChurchTools URL from `Referer` header
2. Extracts secret from `X-AUTH` header
3. Looks up connection by ChurchTools URL
4. Verifies secret matches
5. Routes to proxy if validation passes
6. Returns 403 if validation fails

### Security Best Practices

- **Use Let's Encrypt**: Don't use self-signed certificates in production
- **Strong Secrets**: Use cryptographically random secrets (e.g., `openssl rand -hex 32`)
- **Firewall**: Only expose necessary ports (443 or 8443)
- **Updates**: Keep Node.js and dependencies up to date
- **Monitoring**: Monitor logs for suspicious activity
- **Rate Limiting**: Consider adding rate limiting for production (e.g., with nginx)

## WebSocket Protocol

### Messages from Proxy

**Register:**
```json
{
  "type": "register",
  "churchToolsUrl": "instance.church.tools",
  "secret": "secret-key",
  "proxyVersion": "2.0.0"
}
```

**Discovery Response:**
```json
{
  "type": "discover-response",
  "requestId": "req-123",
  "success": true,
  "devices": [...]
}
```

**API Response:**
```json
{
  "type": "api-response",
  "requestId": "req-124",
  "success": true,
  "statusCode": 200,
  "headers": {...},
  "data": {...}
}
```

### Messages to Proxy

**Discover Request:**
```json
{
  "type": "discover",
  "requestId": "req-123"
}
```

**API Request:**
```json
{
  "type": "api-request",
  "requestId": "req-124",
  "targetIp": "192.168.1.50",
  "targetPort": 80,
  "method": "GET",
  "path": "/api/songs",
  "headers": {...},
  "body": {...}
}
```

**Ping (Keep-Alive):**
```json
{
  "type": "ping"
}
```

## Monitoring

### Health Check

Monitor service health:
```bash
curl https://onsong.your-domain.com/health
```

Set up monitoring with tools like:
- UptimeRobot
- Pingdom
- Datadog
- Prometheus + Grafana

### Logs

View logs with journalctl:
```bash
# Follow logs in real-time
sudo journalctl -u onsong-service -f

# View last 100 lines
sudo journalctl -u onsong-service -n 100

# View logs for specific time
sudo journalctl -u onsong-service --since "1 hour ago"
```

### Connection Status

Check active connections via health endpoint:
```bash
watch -n 5 'curl -s https://onsong.your-domain.com/health | jq'
```

## Troubleshooting

### No Connections Showing

**Check:**
- onsong-proxy is running and configured correctly
- serviceUrl in proxy config.json matches this service
- Firewall allows WebSocket connections (port 443/8443)
- SSL certificate is valid

**Test WebSocket:**
```bash
# Install wscat
npm install -g wscat

# Connect to service
wscat -c wss://onsong.your-domain.com
```

### Authentication Failures

**Error:** `No proxy connected` or `403 Forbidden`

**Solutions:**
- Verify secret matches in proxy config.json
- Check referrer header is sent from ChurchTools
- Ensure churchToolsUrl in proxy matches referrer hostname exactly
- Restart proxy after config changes

### CORS Errors

**Error:** `CORS policy: No 'Access-Control-Allow-Origin' header is present`

**Causes:**
- Request origin not allowed by CORS policy
- Nginx not forwarding Origin header
- Service needs restart after code changes

**Solutions:**
1. Check the Origin header is being sent from browser
2. Verify nginx configuration forwards Origin and Referer headers:
   ```nginx
   proxy_set_header Origin $http_origin;
   proxy_set_header Referer $http_referer;
   ```
3. Restart onsong-service after updating CORS configuration
4. For development, temporarily test with curl to verify service works:
   ```bash
   curl https://onsong.your-domain.com/health \
     -H "Origin: https://test.church.tools"
   ```

**Allowed Origins:**
- All `*.church.tools` domains
- `localhost` and `127.0.0.1`
- `*.test` domains

To add more origins, edit the CORS middleware in server.js (line 32-55).

### Timeouts

**Error:** `Gateway timeout` (504)

**Causes:**
- Proxy is not responding
- Device is unreachable
- Network issues

**Solutions:**
- Check proxy logs
- Verify device is on local network
- Increase timeout in server.js (default: 30s)

### SSL Certificate Errors

**Error:** `SSL certificate problem`

**Solutions:**
- Use certificates from trusted CA (Let's Encrypt)
- Ensure certificate chain is complete (fullchain.pem)
- Check certificate expiration
- Verify domain name matches certificate CN

## Deployment

### Using Docker (Optional)

Create `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 8443
CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t onsong-service .
docker run -d \
  -p 8443:8443 \
  -v /etc/letsencrypt:/etc/letsencrypt:ro \
  --name onsong-service \
  onsong-service
```

### Reverse Proxy with Nginx

If you prefer running Node.js as non-root, use Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name onsong.your-domain.com;

    ssl_certificate /etc/letsencrypt/live/onsong.your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/onsong.your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Origin $http_origin;
        proxy_set_header Referer $http_referer;
    }
}
```

Then run service on port 8443 as non-root user.

**Note:** The service now runs HTTP internally and nginx handles SSL termination. CORS is enabled for:
- All `*.church.tools` domains
- `localhost` and `127.0.0.1` (for testing)
- `*.test` domains (for testing)

## Performance

### Connection Limits

Default Node.js settings handle thousands of concurrent WebSocket connections. For very high load:

1. Increase file descriptor limit:
   ```bash
   ulimit -n 65536
   ```

2. Use cluster mode (multiple processes)
3. Consider load balancing across multiple instances

### Keep-Alive

The service sends ping messages every 30 seconds to keep connections alive. Adjust in server.js:
```javascript
setInterval(() => { ... }, 30000); // Change timeout here
```

## License

MIT
