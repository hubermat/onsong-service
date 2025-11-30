# Code Signing for OnSong Proxy Executables

Code signing authenticates executables and prevents security warnings on macOS and Windows.

## Overview

Currently, executables are **not code-signed** by default. Users will see security warnings:
- **macOS:** "Cannot be opened because the developer cannot be verified"
- **Windows:** Windows Defender SmartScreen warnings

Users can bypass these warnings, but code signing provides a better experience.

## Prerequisites

### macOS Code Signing

**Requirements:**
1. **Apple Developer Account** ($99/year)
   - Sign up at https://developer.apple.com/programs/

2. **Developer ID Application Certificate**
   - Generate in Apple Developer portal
   - Download and install in Keychain Access

3. **Notarization** (optional but recommended)
   - Requires Xcode Command Line Tools
   - Apple ID app-specific password

**Environment Variables:**
```bash
export MACOS_CERTIFICATE_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="your@email.com"
export APPLE_ID_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
```

### Windows Code Signing

**Requirements:**
1. **Code Signing Certificate**
   - Purchase from: DigiCert, Sectigo, GlobalSign, etc.
   - Cost: $100-$500/year
   - Requires business verification

2. **signtool** (part of Windows SDK)
   - Install Windows SDK on build server

**Environment Variables:**
```bash
export WINDOWS_CERTIFICATE_PATH="/path/to/certificate.pfx"
export WINDOWS_CERTIFICATE_PASSWORD="your-password"
```

## Implementation

### Option 1: Manual Code Signing (Recommended)

Sign executables after they're built but before distribution:

**macOS:**
```bash
# Sign the executable
codesign --sign "Developer ID Application: Your Name (TEAMID)" \
  --timestamp \
  --options runtime \
  --entitlements entitlements.plist \
  onsong-proxy

# Verify signature
codesign --verify --verbose onsong-proxy

# Notarize (optional)
ditto -c -k --keepParent onsong-proxy onsong-proxy.zip
xcrun notarytool submit onsong-proxy.zip \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_ID_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

# Staple notarization
xcrun stapler staple onsong-proxy
```

**Windows:**
```cmd
signtool sign /f certificate.pfx /p password /tr http://timestamp.digicert.com /td sha256 /fd sha256 onsong-proxy.exe
```

### Option 2: Automatic Code Signing

Add code signing to the build process in `server.js`:

```javascript
// After building with pkg, sign the executable
if (os === 'macos' && process.env.MACOS_CERTIFICATE_NAME) {
  await signMacOSExecutable(outputPath);
}

if (os === 'windows' && process.env.WINDOWS_CERTIFICATE_PATH) {
  await signWindowsExecutable(outputPath);
}
```

## macOS Entitlements

Create `entitlements.plist` for macOS hardened runtime:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.network.server</key>
    <true/>
</dict>
</plist>
```

## Build Server Setup

### Requirements

- **macOS signing requires a Mac** (or use a macOS CI service)
- Windows signing can be done on any platform with signtool
- Linux builds don't require code signing

### CI/CD Integration

**GitHub Actions Example:**

```yaml
name: Build and Sign

on:
  push:
    tags:
      - 'v*'

jobs:
  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3

      - name: Import Certificate
        run: |
          echo "${{ secrets.MACOS_CERTIFICATE }}" | base64 --decode > certificate.p12
          security create-keychain -p "" build.keychain
          security import certificate.p12 -k build.keychain -P "${{ secrets.MACOS_CERTIFICATE_PASSWORD }}" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "" build.keychain

      - name: Build
        run: npx pkg server.js --target node18-macos-x64

      - name: Sign
        run: |
          codesign --sign "${{ secrets.MACOS_CERTIFICATE_NAME }}" --timestamp --options runtime onsong-proxy

      - name: Notarize
        run: |
          ditto -c -k --keepParent onsong-proxy onsong-proxy.zip
          xcrun notarytool submit onsong-proxy.zip --apple-id "${{ secrets.APPLE_ID }}" --password "${{ secrets.APPLE_ID_PASSWORD }}" --team-id "${{ secrets.APPLE_TEAM_ID }}" --wait
          xcrun stapler staple onsong-proxy

  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3

      - name: Build
        run: npx pkg server.js --target node18-win-x64

      - name: Sign
        run: |
          echo "${{ secrets.WINDOWS_CERTIFICATE }}" | base64 --decode > certificate.pfx
          signtool sign /f certificate.pfx /p "${{ secrets.WINDOWS_CERTIFICATE_PASSWORD }}" /tr http://timestamp.digicert.com /td sha256 /fd sha256 onsong-proxy.exe
```

## Cost Analysis

| Item | Cost | Notes |
|------|------|-------|
| Apple Developer Account | $99/year | Required for macOS signing |
| Windows Code Signing Certificate | $100-500/year | From various providers |
| CI/CD for macOS builds | $0-50/month | GitHub Actions free for public repos |
| **Total** | ~$200-600/year | One-time setup, recurring annually |

## Alternative: Self-Service Signing

Instead of signing during build, provide instructions for organizations to:
1. Download unsigned executables
2. Sign with their own certificates
3. Distribute to their users

This avoids recurring costs and is suitable if each church/organization has IT staff.

## Recommendation

For initial deployment:
- **Start without code signing** - users can bypass warnings
- **Document the security warnings** in installation guide
- **Add code signing later** if needed based on user feedback

For production deployment:
- **Invest in code signing** if serving many non-technical users
- **Use a CI/CD pipeline** with GitHub Actions or similar
- **Store certificates securely** using secrets management
