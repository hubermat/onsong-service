# Let's Encrypt SSL Certificate Setup

For production deployment, the onsong-service should use SSL certificates from Let's Encrypt instead of self-signed certificates.

## Prerequisites

- A domain name pointing to your server's IP address (e.g., `onsong.your-domain.com`)
- Port 80 and 443 accessible from the internet
- Root or sudo access on the server

## Installation

### Option 1: Using Certbot (Recommended)

1. Install Certbot:

   **Ubuntu/Debian:**
   ```bash
   sudo apt-get update
   sudo apt-get install certbot
   ```

   **CentOS/RHEL:**
   ```bash
   sudo yum install certbot
   ```

2. Obtain certificate (standalone mode):
   ```bash
   sudo certbot certonly --standalone -d onsong.your-domain.com
   ```

   This will:
   - Verify domain ownership
   - Generate certificates
   - Store them in `/etc/letsencrypt/live/onsong.your-domain.com/`

3. Update server.js to use Let's Encrypt certificates:

   Edit the certificate paths in `server.js`:
   ```javascript
   const keyPath = '/etc/letsencrypt/live/onsong.your-domain.com/privkey.pem';
   const certPath = '/etc/letsencrypt/live/onsong.your-domain.com/fullchain.pem';
   ```

4. Set up auto-renewal:
   ```bash
   sudo certbot renew --dry-run
   ```

   Add to crontab for automatic renewal:
   ```bash
   sudo crontab -e
   ```

   Add this line to renew twice daily:
   ```
   0 0,12 * * * certbot renew --quiet --post-hook "systemctl restart onsong-service"
   ```

### Option 2: Using acme.sh

1. Install acme.sh:
   ```bash
   curl https://get.acme.sh | sh
   source ~/.bashrc
   ```

2. Obtain certificate:
   ```bash
   acme.sh --issue -d onsong.your-domain.com --standalone
   ```

3. Install certificate to a specific location:
   ```bash
   acme.sh --install-cert -d onsong.your-domain.com \
     --key-file /path/to/onsongService/certs/key.pem \
     --fullchain-file /path/to/onsongService/certs/cert.pem \
     --reloadcmd "systemctl restart onsong-service"
   ```

## Running as a System Service (with Let's Encrypt)

Create a systemd service file to run onsong-service with proper permissions:

1. Create service file:
   ```bash
   sudo nano /etc/systemd/system/onsong-service.service
   ```

2. Add the following content:
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

3. Enable and start the service:
   ```bash
   sudo systemctl enable onsong-service
   sudo systemctl start onsong-service
   sudo systemctl status onsong-service
   ```

4. View logs:
   ```bash
   sudo journalctl -u onsong-service -f
   ```

## Firewall Configuration

Ensure ports 80, 443, and 8443 are open:

```bash
# UFW (Ubuntu)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8443/tcp

# firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --permanent --add-port=8443/tcp
sudo firewall-cmd --reload
```

## Verification

Test your SSL certificate:
```bash
curl -v https://onsong.your-domain.com/health
```

Or use online tools:
- https://www.ssllabs.com/ssltest/

## Troubleshooting

### Permission Denied Error

If Node.js can't read certificate files:
```bash
sudo chmod 644 /etc/letsencrypt/live/onsong.your-domain.com/privkey.pem
sudo chmod 644 /etc/letsencrypt/live/onsong.your-domain.com/fullchain.pem
```

Or run the service as root (in systemd service file).

### Certificate Renewal Failed

Check logs:
```bash
sudo certbot renew --dry-run
```

Ensure port 80 is available during renewal.

## Alternative: Reverse Proxy with Nginx

If you prefer not to run Node.js as root, use Nginx as a reverse proxy:

1. Install Nginx:
   ```bash
   sudo apt-get install nginx
   ```

2. Configure Nginx:
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

3. Run onsong-service on port 8443 (non-privileged):
   ```bash
   PORT=8443 node server.js
   ```

This approach keeps Node.js running as a non-root user while Nginx handles SSL termination.
