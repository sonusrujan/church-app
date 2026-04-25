# Backup & Restoration Verification Guide

## RDS Configuration
- **Instance:** shalom-db (db.t3.medium)
- **Region:** ap-south-1
- **Retention:** 30 days automated backups
- **Engine:** PostgreSQL

## Automated Backups
AWS RDS takes daily automated snapshots during the configured backup window. Transaction logs are also retained for point-in-time recovery (PITR).

## Restoration Test Procedure

### 1. Restore to a Test Instance
```bash
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier shalom-db \
  --target-db-instance-identifier shalom-db-restore-test \
  --restore-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --db-instance-class db.t3.micro \
  --no-multi-az \
  --region ap-south-1
```

### 2. Verify Data Integrity
```bash
# Connect to restored instance
PGPASSWORD="$DB_PASSWORD" psql -h <restored-endpoint> -U shalomadmin -d shalomdb

# Check row counts on critical tables
SELECT 'users' AS tbl, count(*) FROM users
UNION ALL SELECT 'members', count(*) FROM members
UNION ALL SELECT 'churches', count(*) FROM churches
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'subscriptions', count(*) FROM subscriptions;

# Verify latest record timestamps
SELECT max(created_at) FROM users;
SELECT max(created_at) FROM payments;
```

### 3. Cleanup Test Instance
```bash
aws rds delete-db-instance \
  --db-instance-identifier shalom-db-restore-test \
  --skip-final-snapshot \
  --region ap-south-1
```

## Restoration Schedule
- **Quarterly:** Perform full restore test and document results
- **After major migrations:** Verify backup contains new schema

## Last Verified
- **Date:** _(fill after first test)_
- **Restored to:** _(instance identifier)_
- **Result:** _(pass/fail + notes)_
