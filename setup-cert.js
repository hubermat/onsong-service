const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const certDir = path.join(__dirname, 'certs');
const keyPath = path.join(certDir, 'key.pem');
const certPath = path.join(certDir, 'cert.pem');

// Create certs directory if it doesn't exist
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

// Check if certificates already exist
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('SSL certificates already exist in certs/ directory');
  process.exit(0);
}

console.log('Generating SSL certificate...');
console.log('Note: For production, use certificates from a trusted CA (Let\'s Encrypt, etc.)');

// Generate a certificate valid for 10 years
const opensslCommand = `openssl req -x509 -newkey rsa:4096 -keyout "${keyPath}" -out "${certPath}" -days 3650 -nodes -subj "/C=US/ST=State/L=City/O=OnSongService/CN=your-domain.example.com"`;

exec(opensslCommand, (error, stdout, stderr) => {
  if (error) {
    console.error('Error generating certificate:', error.message);
    console.error('\nPlease ensure OpenSSL is installed on your system:');
    console.error('  - Linux: sudo apt-get install openssl (Debian/Ubuntu)');
    console.error('  - Or use Let\'s Encrypt for production: https://letsencrypt.org/');
    process.exit(1);
  }

  if (stderr && stderr.includes('problems')) {
    console.error('Warning:', stderr);
  }

  console.log('SSL certificate generated successfully!');
  console.log(`  Private Key: ${keyPath}`);
  console.log(`  Certificate: ${certPath}`);
  console.log('\nIMPORTANT: For production use, replace these self-signed certificates');
  console.log('with certificates from a trusted Certificate Authority (e.g., Let\'s Encrypt).');
});
