# OnSong Proxy Installation Guide

Thank you for downloading the OnSong Proxy!

This proxy enables communication between ChurchTools and your OnSong devices on the local network.

## Installation Instructions

### macOS

1. **Open Terminal** (Applications → Utilities → Terminal)

2. **Navigate to the download folder:**
   ```bash
   cd ~/Downloads
   ```

3. **Make the file executable:**
   ```bash
   chmod +x onsong-proxy
   ```

4. **Install the service:**
   ```bash
   ./onsong-proxy --install
   ```

5. **Grant permissions:**
   - If you see a security warning, go to System Settings → Privacy & Security
   - Click "Allow Anyway" next to the blocked app warning
   - Run the install command again if needed

6. **Done!** The proxy is now installed and will start automatically on system boot.

**To uninstall:**
```bash
./onsong-proxy --uninstall
```

### Windows

1. **Right-click on `onsong-proxy.exe`** and select "Run as administrator"

2. **Install the service:**
   - Open Command Prompt as Administrator (search for "cmd", right-click, "Run as administrator")
   - Navigate to the download folder:
     ```
     cd %USERPROFILE%\Downloads
     ```
   - Run the installer:
     ```
     onsong-proxy.exe --install
     ```

3. **Grant permissions:**
   - If you see a SmartScreen warning, click "More info" then "Run anyway"
   - This is normal for unsigned executables

4. **Done!** The proxy is now installed as a scheduled task and will start automatically on system boot.

**To uninstall:**
```
onsong-proxy.exe --uninstall
```

(Run as administrator)

### Linux

1. **Open Terminal**

2. **Navigate to the download folder:**
   ```bash
   cd ~/Downloads
   ```

3. **Make the file executable:**
   ```bash
   chmod +x onsong-proxy
   ```

4. **Install the service (requires sudo):**
   ```bash
   sudo ./onsong-proxy --install
   ```

5. **Done!** The proxy is now installed as a systemd service and will start automatically on system boot.

**To uninstall:**
```bash
sudo ./onsong-proxy --uninstall
```

## Verification

After installation, the proxy should be running in the background. You can verify this by:

- **macOS:** Check `~/Library/Logs/onsong-proxy.log`
- **Windows:** Check Task Scheduler for "OnSongProxy" task
- **Linux:** Run `sudo systemctl status onsong-proxy`

## Troubleshooting

### macOS: "Cannot be opened because the developer cannot be verified"

This is because the executable is not code-signed with an Apple Developer certificate.

**Solution:**
1. Go to System Settings → Privacy & Security
2. Scroll down to see the blocked app
3. Click "Allow Anyway"
4. Try running the install command again
5. Click "Open" when prompted

### Windows: SmartScreen Warning

Windows Defender SmartScreen may block the executable because it's not code-signed.

**Solution:**
1. Click "More info" in the SmartScreen dialog
2. Click "Run anyway"

### General Issues

- **Installation fails:** Make sure you're running with administrator/root privileges
- **Proxy doesn't connect:** Check your firewall settings
- **Device discovery doesn't work:** Ensure devices are on the same network

## Support

For issues or questions, please contact your ChurchTools administrator.

## What This Proxy Does

- Connects to the OnSong service at `wss://onsong.feg-karlsruhe.de:443`
- Discovers OnSong devices on your local network using Bonjour/mDNS
- Enables ChurchTools to communicate with your local OnSong devices
- All communication is encrypted via WebSocket Secure (WSS)
- No data is stored or logged

## Privacy

This proxy:
- Only communicates with your configured ChurchTools instance
- Only accesses devices on your local network
- Does not collect or transmit any personal data
- All connections are encrypted
