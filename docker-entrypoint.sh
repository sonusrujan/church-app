#!/bin/sh
set -e

# Run pending migrations using the pg driver (no psql needed from non-root user)
echo "Running DB migrations..."
node -e "
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15000,
});

// Migrations that were applied before the tracking table existed
const LEGACY_MIGRATIONS = [
  '002_rls_and_audit_fixes.sql',
  '003_qa_audit_fixes.sql',
  '004_additional_qa_fixes.sql',
  '005_prayer_leadership_migration.sql',
  'family_request_migration.sql',
  'leadership_hierarchy_migration.sql',
  'phone_auth_migration.sql',
  'v2_comprehensive_upgrade.sql',
  '020_multi_church_junction.sql',
  '021_cross_tenant_security_fixes.sql',
];

(async () => {
  // Ensure migration tracking table exists
  await pool.query(\`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  \`);

  // Seed legacy migrations so they are skipped
  for (const name of LEGACY_MIGRATIONS) {
    await pool.query(
      'INSERT INTO _migrations (name) VALUES (\$1) ON CONFLICT DO NOTHING',
      [name]
    );
  }

  const dir = path.join(__dirname, 'db', 'migrations');
  if (!fs.existsSync(dir)) { console.log('No migrations directory'); process.exit(0); }

  // 7.5: Natural numeric sort so 002_ < 009_ < 010_ < 025_ regardless of suffix
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort((a, b) => {
    const na = parseInt(a.match(/^(\d+)/)?.[1] || '0', 10);
    const nb = parseInt(b.match(/^(\d+)/)?.[1] || '0', 10);
    return na !== nb ? na - nb : a.localeCompare(b);
  });
  const applied = await pool.query('SELECT name FROM _migrations');
  const appliedSet = new Set(applied.rows.map(r => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    console.log('Applying migration:', file);
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO _migrations (name) VALUES (\$1)', [file]);
    console.log('Applied:', file);
  }

  console.log('Migrations complete');
  await pool.end();
})().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
"

echo "Starting application..."
exec node dist/index.js
