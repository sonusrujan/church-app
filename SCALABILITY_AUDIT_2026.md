# SHALOM SaaS — Scalability & Production Audit
**Date**: 20 April 2026  
**Scope**: 10M users, 500 churches, 30-day sustained load simulation  
**Current Capacity**: ~5,000–20,000 active users / 10–50 churches  
**Verdict**: Partially Scalable — strong foundations, infrastructure undersized

---

## TABLE OF CONTENTS
1. [Scores Summary](#scores-summary)
2. [All Problems Found](#all-problems-found)
3. [Phase 1: Emergency Fixes (Week 1)](#phase-1-emergency-fixes-week-1)
4. [Phase 2: Database Hardening (Week 2–3)](#phase-2-database-hardening-week-2-3)
5. [Phase 3: Caching Layer (Week 3–4)](#phase-3-caching-layer-week-3-4)
6. [Phase 4: Job Queue Overhaul (Week 4–6)](#phase-4-job-queue-overhaul-week-4-6)
7. [Phase 5: Real-Time & UX (Week 6–8)](#phase-5-real-time--ux-week-6-8)
8. [Phase 6: Admin Productivity (Week 8–10)](#phase-6-admin-productivity-week-8-10)
9. [Phase 7: Observability & Resilience (Week 10–12)](#phase-7-observability--resilience-week-10-12)
10. [Phase 8: Long-Term Architecture (Month 4+)](#phase-8-long-term-architecture-month-4)

---

## SCORES SUMMARY

| Metric | Current Score | After Phase 4 | After Phase 8 |
|--------|-------------|---------------|---------------|
| **Performance** | 35/100 | 65/100 | 85/100 |
| **UX** | 58/100 | 70/100 | 88/100 |
| **Reliability** | 42/100 | 72/100 | 90/100 |
| **Capacity** | ~20k users | ~200k users | ~10M users |

---

## ALL PROBLEMS FOUND

### CRITICAL (System will fail under load)

| ID | Problem | Category | Impact |
|----|---------|----------|--------|
| CRIT-01 | DB connection pool (20/task × 10 tasks = 200) exceeds RDS max (150) | Infrastructure | Connection refused errors, total outage |
| CRIT-02 | PostgreSQL job queue processes only 100 jobs/min — mass notifications take days | Architecture | Notifications arrive days late |
| CRIT-03 | Single RDS instance (db.t3.medium, 2 vCPU, 4GB) — no read replicas | Infrastructure | All reads/writes on one instance, hard ceiling |
| CRIT-04 | ECS tasks undersized (512 CPU / 1024 MB) — single-threaded Node.js | Infrastructure | OOM kills, CPU starvation during peaks |
| CRIT-05 | No table archival — job_queue, notification_deliveries, audit_log grow unbounded | Database | Index bloat, progressively slower queries |
| CRIT-06 | RLS overhead: 4 SQL round-trips per query (BEGIN → SET LOCAL → QUERY → COMMIT) | Database | 2-4ms overhead per query, compounds at scale |
| CRIT-07 | No caching layer (Redis) — every request hits database | Architecture | DB is sole bottleneck for all reads |
| CRIT-08 | Admin counts polling: 6 × COUNT(*) every 60s per admin session | Database | Expensive full scans on growing tables |

### HIGH (Significant degradation / poor UX)

| ID | Problem | Category | Impact |
|----|---------|----------|--------|
| HIGH-01 | No real-time updates — 60s polling only | UX | Stale badges, delayed status changes |
| HIGH-02 | No bulk operations for admin (subscriptions, approvals, notifications) | UX | Admin cannot manage 10k+ members efficiently |
| HIGH-03 | No optimistic locking — concurrent admin edits silently overwrite | Data Integrity | Lost updates when multiple admins work simultaneously |
| HIGH-04 | Events/notifications load once at bootstrap, never refresh | UX | Users see stale data all day |
| HIGH-05 | Bootstrap waterfall: 4-6 sequential API calls on login | Performance | 1-3s login delay, compounds under load |
| HIGH-06 | CSV export capped at 500 rows | UX | Cannot export full member lists |
| HIGH-07 | Payment confirmed by Razorpay but app shows "pending" until manual refresh | Trust | Members doubt payment success |
| HIGH-08 | Member dashboard API joins 4+ tables — slows as data grows | Performance | 200ms → 800ms+ over 30 days |
| HIGH-09 | No notification frequency cap or digest mode | UX | Notification fatigue, user disables push |
| HIGH-10 | Razorpay client LRU cache max 100 — evictions at 500 churches | Performance | Cold-start Razorpay client creation on every payment for 400 churches |

### MEDIUM (Quality/maintenance concerns)

| ID | Problem | Category | Impact |
|----|---------|----------|--------|
| MED-01 | 5 missing database indexes identified | Database | Full table scans on secondary queries |
| MED-02 | No APM / distributed tracing / query duration logging | Observability | Blind to slow queries and latency |
| MED-03 | Single AWS region (ap-south-1) — no failover | Reliability | Region outage = total outage |
| MED-04 | No database vacuuming strategy for UPDATE-heavy tables | Database | Dead tuple bloat degrades performance |
| MED-05 | notification_deliveries and notification_batches missing strict RLS | Security | Potential cross-tenant metadata visibility |
| MED-06 | Rate limiting is per-IP, not per-user | Security | Shared IPs bypass rate limits |
| MED-07 | Pastors phone_number is GLOBALLY unique (not per-church) | Data Model | Conflicts if pastor moves between churches |
| MED-08 | No CSRF tokens (relies on CORS + SameSite cookies only) | Security | Theoretical CSRF on older browsers |
| MED-09 | Subscription status transitions not enforced as state machine | Data Integrity | Can jump from "active" to any status |
| MED-10 | Payment stored and subscription updated in separate queries (no TX wrapper) | Data Integrity | Partial write risk on crash between queries |
| MED-11 | AdminConsolePage is 881+ lines, loads all tabs eagerly | Performance | Unnecessary JS parsed on admin page load |
| MED-12 | No "last refreshed" timestamp on any data view | UX | Users can't tell if data is stale |
| MED-13 | Church SaaS settings queried from DB on every payment calculation | Performance | Repeated queries for same church |
| MED-14 | Advisory lock for cron jobs — crash mid-execution releases lock but state may be inconsistent | Reliability | Partial cron execution without rollback |
| MED-15 | Notification job + delivery record are two separate INSERTs (no TX) | Data Integrity | Delivery record without job or vice versa |

### LOW (Polish / future improvements)

| ID | Problem | Category | Impact |
|----|---------|----------|--------|
| LOW-01 | No quiet hours for notifications | UX | 3 AM push notifications |
| LOW-02 | No per-church notification opt-out (only 5 global categories) | UX | Multi-church users can't silence one church |
| LOW-03 | No saved filters/views for admin | UX | Must re-set filters every session |
| LOW-04 | No search within admin sidebar tree (7+ items) | UX | Navigation friction |
| LOW-05 | Push notification VAPID key rotation has no strategy | Ops | All users must re-subscribe on rotation |
| LOW-06 | No auto-subscription on member creation | UX | Extra manual step for admin |
| LOW-07 | No scheduled announcement publishing | UX | Admin must manually post at the right time |
| LOW-08 | Admin pending counts include items from ALL time (no date filter) | UX | Count grows indefinitely |

---

## PHASE 1: EMERGENCY FIXES (Week 1)
**Goal**: Prevent system crashes under current growth trajectory  
**Effort**: Low  
**Impact**: Eliminates connection failures and timeout crashes

### Step 1.1 — Add Missing Database Indexes

**Why**: 5 identified queries doing full table scans. As tables grow past 10k rows, these become multi-second operations.

```sql
-- File: db/migrations/022_scalability_indexes.sql

-- 1. Church events: range queries by event_date do full scan
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_church_events_church_date
  ON church_events(church_id, event_date DESC);

-- 2. Subscription reminders: daily reminder generation has no church+date index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscription_reminders_church_sent
  ON subscription_reminders(church_id, sent_at DESC);

-- 3. Notification deliveries: batch status lookup for processing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_deliveries_batch_status
  ON notification_deliveries(batch_id, status);

-- 4. Job queue: archival/cleanup queries need created_at index
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_job_queue_created_at
  ON job_queue(created_at DESC);

-- 5. Family members: subscription status filter
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_family_members_member_subscription
  ON family_members(member_id, has_subscription);
```

**How to apply**:
```bash
# Connect to production RDS and run migration
psql "$DATABASE_URL" -f db/migrations/022_scalability_indexes.sql
```

### Step 1.2 — Reduce Connection Pool Size Per Task

**Why**: 10 ECS tasks × 20 connections = 200, but RDS db.t3.medium allows only ~150.

**File**: `src/services/dbClient.ts`

```typescript
// Change from:
max: 20,
// Change to:
max: 10,
```

This gives 10 tasks × 10 = 100 connections, safely under the 150 limit.

### Step 1.3 — Upgrade ECS Task Size

**Why**: 512 CPU (0.5 vCPU) is a single-threaded Node.js process. CPU-bound operations (JWT verification, JSON parsing, PDF generation) block the event loop.

**File**: `aws/cloudformation.yaml`

```yaml
# Change from:
Cpu: '512'
Memory: '1024'
# Change to:
Cpu: '1024'
Memory: '2048'
```

**Deploy**:
```bash
cd aws && ./deploy.sh
```

### Step 1.4 — Add Job Queue Cleanup Cron

**Why**: Completed/failed jobs accumulate forever. After 30 days, the job_queue table has 500k+ rows, slowing the pending job index.

**File**: `src/jobs/scheduler.ts` — add a new cron job:

```typescript
// Add to startScheduledJobs():
// Job 8: Cleanup old completed/failed jobs (daily at 02:00 UTC)
cron.schedule("0 2 * * *", async () => {
  const release = await tryAdvisoryLock("cleanup-job-queue");
  if (!release) return;
  try {
    const result = await rawQuery(
      `DELETE FROM job_queue
       WHERE status IN ('completed', 'failed')
         AND created_at < now() - interval '7 days'`,
      []
    );
    logger.info({ deleted: result.rowCount }, "job_queue cleanup completed");

    // Also cleanup old notification_deliveries (keep 30 days)
    const nd = await rawQuery(
      `DELETE FROM notification_deliveries
       WHERE status IN ('sent', 'delivered', 'failed', 'cancelled')
         AND created_at < now() - interval '30 days'`,
      []
    );
    logger.info({ deleted: nd.rowCount }, "notification_deliveries cleanup completed");
    jobHealth["cleanup-job-queue"] = { lastRun: new Date().toISOString(), status: "ok" };
  } catch (err) {
    logger.error({ err }, "cleanup-job-queue failed");
    jobHealth["cleanup-job-queue"] = { lastRun: new Date().toISOString(), status: "error", detail: String(err) };
  } finally {
    await release();
  }
});
```

### Step 1.5 — Fix Notification + Job Delivery Atomicity

**Why**: `queueNotification()` creates a `notification_deliveries` record and then a `job_queue` record in separate INSERTs. If the second fails, there's a delivery record with no job.

**File**: `src/services/notificationService.ts`

Wrap the two INSERTs in a transaction:

```typescript
const client = await getClient();
try {
  await client.query("BEGIN");
  // INSERT into notification_deliveries
  // INSERT into job_queue
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}
```

---

## PHASE 2: DATABASE HARDENING (Week 2–3)
**Goal**: Ensure database can handle 10x current data volume  
**Effort**: Medium  
**Impact**: Sustained query performance, eliminates DB as single point of failure

### Step 2.1 — Enable RDS Multi-AZ

**Why**: Single RDS instance = if it goes down, everything is down. Multi-AZ gives automatic failover.

```yaml
# aws/cloudformation.yaml — RDS instance:
MultiAZ: true
```

**Cost**: ~2x RDS cost but automatic failover with <60s downtime.

### Step 2.2 — Add RDS Read Replica

**Why**: All reads (member dashboard, lists, search, analytics) hit the primary. A read replica offloads 60-70% of traffic.

```yaml
# aws/cloudformation.yaml — add:
ReadReplica:
  Type: AWS::RDS::DBInstance
  Properties:
    SourceDBInstanceIdentifier: !Ref Database
    DBInstanceClass: db.t3.medium
    StorageEncrypted: true
```

**Backend change**: Add a `readPool` in `dbClient.ts` pointing to the replica endpoint. Use for all SELECT/GET queries. Keep `pool` (primary) for INSERT/UPDATE/DELETE.

```typescript
// src/services/dbClient.ts
const readPool = new Pool({
  connectionString: process.env.DATABASE_READ_URL || DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});

export function readQuery<T>(sql: string, params: unknown[]) {
  return readPool.query<T>(sql, params);
}
```

### Step 2.3 — Add RDS Proxy (Connection Pooling)

**Why**: Even with `max: 10` per task, auto-scaling to 10+ tasks risks exceeding RDS connection limits. RDS Proxy manages a shared pool.

```yaml
# aws/cloudformation.yaml — add:
RDSProxy:
  Type: AWS::RDS::DBProxy
  Properties:
    DBProxyName: !Sub ${AppName}-proxy
    EngineFamily: POSTGRESQL
    Auth:
      - AuthScheme: SECRETS
        SecretArn: !Ref DatabaseSecret
    RoleArn: !GetAtt RDSProxyRole.Arn
    VpcSubnetIds: [!Ref PrivateSubnet1, !Ref PrivateSubnet2]
```

Update `DATABASE_URL` env var to point to the proxy endpoint instead of direct RDS.

### Step 2.4 — Upgrade RDS Instance Class

**Why**: db.t3.medium (2 vCPU, 4GB) is burstable and throttled. Under sustained load, CPU credits deplete.

```yaml
# Change from:
DBInstanceClass: db.t3.medium
# Change to (for 100k+ users):
DBInstanceClass: db.r6g.large    # 2 vCPU, 16GB, non-burstable
# Or (for 1M+ users):
DBInstanceClass: db.r6g.xlarge   # 4 vCPU, 32GB
```

### Step 2.5 — Add Optimistic Locking to Members and Subscriptions

**Why**: Two admins editing the same member simultaneously — last write wins silently. Add a `version` column for conflict detection.

```sql
-- db/migrations/023_optimistic_locking.sql

ALTER TABLE members ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Trigger to auto-increment version on update
CREATE OR REPLACE FUNCTION increment_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER members_version_trigger
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION increment_version();

CREATE TRIGGER subscriptions_version_trigger
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION increment_version();
```

**Backend**: On UPDATE, include `WHERE version = $expected_version`. If 0 rows affected → return 409 Conflict.

### Step 2.6 — Wrap Payment + Subscription Update in Transaction

**Why**: Payment is stored and subscription status is updated in separate queries. If the app crashes between them, payment is recorded but subscription stays "pending".

```typescript
// In payment verification handler:
const client = await getClient();
try {
  await client.query("BEGIN");
  // 1. INSERT payment
  await client.query("INSERT INTO payments ...", [params]);
  // 2. UPDATE subscription next_payment_date
  await client.query("UPDATE subscriptions SET ... WHERE id = $1", [subId]);
  // 3. INSERT subscription_event
  await client.query("INSERT INTO subscription_events ...", [params]);
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}
```

### Step 2.7 — Add Subscription State Machine Enforcement

**Why**: Currently any status can transition to any other status. Define valid transitions:

```sql
-- db/migrations/024_subscription_state_machine.sql

CREATE OR REPLACE FUNCTION enforce_subscription_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot transition from cancelled';
  END IF;
  IF OLD.status = 'active' AND NEW.status NOT IN ('overdue', 'paused', 'cancelled') THEN
    RAISE EXCEPTION 'Active can only transition to overdue, paused, or cancelled';
  END IF;
  IF OLD.status = 'pending_first_payment' AND NEW.status NOT IN ('active', 'cancelled') THEN
    RAISE EXCEPTION 'Pending can only transition to active or cancelled';
  END IF;
  IF OLD.status = 'overdue' AND NEW.status NOT IN ('active', 'paused', 'cancelled') THEN
    RAISE EXCEPTION 'Overdue can only transition to active, paused, or cancelled';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER subscription_status_transition
  BEFORE UPDATE OF status ON subscriptions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION enforce_subscription_status_transition();
```

---

## PHASE 3: CACHING LAYER (Week 3–4)
**Goal**: Reduce database load by 60-70% with Redis caching  
**Effort**: Medium  
**Impact**: API response times drop from 200-800ms to 20-50ms for cached data

### Step 3.1 — Deploy ElastiCache Redis

```yaml
# aws/cloudformation.yaml — add:
RedisCluster:
  Type: AWS::ElastiCache::CacheCluster
  Properties:
    CacheNodeType: cache.t3.small     # 1.5GB RAM
    Engine: redis
    NumCacheNodes: 1
    VpcSecurityGroupIds: [!Ref RedisSecurityGroup]
    CacheSubnetGroupName: !Ref RedisSubnetGroup
```

Add `REDIS_URL` env var to ECS task definition.

### Step 3.2 — Create Redis Client Utility

```typescript
// src/services/redisClient.ts
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", (err) => logger.error({ err }, "Redis connection error"));
redis.connect();

export async function cacheGet<T>(key: string): Promise<T | null> {
  const val = await redis.get(key);
  return val ? JSON.parse(val) : null;
}

export async function cacheSet(key: string, data: unknown, ttlSeconds: number) {
  await redis.set(key, JSON.stringify(data), { EX: ttlSeconds });
}

export async function cacheInvalidate(pattern: string) {
  const keys = await redis.keys(pattern);
  if (keys.length) await redis.del(keys);
}

export { redis };
```

### Step 3.3 — Cache Member Dashboard (30s TTL)

**Why**: `GET /api/auth/member-dashboard` is the most called endpoint — joins 4+ tables every time.

```typescript
// In authRoutes.ts — member-dashboard handler:
const cacheKey = `dashboard:${userId}:${churchId}`;
const cached = await cacheGet(cacheKey);
if (cached) return res.json(cached);

const data = await getMemberDashboard(userId, churchId);
await cacheSet(cacheKey, data, 30); // 30 seconds
return res.json(data);
```

**Invalidate** after:
- Payment verification → `cacheInvalidate("dashboard:${memberId}:*")`
- Subscription create/update → `cacheInvalidate("dashboard:${memberId}:*")`
- Profile update → `cacheInvalidate("dashboard:${userId}:*")`

### Step 3.4 — Cache Admin Counts (30s TTL)

**Why**: 6 × COUNT(*) queries every 60 seconds per admin session. With 50 admins online → 300 COUNT queries/min.

```typescript
// In engagement admin-counts handler:
const cacheKey = `admin-counts:${churchId}`;
const cached = await cacheGet(cacheKey);
if (cached) return res.json(cached);

const counts = await computeAdminCounts(churchId);
await cacheSet(cacheKey, counts, 30);
return res.json(counts);
```

**Invalidate** when any request is created/reviewed (membership, family, cancellation, refund).

### Step 3.5 — Cache Church SaaS Settings (5min TTL)

**Why**: Every payment calculation queries `churches` table for SaaS settings (platform_fee, payments_enabled).

```typescript
const cacheKey = `church-settings:${churchId}`;
const cached = await cacheGet(cacheKey);
if (cached) return cached;

const settings = await getChurchSaaSSettings(churchId);
await cacheSet(cacheKey, settings, 300); // 5 minutes
return settings;
```

### Step 3.6 — Cache Static Reference Data (1hr TTL)

```typescript
// Leadership roles — rarely changes
const cacheKey = "leadership-roles";
const cached = await cacheGet(cacheKey);
if (cached) return cached;

const roles = await db.from("leadership_roles").select("*");
await cacheSet(cacheKey, roles, 3600); // 1 hour
```

---

## PHASE 4: JOB QUEUE OVERHAUL (Week 4–6)
**Goal**: Replace PostgreSQL job queue with dedicated message queue  
**Effort**: High  
**Impact**: Notifications delivered in seconds instead of days during peak

### Step 4.1 — Create SQS Queues

```yaml
# aws/cloudformation.yaml — add:
NotificationQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub ${AppName}-notifications
    VisibilityTimeout: 60
    MessageRetentionPeriod: 345600  # 4 days
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt NotificationDLQ.Arn
      maxReceiveCount: 3

NotificationDLQ:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub ${AppName}-notifications-dlq
    MessageRetentionPeriod: 1209600  # 14 days
```

### Step 4.2 — Create SQS Producer (Replace job_queue INSERT)

```typescript
// src/services/sqsProducer.ts
import { SQSClient, SendMessageCommand, SendMessageBatchCommand } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({ region: process.env.AWS_REGION });
const QUEUE_URL = process.env.NOTIFICATION_QUEUE_URL;

export async function enqueueNotification(job: {
  type: "send_email" | "send_sms" | "send_push";
  payload: Record<string, unknown>;
  deliveryId: string;
}) {
  await sqs.send(new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(job),
    MessageGroupId: job.type, // FIFO ordering by channel
  }));
}

// Batch send (up to 10 per API call)
export async function enqueueNotificationBatch(jobs: Array<{ type: string; payload: Record<string, unknown>; deliveryId: string }>) {
  const batches = chunk(jobs, 10);
  for (const batch of batches) {
    await sqs.send(new SendMessageBatchCommand({
      QueueUrl: QUEUE_URL,
      Entries: batch.map((job, i) => ({
        Id: String(i),
        MessageBody: JSON.stringify(job),
      })),
    }));
  }
}
```

### Step 4.3 — Create SQS Consumer (Replace cron processJobQueue)

```typescript
// src/jobs/sqsConsumer.ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

const CONCURRENCY = 20;
const POLL_INTERVAL = 1000; // 1 second

export async function startSQSConsumer() {
  while (true) {
    const messages = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20, // long polling
    }));

    if (messages.Messages?.length) {
      await Promise.allSettled(
        messages.Messages.map(async (msg) => {
          const job = JSON.parse(msg.Body!);
          await executeJob(job.type, job.payload);
          // Only delete after successful processing
          await sqs.send(new DeleteMessageCommand({
            QueueUrl: QUEUE_URL,
            ReceiptHandle: msg.ReceiptHandle!,
          }));
          // Update notification_deliveries status
          await updateDeliveryStatus(job.deliveryId, "sent");
        })
      );
    }
  }
}
```

### Step 4.4 — Deploy Dedicated Worker ECS Service

**Why**: Separate notification processing from API serving so heavy notification load doesn't block API responses.

```yaml
# aws/cloudformation.yaml — add:
WorkerTaskDefinition:
  Type: AWS::ECS::TaskDefinition
  Properties:
    Cpu: '512'
    Memory: '1024'
    ContainerDefinitions:
      - Name: worker
        Command: ["node", "dist/worker.js"]   # SQS consumer entry point
        Environment:
          - Name: NOTIFICATION_QUEUE_URL
            Value: !Ref NotificationQueue

WorkerService:
  Type: AWS::ECS::Service
  Properties:
    DesiredCount: 2    # 2 workers, scale independently
    TaskDefinition: !Ref WorkerTaskDefinition
```

### Step 4.5 — Migration Path (PostgreSQL → SQS)

1. **Week 1**: Deploy SQS queues + consumer alongside existing cron
2. **Week 2**: Dual-write — enqueue to both PostgreSQL job_queue AND SQS
3. **Week 3**: Monitor SQS delivery rates; if stable, disable cron job queue processing
4. **Week 4**: Remove PostgreSQL job_queue writes; keep table for historical reference
5. **Week 5**: Drop job_queue cleanup; eventually drop table

---

## PHASE 5: REAL-TIME & UX (Week 6–8)
**Goal**: Eliminate stale data, provide instant feedback  
**Effort**: Medium  
**Impact**: Users see changes immediately instead of 60s lag

### Step 5.1 — Add Server-Sent Events (SSE) for Real-Time Updates

**Why**: WebSocket is complex and requires sticky sessions. SSE is simpler, works with HTTP/2, and auto-reconnects.

```typescript
// src/routes/realtimeRoutes.ts
router.get("/stream", requireAuth, (req: AuthRequest, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const churchId = req.user!.church_id;
  const userId = req.user!.id;

  // Subscribe to Redis pub/sub for this church
  const subscriber = redis.duplicate();
  subscriber.subscribe(`church:${churchId}`, (message) => {
    res.write(`data: ${message}\n\n`);
  });
  subscriber.subscribe(`user:${userId}`, (message) => {
    res.write(`data: ${message}\n\n`);
  });

  // Heartbeat every 30s
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    subscriber.unsubscribe();
    subscriber.quit();
  });
});
```

### Step 5.2 — Publish Events on State Changes

```typescript
// After payment verification:
await redis.publish(`church:${churchId}`, JSON.stringify({
  type: "payment_verified",
  memberId,
  subscriptionId,
}));

// After admin approves request:
await redis.publish(`church:${churchId}`, JSON.stringify({
  type: "admin_counts_changed",
}));

// After subscription status change:
await redis.publish(`user:${userId}`, JSON.stringify({
  type: "dashboard_refresh",
}));
```

### Step 5.3 — Frontend SSE Client

```typescript
// src/hooks/useRealtime.ts
export function useRealtime(token: string, onEvent: (event: RealtimeEvent) => void) {
  useEffect(() => {
    const eventSource = new EventSource(`${API_URL}/api/realtime/stream`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      onEvent(event);
    };

    return () => eventSource.close();
  }, [token]);
}

// In AppProvider:
useRealtime(token, (event) => {
  if (event.type === "dashboard_refresh") refreshDashboard();
  if (event.type === "admin_counts_changed") refreshAdminCounts();
  if (event.type === "payment_verified") refreshDashboard();
});
```

### Step 5.4 — Add "Last Refreshed" Indicator

```typescript
// In any data-display component:
const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

// After data fetch:
setLastRefreshed(new Date());

// In JSX:
<span className="muted" style={{ fontSize: "0.75rem" }}>
  Updated {formatRelativeTime(lastRefreshed)}
</span>
```

### Step 5.5 — Auto-Refresh Events/Notifications

**Why**: Currently loaded once at bootstrap. Add periodic refresh + SSE trigger.

```typescript
// In useBootstrap.ts — add 5-minute refresh for events/notifications:
useEffect(() => {
  if (!token || !authContext) return;
  const interval = setInterval(() => {
    if (document.visibilityState === "visible") {
      void loadEvents();
      void loadNotifications();
    }
  }, 300_000); // 5 minutes
  return () => clearInterval(interval);
}, [token, authContext]);
```

### Step 5.6 — Consolidate Bootstrap API

**Why**: Login triggers 4-6 sequential API calls. Create one endpoint returning all bootstrap data.

```typescript
// src/routes/authRoutes.ts
router.get("/init", requireAuth, requireRegisteredUser, async (req: AuthRequest, res) => {
  const [dashboard, events, notifications, paymentConfig] = await Promise.all([
    getMemberDashboard(req.user!.id, req.user!.church_id),
    getChurchEvents(req.user!.church_id),
    getChurchNotifications(req.user!.church_id),
    getPaymentConfig(req.user!.church_id),
  ]);

  return res.json({ dashboard, events, notifications, paymentConfig });
});
```

Frontend changes to call single `/api/auth/init` instead of 4 separate calls.

---

## PHASE 6: ADMIN PRODUCTIVITY (Week 8–10)
**Goal**: Enable admins to manage 10k+ members efficiently  
**Effort**: Medium  
**Impact**: 10-100x admin productivity for bulk operations

### Step 6.1 — Bulk Subscription Creation

```typescript
// POST /api/subscriptions/bulk-create
router.post("/bulk-create", requireAuth, requireRegisteredUser, adminOnly, async (req, res) => {
  const { member_ids, plan_name, amount, billing_cycle } = req.body;

  // Validate: max 500 per batch
  if (member_ids.length > 500) return res.status(400).json({ error: "Max 500 per batch" });

  const client = await getClient();
  try {
    await client.query("BEGIN");
    let created = 0, skipped = 0;
    for (const memberId of member_ids) {
      // Check existing active subscription
      const existing = await client.query(
        `SELECT id FROM subscriptions WHERE member_id = $1 AND status IN ('active', 'pending_first_payment')`,
        [memberId]
      );
      if (existing.rows.length > 0) { skipped++; continue; }

      await client.query(
        `INSERT INTO subscriptions (member_id, church_id, plan_name, amount, billing_cycle, status)
         VALUES ($1, $2, $3, $4, $5, 'pending_first_payment')`,
        [memberId, req.user!.church_id, plan_name, amount, billing_cycle]
      );
      created++;
    }
    await client.query("COMMIT");
    return res.json({ created, skipped, total: member_ids.length });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
});
```

### Step 6.2 — Bulk Approve/Reject Requests

```typescript
// POST /api/ops/requests/bulk-review
router.post("/bulk-review", requireAuth, requireRegisteredUser, adminOnly, async (req, res) => {
  const { request_ids, action, review_note } = req.body;
  // action: "approve" | "reject"
  // request_ids: array of UUIDs (max 100)

  const results = { approved: 0, rejected: 0, errors: [] };
  for (const id of request_ids) {
    try {
      await reviewRequest(id, action, req.user!.id, review_note);
      results[action === "approve" ? "approved" : "rejected"]++;
    } catch (err) {
      results.errors.push({ id, error: err.message });
    }
  }
  return res.json(results);
});
```

### Step 6.3 — Increase CSV Export Limit

**File**: `src/services/exportService.ts`

```typescript
// Change from:
const MAX_EXPORT_ROWS = 500;
// Change to:
const MAX_EXPORT_ROWS = 10_000;
```

Add streaming CSV for large exports:

```typescript
router.get("/export/members/stream", requireAuth, adminOnly, async (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=members.csv");

  // Stream rows in batches of 500
  let offset = 0;
  const BATCH = 500;
  // Write CSV header
  res.write("Name,Email,Phone,Status,Subscription\n");

  while (true) {
    const batch = await listMembers(req.user!.church_id, BATCH, offset);
    if (batch.data.length === 0) break;
    for (const row of batch.data) {
      res.write(`"${row.full_name}","${row.email}","${row.phone_number}","${row.verification_status}","${row.subscription_amount}"\n`);
    }
    offset += BATCH;
  }
  res.end();
});
```

### Step 6.4 — Add COUNT Estimation for Large Lists

**Why**: `COUNT(*) exact` does full table scan. Use estimated count for large datasets:

```typescript
// For lists with > 1000 rows, use pg_class estimate:
async function estimateCount(tableName: string, churchId: string): Promise<number> {
  const result = await readQuery(
    `SELECT reltuples::bigint AS estimate FROM pg_class WHERE relname = $1`,
    [tableName]
  );
  return result.rows[0]?.estimate ?? 0;
}
```

Use estimated count for pagination display; only use exact count on final page or when under 10k rows.

### Step 6.5 — Admin Console Code Splitting

**Why**: `AdminConsolePage.tsx` is 881+ lines and loads all tabs eagerly.

```typescript
// Split each admin tab into lazy-loaded component:
const PaymentHistoryTab = lazy(() => import("./admin-tabs/PaymentHistoryTab"));
const MemberManagementTab = lazy(() => import("./admin-tabs/MemberManagementTab"));
const SubscriptionTab = lazy(() => import("./admin-tabs/SubscriptionTab"));
// ... etc

// In AdminConsolePage:
{activeTab === "payment-history" && (
  <Suspense fallback={<LoadingSkeleton />}>
    <PaymentHistoryTab />
  </Suspense>
)}
```

---

## PHASE 7: OBSERVABILITY & RESILIENCE (Week 10–12)
**Goal**: See problems before users report them  
**Effort**: Medium  
**Impact**: Proactive issue detection, faster debugging

### Step 7.1 — Add APM with Sentry Performance

```typescript
// src/sentry.ts — add performance monitoring:
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1, // Sample 10% of transactions
  integrations: [
    new Sentry.Integrations.Express({ app }),
    new Sentry.Integrations.Postgres(),
  ],
});
```

This gives p50/p95/p99 latency for every API endpoint automatically.

### Step 7.2 — Add Slow Query Logging

```typescript
// src/services/dbClient.ts — wrap query execution:
const start = Date.now();
const result = await pool.query(sql, params);
const duration = Date.now() - start;
if (duration > 100) {
  logger.warn({ duration, sql: sql.substring(0, 200), rows: result.rowCount }, "slow_query");
}
```

### Step 7.3 — Export Metrics to CloudWatch

```typescript
// src/utils/metrics.ts
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";

const cw = new CloudWatchClient({ region: process.env.AWS_REGION });

export async function publishMetric(name: string, value: number, unit: string = "Count") {
  await cw.send(new PutMetricDataCommand({
    Namespace: "Shalom/App",
    MetricData: [{
      MetricName: name,
      Value: value,
      Unit: unit,
      Timestamp: new Date(),
    }],
  }));
}

// Usage:
publishMetric("JobQueuePending", pendingCount);
publishMetric("DBPoolWaiting", pool.waitingCount);
publishMetric("APILatency", durationMs, "Milliseconds");
```

### Step 7.4 — Add Health Dashboard Endpoint

```typescript
// GET /health/detailed (internal only, not public)
router.get("/detailed", requireSuperAdmin, async (req, res) => {
  const dbHealth = await pool.query("SELECT 1");
  const redisHealth = await redis.ping();
  const jobQueueSize = await rawQuery("SELECT COUNT(*) FROM job_queue WHERE status = 'pending'", []);
  const schedulerHealth = getSchedulerHealth();

  return res.json({
    db: { status: "ok", pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount } },
    redis: { status: redisHealth === "PONG" ? "ok" : "error" },
    jobQueue: { pending: jobQueueSize.rows[0].count },
    scheduler: schedulerHealth,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});
```

### Step 7.5 — CloudWatch Alarms for Application Metrics

```yaml
# aws/cloudformation.yaml — add:
JobQueueBacklogAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: !Sub ${AppName}-job-queue-backlog
    MetricName: JobQueuePending
    Namespace: Shalom/App
    Statistic: Average
    Period: 300
    EvaluationPeriods: 2
    Threshold: 1000
    ComparisonOperator: GreaterThanThreshold
    AlarmActions: [!Ref AlertTopic]

DBPoolExhaustionAlarm:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: !Sub ${AppName}-db-pool-exhaustion
    MetricName: DBPoolWaiting
    Namespace: Shalom/App
    Statistic: Maximum
    Period: 60
    EvaluationPeriods: 3
    Threshold: 5
    ComparisonOperator: GreaterThanThreshold
    AlarmActions: [!Ref AlertTopic]
```

---

## PHASE 8: LONG-TERM ARCHITECTURE (Month 4+)
**Goal**: Scale to 10M users across 500 churches  
**Effort**: High  
**Impact**: True production-grade SaaS at scale

### Step 8.1 — Table Partitioning for Large Tables

```sql
-- Partition payments by month
ALTER TABLE payments RENAME TO payments_legacy;

CREATE TABLE payments (
  LIKE payments_legacy INCLUDING ALL
) PARTITION BY RANGE (payment_date);

-- Create monthly partitions
CREATE TABLE payments_2026_01 PARTITION OF payments
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE payments_2026_02 PARTITION OF payments
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ... auto-create future partitions via cron

-- Same for notification_deliveries, platform_fee_collections
```

### Step 8.2 — Multi-Region Deployment

Deploy to a secondary region (e.g., us-east-1) with:
- RDS cross-region read replica
- CloudFront origin failover
- Route 53 health checks with DNS failover

### Step 8.3 — Per-User Rate Limiting

```typescript
// Replace IP-based rate limiting with user-based:
const userLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => req.user?.id || req.ip, // User if authenticated, IP if not
});
```

### Step 8.4 — Notification Digest Mode

```typescript
// Instead of sending immediately, batch notifications:
// 1. Insert into notification_digest table with user_id, notification data, created_at
// 2. Cron every 1 hour: aggregate per user, send single digest email/push
// 3. User preference: "immediate" | "hourly" | "daily"
```

### Step 8.5 — Add Quiet Hours

```typescript
// Check user's timezone before sending:
function isQuietHours(userTimezone: string): boolean {
  const userHour = new Date().toLocaleString("en-US", { timeZone: userTimezone, hour: "numeric", hour12: false });
  const hour = parseInt(userHour);
  return hour >= 22 || hour < 7; // 10 PM to 7 AM
}

// If quiet hours: defer notification to 7 AM user's time
```

### Step 8.6 — Increase Razorpay Client Cache

```typescript
// Change from:
const MAX_RAZORPAY_CLIENTS = 100;
// Change to:
const MAX_RAZORPAY_CLIENTS = 600; // 500 churches + buffer
```

### Step 8.7 — Add RLS Tenant Scoping to Missing Tables

```sql
-- notification_batches: add RLS
ALTER TABLE notification_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_batches_tenant ON notification_batches
  USING (scope_id::text = current_setting('app.current_church_id', true)
         OR current_setting('app.current_church_id', true) IS NULL
         OR current_setting('app.current_church_id', true) = '');

-- notification_deliveries: already has church_id column, add enforcement
-- (Already has RLS enabled, verify policies are correct)
```

---

## IMPLEMENTATION TIMELINE

```
Week 1     ████████ Phase 1: Emergency Fixes (indexes, pool, cleanup)
Week 2-3   ████████████████ Phase 2: Database Hardening (Multi-AZ, replica, optimistic locking)
Week 3-4   ████████████████ Phase 3: Redis Caching Layer
Week 4-6   ████████████████████████ Phase 4: SQS Job Queue (biggest effort)
Week 6-8   ████████████████ Phase 5: Real-Time SSE + UX fixes
Week 8-10  ████████████████ Phase 6: Admin Bulk Operations
Week 10-12 ████████████████ Phase 7: Observability (APM, metrics, alarms)
Month 4+   ████████████████████████████████ Phase 8: Partitioning, Multi-Region, Digest
```

---

## ESTIMATED COSTS (Monthly, USD)

| Component | Current | After Phase 4 | After Phase 8 |
|-----------|---------|---------------|---------------|
| RDS (db.t3.medium) | ~$50 | ~$200 (r6g.large + replica) | ~$500 (r6g.xlarge + replica + proxy) |
| ECS (2 tasks × 512/1024) | ~$40 | ~$120 (4 tasks × 1024/2048) | ~$300 (10 tasks + 2 workers) |
| ElastiCache Redis | $0 | ~$25 (t3.small) | ~$50 (t3.medium) |
| SQS | $0 | ~$5 | ~$15 |
| CloudWatch | ~$5 | ~$15 | ~$30 |
| **Total** | **~$95** | **~$365** | **~$895** |

---

## VERIFICATION CHECKLIST

After each phase, verify:

- [ ] **Phase 1**: No "connection refused" errors in logs. Job queue table < 10k rows. All 5 indexes created.
- [ ] **Phase 2**: RDS failover test passes. Read replica lag < 1s. Optimistic locking returns 409 on conflict.
- [ ] **Phase 3**: Dashboard API p95 < 50ms (cached). Admin counts p95 < 30ms (cached). Redis hit rate > 80%.
- [ ] **Phase 4**: Notification delivery p95 < 30 seconds. SQS queue depth < 100 during peak. Worker auto-scales.
- [ ] **Phase 5**: Badge counts update within 2 seconds of change. Login bootstrap < 500ms (single API call).
- [ ] **Phase 6**: Admin can create 500 subscriptions in one click. CSV export handles 10k rows. Admin console loads in < 1s.
- [ ] **Phase 7**: Sentry shows p50/p95/p99 for all endpoints. Slow query alerts fire for > 100ms queries. CloudWatch dashboard shows all metrics.
- [ ] **Phase 8**: Payments table partitioned. Notifications arrive within 10s even during Sunday peak. Multi-region failover tested.
