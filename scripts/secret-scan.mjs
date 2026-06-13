import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const distDir = new URL('../dist', import.meta.url).pathname;
const forbidden = [
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /POKOKIT_SESSION_SECRET/i,
  /JWT_SECRET/i,
  /DATABASE_URL/i,
  /sb_secret_/i,
  /service_role/i,
  /pokokit_session=/i,
  /refresh_token=/i,
];

if (!existsSync(distDir)) {
  console.error('dist directory is missing. Run build before secret-scan.');
  process.exit(1);
}

const files = listFiles(distDir);
const failures = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      failures.push(`${file}: ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error('Forbidden secret marker found in bundle:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Secret scan passed for ${files.length} built files.`);

function listFiles(dir) {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      result.push(...listFiles(path));
    } else {
      result.push(path);
    }
  }
  return result;
}
