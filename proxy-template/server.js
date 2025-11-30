const WebSocket = require('ws');
const axios = require('axios');
const os = require('os');
const { Bonjour } = require('bonjour-service');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Embedded configuration (replaced at build time)
const config = {
  serviceUrl: '__SERVICE_URL__',
  churchToolsUrl: '__CHURCHTOOLS_URL__',
  secret: '__SECRET__',
  location: '__LOCATION__',
  public: '__PUBLIC__' === 'true',
  uuid: '__UUID__',
  validateCertificate: false
};

// Validate configuration
if (!config.serviceUrl || !config.churchToolsUrl || !config.secret) {
  console.error('Invalid embedded configuration!');
  process.exit(1);
}

// Service installation functions
async function installService() {
  const platform = os.platform();
  const execPath = process.execPath;

  console.log('\n========================================');
  console.log('Installing OnSong Proxy as a Service');
  console.log('========================================\n');

  try {
    if (platform === 'darwin') {
      await installMacOSService(execPath);
    } else if (platform === 'win32') {
      await installWindowsService(execPath);
    } else if (platform === 'linux') {
      await installLinuxService(execPath);
    } else {
      console.error(`Unsupported platform: ${platform}`);
      process.exit(1);
    }
    console.log('\n✓ Service installed successfully!');
    console.log('✓ The proxy will start automatically on system boot.\n');
  } catch (error) {
    console.error('\n✗ Service installation failed:', error.message);
    console.error('\nPlease run with administrator/root privileges.\n');
    process.exit(1);
  }
}

async function uninstallService() {
  const platform = os.platform();

  console.log('\n========================================');
  console.log('Uninstalling OnSong Proxy Service');
  console.log('========================================\n');

  try {
    if (platform === 'darwin') {
      await uninstallMacOSService();
    } else if (platform === 'win32') {
      await uninstallWindowsService();
    } else if (platform === 'linux') {
      await uninstallLinuxService();
    }
    console.log('\n✓ Service uninstalled successfully!\n');
  } catch (error) {
    console.error('\n✗ Service uninstallation failed:', error.message);
    process.exit(1);
  }
}

// macOS service installation
async function installMacOSService(execPath) {
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents/com.onsong.proxy.plist');
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.onsong.proxy</string>
    <key>ProgramArguments</key>
    <array>
        <string>${execPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${os.homedir()}/Library/Logs/onsong-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>${os.homedir()}/Library/Logs/onsong-proxy-error.log</string>
</dict>
</plist>`;

  // Ensure LaunchAgents directory exists
  const launchAgentsDir = path.dirname(plistPath);
  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  // Write plist file
  fs.writeFileSync(plistPath, plist);
  console.log(`✓ Created launchd plist: ${plistPath}`);

  // Load the service
  await execAsync(`launchctl load ${plistPath}`);
  console.log('✓ Service loaded with launchctl');
}

async function uninstallMacOSService() {
  const plistPath = path.join(os.homedir(), 'Library/LaunchAgents/com.onsong.proxy.plist');

  if (fs.existsSync(plistPath)) {
    try {
      await execAsync(`launchctl unload ${plistPath}`);
      console.log('✓ Service unloaded from launchctl');
    } catch (error) {
      // May fail if not loaded, that's okay
    }
    fs.unlinkSync(plistPath);
    console.log('✓ Removed launchd plist');
  } else {
    console.log('Service not installed');
  }
}

// Windows service installation
async function installWindowsService(execPath) {
  const serviceName = 'OnSongProxy';
  const displayName = 'OnSong Proxy Service';

  // Create a VBS script to run the executable
  const vbsPath = path.join(os.tmpdir(), 'install-onsong-proxy.vbs');
  const vbsScript = `Set objShell = CreateObject("WScript.Shell")
objShell.Run "schtasks /create /tn ""${serviceName}"" /tr ""\"${execPath}\"""" /sc onstart /ru SYSTEM /f", 0, True`;

  fs.writeFileSync(vbsPath, vbsScript);

  // Use Task Scheduler to create a startup task
  const command = `schtasks /create /tn "${serviceName}" /tr "\\"${execPath}\\"" /sc onstart /ru SYSTEM /rl highest /f`;

  await execAsync(command);
  console.log(`✓ Created Windows scheduled task: ${serviceName}`);
  console.log('✓ Task will run at system startup');

  // Start the task immediately
  try {
    await execAsync(`schtasks /run /tn "${serviceName}"`);
    console.log('✓ Service started');
  } catch (error) {
    console.log('Note: Service will start on next boot');
  }
}

async function uninstallWindowsService() {
  const serviceName = 'OnSongProxy';

  try {
    await execAsync(`schtasks /delete /tn "${serviceName}" /f`);
    console.log(`✓ Removed Windows scheduled task: ${serviceName}`);
  } catch (error) {
    if (error.message.includes('cannot find')) {
      console.log('Service not installed');
    } else {
      throw error;
    }
  }
}

// Linux service installation
async function installLinuxService(execPath) {
  const servicePath = '/etc/systemd/system/onsong-proxy.service';
  const serviceContent = `[Unit]
Description=OnSong Proxy Service
After=network.target

[Service]
Type=simple
ExecStart=${execPath}
Restart=always
RestartSec=10
User=${os.userInfo().username}

[Install]
WantedBy=multi-user.target`;

  fs.writeFileSync(servicePath, serviceContent);
  console.log(`✓ Created systemd service: ${servicePath}`);

  await execAsync('systemctl daemon-reload');
  console.log('✓ Reloaded systemd');

  await execAsync('systemctl enable onsong-proxy');
  console.log('✓ Enabled service');

  await execAsync('systemctl start onsong-proxy');
  console.log('✓ Service started');
}

async function uninstallLinuxService() {
  const servicePath = '/etc/systemd/system/onsong-proxy.service';

  try {
    await execAsync('systemctl stop onsong-proxy');
    console.log('✓ Service stopped');
  } catch (error) {
    // May fail if not running
  }

  try {
    await execAsync('systemctl disable onsong-proxy');
    console.log('✓ Service disabled');
  } catch (error) {
    // May fail if not enabled
  }

  if (fs.existsSync(servicePath)) {
    fs.unlinkSync(servicePath);
    console.log('✓ Removed systemd service');
    await execAsync('systemctl daemon-reload');
  } else {
    console.log('Service not installed');
  }
}

// Check command line arguments
const args = process.argv.slice(2);
if (args.includes('--install')) {
  installService().then(() => process.exit(0));
  return;
}

if (args.includes('--uninstall')) {
  uninstallService().then(() => process.exit(0));
  return;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
OnSong Proxy - Standalone Service

Usage:
  onsong-proxy              Run the proxy (for testing or manual mode)
  onsong-proxy --install    Install as a system service (requires admin/root)
  onsong-proxy --uninstall  Uninstall the service
  onsong-proxy --help       Show this help message

After installation, the proxy will start automatically on system boot.
`);
  process.exit(0);
}

// Initialize Bonjour for device discovery
const bonjour = new Bonjour();
let ws = null;
let reconnectTimer = null;
let isConnected = false;

// Watchdog timer for connection health monitoring
let lastPingTime = null;
let watchdogTimer = null;
const PING_TIMEOUT_MS = 70000; // 70 seconds

// Device registry for continuous monitoring
const deviceRegistry = new Map(); // Map<deviceId, device>
const deviceRemovalTimers = new Map(); // Map<deviceId, timeoutId>
let browser = null;

// Automatic request state tracking (auth retry and ping keepalive)
// Map<stateKey, { deviceId, authToken, deviceIp, devicePort, state, intervalTimer, timeoutTimer, startTime }>
const autoRequestStates = new Map();
const AUTO_REQUEST_INTERVAL_MS = 2000; // 2 seconds
const AUTO_REQUEST_DURATION_MS = 60000; // 60 seconds (1 minute)

// Get local IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Generate unique device ID
function getDeviceId(service) {
    if (!service.txt || !service.txt.deviceid) {
        return 'unknown-device';
    }
    return service.txt.deviceid;
  //return `${service.name}-${service.host}-${service.port}`;
}

// Start continuous Bonjour monitoring
function startDeviceMonitoring() {
  if (browser) {
    console.log('Device monitoring already running');
    return;
  }

  console.log('Starting continuous device monitoring...');
  browser = bonjour.find({});

  browser.on('up', (service) => {
    // Filter: Only include devices with role=server or role=client in TXT record
    const txt = service.txt || {};
    if (txt.role !== 'server' && txt.role !== 'client') {
      return;
    }
    if (!txt.deviceid) {
        return;
    }

    const deviceId = getDeviceId(service);

    // Cancel removal timer if device came back online
    if (deviceRemovalTimers.has(deviceId)) {
      console.log(`Device came back online: ${service.name} (canceling removal)`);
      clearTimeout(deviceRemovalTimers.get(deviceId));
      deviceRemovalTimers.delete(deviceId);
    }

    // Add or update device in registry
    const device = {
      name: service.name,
      type: service.type,
      host: service.host,
      addresses: service.addresses || [],
      port: service.port,
      txt: txt
    };

    const isNew = !deviceRegistry.has(deviceId);
    // check if there is an IPV4 address, sometimes bonjour reports no addresses when device comes back
    const ipv4Address = device.addresses.find(addr => !addr.includes(':'));
    if (isNew || ipv4Address) {
        deviceRegistry.set(deviceId, device);
        const action = isNew ? 'discovered' : 'updated';
        console.log(`Device ${action}: ${device.name} at ${device.addresses.join(', ')}:${device.port}`);
        console.log(`Total devices: ${deviceRegistry.size}`);
    }
  });

  browser.on('down', (service) => {
    const deviceId = getDeviceId(service);

    if (!deviceRegistry.has(deviceId)) {
      return;
    }

    console.log(`Device went down: ${service.name} (will remove in 10 minutes if not back online)`);

    // Set timer to remove device after 10 seconds
    const timerId = setTimeout(() => {
      if (deviceRegistry.has(deviceId)) {
        const device = deviceRegistry.get(deviceId);
        deviceRegistry.delete(deviceId);
        deviceRemovalTimers.delete(deviceId);
        console.log(`Device removed: ${device.name}`);
        console.log(`Total devices: ${deviceRegistry.size}`);
      }
    }, 1000 * 600); // 10 minutes

    deviceRemovalTimers.set(deviceId, timerId);
  });

  console.log('Device monitoring started');
}

// Stop continuous Bonjour monitoring
function stopDeviceMonitoring() {
  if (browser) {
    browser.stop();
    browser = null;
    console.log('Device monitoring stopped');
  }

  // Clear all removal timers
  deviceRemovalTimers.forEach(timerId => clearTimeout(timerId));
  deviceRemovalTimers.clear();
}

// Get current list of devices
function getDiscoveredDevices() {
  return Array.from(deviceRegistry.values());
}

// Start watchdog timer to monitor connection health
function startWatchdog() {
  // Clear any existing watchdog
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
  }

  lastPingTime = Date.now();

  // Check every 10 seconds if we've received a ping
  watchdogTimer = setInterval(() => {
    const timeSinceLastPing = Date.now() - lastPingTime;

    if (timeSinceLastPing > PING_TIMEOUT_MS) {
      console.error(`Connection watchdog triggered: No ping received for ${Math.floor(timeSinceLastPing / 1000)} seconds`);
      console.log('Tearing down connection and reconnecting...');

      // Stop watchdog
      stopWatchdog();

      // Close current connection
      if (ws) {
        ws.terminate(); // Force close without waiting
        ws = null;
      }

      isConnected = false;

      // Reconnect after 1 second
      setTimeout(() => {
        connect();
      }, 1000);
    }
  }, 10000); // Check every 10 seconds

  console.log('Connection watchdog started (70 second timeout)');
}

// Stop watchdog timer
function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  lastPingTime = null;
}

// Reset watchdog timer (called when ping received)
function resetWatchdog() {
  lastPingTime = Date.now();
}

// Generate state key for auto-request tracking
function getAutoRequestStateKey(deviceId, authToken) {
  return `${deviceId}:${authToken}`;
}

// Clean up auto-request timers and state
function cleanupAutoRequests(stateKey) {
  const state = autoRequestStates.get(stateKey);
  if (!state) return;

  if (state.intervalTimer) {
    clearInterval(state.intervalTimer);
  }
  if (state.timeoutTimer) {
    clearTimeout(state.timeoutTimer);
  }

  autoRequestStates.delete(stateKey);
  console.log(`Cleaned up auto-requests for ${stateKey}`);
}

// Start automatic auth retry requests
function startAuthRetry(deviceId, authToken, deviceIp, devicePort, method, body) {
  const stateKey = getAutoRequestStateKey(deviceId, authToken);

  // Clean up any existing state for this device/token
  cleanupAutoRequests(stateKey);

  console.log(`Starting auth retry for device ${deviceId} (${deviceIp}:${devicePort})`);

  const state = {
    deviceId: deviceId,
    authToken: authToken,
    deviceIp: deviceIp,
    devicePort: devicePort,
    method: method,
    body: body,
    state: 'auth-retry',
    intervalTimer: null,
    timeoutTimer: null,
    startTime: Date.now()
  };

  // Make auth request every 2 seconds
  state.intervalTimer = setInterval(async () => {
    try {
      const url = `http://${deviceIp}:${devicePort}/api/${authToken}/auth`;
      console.log(`Auto auth retry: ${method} ${url}`);

      const response = await axios({
        method: method,
        url: url,
        data: body,
        headers: {
          'content-type': 'application/json'
        },
        timeout: 5000,
        validateStatus: () => true
      });

      if (response.status === 200) {
        console.log(`Auth successful for device ${deviceId}, switching to ping keepalive`);

        // Clean up auth retry
        if (state.intervalTimer) {
          clearInterval(state.intervalTimer);
        }
        if (state.timeoutTimer) {
          clearTimeout(state.timeoutTimer);
        }

        // Switch to ping keepalive
        startPingKeepalive(deviceId, authToken, deviceIp, devicePort);
      }
    } catch (error) {
      console.log(`Auth retry failed for device ${deviceId}: ${error.message}`);
    }
  }, AUTO_REQUEST_INTERVAL_MS);

  // Stop after 60 seconds
  state.timeoutTimer = setTimeout(() => {
    console.log(`Auth retry timeout for device ${deviceId} (60 seconds elapsed)`);
    cleanupAutoRequests(stateKey);
  }, AUTO_REQUEST_DURATION_MS);

  autoRequestStates.set(stateKey, state);
}

// Start automatic ping keepalive requests
function startPingKeepalive(deviceId, authToken, deviceIp, devicePort) {
  const stateKey = getAutoRequestStateKey(deviceId, authToken);

  // Clean up any existing state for this device/token
  cleanupAutoRequests(stateKey);

  console.log(`Starting ping keepalive for device ${deviceId} (${deviceIp}:${devicePort})`);

  const state = {
    deviceId: deviceId,
    authToken: authToken,
    deviceIp: deviceIp,
    devicePort: devicePort,
    state: 'ping-keepalive',
    intervalTimer: null,
    timeoutTimer: null,
    startTime: Date.now()
  };

  // Make ping request every 2 seconds
  state.intervalTimer = setInterval(async () => {
    try {
      const url = `http://${deviceIp}:${devicePort}/api/${authToken}/ping?keepalive=60`;
      console.log(`Auto ping keepalive: ${url}`);

      await axios({
        method: 'GET',
        url: url,
        timeout: 5000,
        validateStatus: () => true
      });
    } catch (error) {
      console.log(`Ping keepalive failed for device ${deviceId}: ${error.message}`);
    }
  }, AUTO_REQUEST_INTERVAL_MS);

  // Stop after 60 seconds
  state.timeoutTimer = setTimeout(() => {
    console.log(`Ping keepalive timeout for device ${deviceId} (60 seconds elapsed)`);
    cleanupAutoRequests(stateKey);
  }, AUTO_REQUEST_DURATION_MS);

  autoRequestStates.set(stateKey, state);
}

// Stop auto-requests for a specific device/token
function stopAutoRequests(deviceId, authToken) {
  const stateKey = getAutoRequestStateKey(deviceId, authToken);
  cleanupAutoRequests(stateKey);
}

// Make HTTP request to local OnSong device
async function makeDeviceRequest(targetIp, targetPort, method, path, headers, body) {
  try {
    const url = `http://${targetIp}:${targetPort}${path}`;
    console.log(`Making ${method} request to device: ${url}`);

    headers = {
        'content-type': 'application/json'
    };
    if (path.endsWith('/content')) {
        headers['content-type'] = 'application/text';
        body = body.content;
    }

    const response = await axios({
      method: method,
      url: url,
      headers: headers,
      data: body,
      timeout: 30000,
      validateStatus: () => true // Accept any status code
    });

    return {
      success: true,
      statusCode: response.status,
      headers: response.headers,
      data: response.data
    };
  } catch (error) {
    console.error(`Device request error: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Handle incoming WebSocket messages
async function handleMessage(data) {
  try {
    const message = JSON.parse(data);
    console.log(`Received message ${message.requestId}, type: ${message.type}`);

    if (message.type === 'discover') {
      // Handle device discovery request - return current device list
      const devices = getDiscoveredDevices();

      ws.send(JSON.stringify({
        type: 'discover-response',
        requestId: message.requestId,
        success: true,
        devices: devices
      }));

      console.log(`Sent discovery response with ${devices.length} device(s)`);
    } else if (message.type === 'api-request') {
      // Handle API request to device
      const { targetIp, targetPort = 80, method, path, headers = {}, body } = message;

      if (!targetIp) {
        ws.send(JSON.stringify({
          type: 'api-response',
          requestId: message.requestId,
          success: false,
          error: 'Missing targetIp'
        }));
        return;
      }

      const result = await makeDeviceRequest(targetIp, targetPort, method, path, headers, body);

      // Check if this is an auth request and handle auto-retry/keepalive
      const authMatch = path.match(/^\/api\/([^\/]+)\/auth$/);
      if (authMatch) {
        const authToken = authMatch[1];

        // Find deviceId from targetIp
        let deviceId = null;
        for (const [id, device] of deviceRegistry.entries()) {
          if (device.addresses.includes(targetIp)) {
            deviceId = id;
            break;
          }
        }

        if (deviceId) {
          if (!result.success || result.statusCode >= 400) {
            // Auth request failed - start automatic retry with original method and body
            console.log(`Auth request failed (status ${result.statusCode || 'error'}), starting auto-retry`);
            startAuthRetry(deviceId, authToken, targetIp, targetPort, method, body);
          } else if (result.statusCode === 200) {
            // Auth request succeeded - start ping keepalive
            console.log(`Auth request succeeded, starting ping keepalive`);
            startPingKeepalive(deviceId, authToken, targetIp, targetPort);
          }
        } else {
          console.log(`Could not find deviceId for IP ${targetIp}, skipping auto-requests`);
        }
      }

      ws.send(JSON.stringify({
        type: 'api-response',
        requestId: message.requestId,
        ...result
      }));

      console.log(`Sent API response for request ${message.requestId}, status ${result.statusCode || 'error'}`);
    } else if (message.type === 'ping') {
      // Respond to ping to keep connection alive
      ws.send(JSON.stringify({ type: 'pong' }));

      // Reset watchdog timer
      resetWatchdog();
    }
  } catch (error) {
    console.error('Error handling message:', error.message);
  }
}

// Connect to onsong-service
function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  console.log(`Connecting to onsong-service: ${config.serviceUrl}`);

  // WebSocket options
  const wsOptions = {};

  // Allow self-signed certificates if configured (for development)
  // In production with Let's Encrypt, set validateCertificate: true in config.json
  if (config.validateCertificate === false) {
    wsOptions.rejectUnauthorized = false;
    console.log('Note: SSL certificate validation disabled (development mode)');
  } else if (config.validateCertificate === undefined) {
    // Default: allow self-signed for localhost/development
    wsOptions.rejectUnauthorized = false;
    console.log('Note: SSL certificate validation disabled by default (development mode)');
  }

  ws = new WebSocket(config.serviceUrl, wsOptions);

  ws.on('open', () => {
    console.log('Connected to onsong-service');
    isConnected = true;

    // Register with service
    ws.send(JSON.stringify({
      type: 'register',
      churchToolsUrl: config.churchToolsUrl,
      secret: config.secret,
      location: config.location,
      public: config.public,
      uuid: config.uuid,
      proxyVersion: '2.0.0'
    }));

    console.log(`Registered with ChurchTools URL: ${config.churchToolsUrl}`);

    // Clear reconnect timer
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Start watchdog timer to monitor connection health
    startWatchdog();
  });

  ws.on('message', (data) => {
    handleMessage(data);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });

  ws.on('close', () => {
    console.log('Disconnected from onsong-service');
    isConnected = false;
    ws = null;

    // Stop watchdog timer
    stopWatchdog();

    // Attempt reconnection after 5 seconds
    if (!reconnectTimer) {
      console.log('Reconnecting in 5 seconds...');
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 5000);
    }
  });
}

// Start the proxy
function start() {
  const localIp = getLocalIpAddress();

  console.log('\n========================================');
  console.log('OnSong Proxy Client Started');
  console.log('========================================');
  console.log(`Local IP Address: ${localIp}`);
  console.log(`Service URL: ${config.serviceUrl}`);
  console.log(`ChurchTools URL: ${config.churchToolsUrl}`);
  console.log('========================================\n');

  // Start continuous device monitoring
  startDeviceMonitoring();

  // Connect to onsong-service
  connect();
}

// Graceful shutdown
function shutdown() {
  console.log('\n\nShutting down proxy...');

  // Stop device monitoring
  stopDeviceMonitoring();

  // Stop watchdog timer
  stopWatchdog();

  // Clean up all auto-requests
  const stateKeys = Array.from(autoRequestStates.keys());
  for (const stateKey of stateKeys) {
    cleanupAutoRequests(stateKey);
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  if (ws) {
    ws.close();
  }

  bonjour.destroy();

  console.log('Proxy stopped.');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Start the application
start();
