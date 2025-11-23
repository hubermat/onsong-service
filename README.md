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

3. Set up SSL certificates:

   **Option A: Let's Encrypt (Recommended for Production)**

   See [LETSENCRYPT.md](./LETSENCRYPT.md) for detailed instructions.

   **Option B: Self-Signed (Development/Testing Only)**
   ```bash
   npm run setup-cert
   ```

4. Configure server (optional):

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
        proxy_pass https://localhost:8443;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then run service on port 8443 as non-root user.

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
