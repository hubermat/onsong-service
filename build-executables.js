#!/usr/bin/env node

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

const buildsDir = path.join(__dirname, 'builds');
const proxyTemplateDir = path.join(__dirname, 'proxy-template');

// Ensure builds directory exists
if (!fs.existsSync(buildsDir)) {
  fs.mkdirSync(buildsDir, { recursive: true });
  console.log(`Created builds directory: ${buildsDir}`);
}

const platforms = [
  { os: 'macos', target: 'node18-macos-x64', output: 'onsong-proxy-macos' },
  { os: 'linux', target: 'node18-linux-x64', output: 'onsong-proxy-linux' },
  { os: 'windows', target: 'node18-win-x64', output: 'onsong-proxy-windows.exe' }
];

async function buildExecutable(platform) {
  const { os, target, output } = platform;
  const outputPath = path.join(buildsDir, output);
  const distDir = path.join(proxyTemplateDir, 'dist');

  console.log(`\n========================================`);
  console.log(`Building executable for ${os}...`);
  console.log(`Target: ${target}`);
  console.log(`Output: ${outputPath}`);
  console.log(`========================================\n`);

  try {
    // Build executable using pkg on the bundled dist/index.js
    const pkgCommand = `npx pkg dist/index.js --target ${target} --output "${outputPath}"`;
    await execAsync(pkgCommand, {
      cwd: proxyTemplateDir,
      maxBuffer: 50 * 1024 * 1024
    });

    // Verify the executable was created
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Executable not found at ${outputPath}`);
    }

    // Make executable on Unix systems
    if (os !== 'windows') {
      await fs.promises.chmod(outputPath, 0o755);
    }

    const stats = fs.statSync(outputPath);
    console.log(`✓ Successfully built ${output} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
  } catch (error) {
    console.error(`✗ Failed to build ${os} executable:`, error.message);
    throw error;
  }
}

async function buildAll() {
  console.log('\n========================================');
  console.log('Building OnSong Proxy Executables');
  console.log('========================================');
  console.log(`Proxy template: ${proxyTemplateDir}`);
  console.log(`Output directory: ${buildsDir}`);

  const distDir = path.join(proxyTemplateDir, 'dist');

  try {
    // Install dependencies (including devDependencies for ncc)
    console.log('\nInstalling dependencies (including devDependencies)...');
    await execAsync('npm install', {
      cwd: proxyTemplateDir,
      maxBuffer: 50 * 1024 * 1024
    });
    console.log('✓ Dependencies installed.\n');

    // Bundle with ncc
    console.log('Bundling with @vercel/ncc...');
    await execAsync('npx ncc build server.js -o dist', {
      cwd: proxyTemplateDir,
      maxBuffer: 50 * 1024 * 1024
    });
    console.log('✓ Code bundled to dist/index.js\n');

    // Verify bundled file exists
    const bundledFile = path.join(distDir, 'index.js');
    if (!fs.existsSync(bundledFile)) {
      throw new Error('Bundled file not found: dist/index.js');
    }

    // Build each platform sequentially
    for (const platform of platforms) {
      await buildExecutable(platform);
    }

    // Clean up dist directory
    console.log('\nCleaning up dist directory...');
    await fs.promises.rm(distDir, { recursive: true, force: true });
    console.log('✓ Cleanup complete.');

    console.log('\n========================================');
    console.log('✓ All executables built successfully!');
    console.log('========================================\n');
    console.log('Pre-built executables are ready in the builds/ directory.');
    console.log('The service can now generate instant downloads.\n');
  } catch (error) {
    console.error('\n========================================');
    console.error('✗ Build process failed!');
    console.error('========================================\n');
    console.error(error.message);

    // Clean up dist directory on error
    const distDir = path.join(proxyTemplateDir, 'dist');
    if (fs.existsSync(distDir)) {
      await fs.promises.rm(distDir, { recursive: true, force: true });
    }

    process.exit(1);
  }
}

// Run the build process
buildAll();
