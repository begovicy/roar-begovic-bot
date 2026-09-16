#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const roles = ['voucher', 'manager', 'main', 'economy', 'statistics', 'guard', 'moderation'];
const envFile = path.join(root, '.env');
const configFile = path.join(root, 'config.json');

function readEnvValue(name) {
  if (!existsSync(envFile)) return '';
  const content = readFileSync(envFile, 'utf8');
  const match = content.match(new RegExp(`^${name}=(.*)$`, 'm'));
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}

function requiredFromEnv() {
  const env = {};
  for (const role of roles) {
    const tokenName = `${role.toUpperCase()}_TOKEN`;
    env[tokenName] = readEnvValue(tokenName) || process.env[tokenName] || '';
  }
  env.GUILD_ID = readEnvValue('GUILD_ID') || process.env.GUILD_ID || '';
  env.MONGODB_URI =
    readEnvValue('MONGODB_URI') ||
    process.env.MONGODB_URI ||
    process.env.MONGO_URL ||
    process.env.MONGODB_URL ||
    '';
  return env;
}

function ensureRuntime() {
  const missing = [];
  for (const role of roles) {
    const token = readEnvValue(`${role.toUpperCase()}_TOKEN`) || process.env[`${role.toUpperCase()}_TOKEN`];
    if (!token) missing.push(`${role.toUpperCase()}_TOKEN`);
  }
  if (!readEnvValue('GUILD_ID') && !process.env.GUILD_ID) missing.push('GUILD_ID');
  if (!readEnvValue('MONGODB_URI') && !process.env.MONGODB_URI && !process.env.MONGO_URL && !process.env.MONGODB_URL) {
    missing.push('MONGODB_URI (or MONGO_URL / MONGODB_URL)');
  }
  if (missing.length) {
    console.error('[boot] Missing required environment values:');
    for (const item of missing) console.error(`  - ${item}`);
    console.error('[boot] Add them to .env or set them in the shell before running the bot.');
    process.exit(1);
  }

  if (!existsSync(configFile)) {
    console.warn('[boot] config.json not found; falling back to config.example.json');
  }
}

function startRole(role) {
  const child = spawn(process.execPath, ['src/app.mjs', role], {
    cwd: root,
    env: {
      ...process.env,
      ...requiredFromEnv(),
      NODE_ENV: process.env.NODE_ENV || 'production',
      UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE || '128',
    },
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    if (code !== 0 && !process.env.KEEP_RUNNING_ON_ERROR) {
      console.error(`[boot] ${role} exited with code ${code}`);
      process.exit(code ?? 1);
    }
  });

  return child;
}

function main() {
  ensureRuntime();
  const children = roles.map(startRole);
  const shutdown = (signal) => {
    console.log(`[boot] Received ${signal}; shutting down roles...`);
    for (const child of children) {
      if (!child.killed) child.kill('SIGTERM');
    }
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('exit', () => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGTERM');
    }
  });
  console.log('[boot] ROAR multi-bot launcher started.');
}

main();
