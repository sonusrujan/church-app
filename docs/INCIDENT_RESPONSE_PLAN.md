# Shalom SaaS — Incident Response Plan

**Version**: 1.0  
**Last Updated**: 20 April 2026  
**Owner**: Platform Engineering Team  
**Compliance**: Digital Personal Data Protection (DPDP) Act, 2023

---

## 1. SEVERITY LEVELS

| Level | Definition | Response Time | Examples |
|-------|-----------|---------------|----------|
| **SEV-1 (Critical)** | Service completely down, data breach, payment system failure | 15 minutes | Full outage, unauthorized data access, payment processing broken |
| **SEV-2 (High)** | Major feature broken affecting multiple churches | 1 hour | Login broken, webhook processing halted, job queue stuck |
| **SEV-3 (Medium)** | Feature degraded for some users | 4 hours | Slow dashboard, notification delivery delays, one church affected |
| **SEV-4 (Low)** | Minor issue, cosmetic, one-off error | Next business day | UI glitch, single failed export, edge-case error |

---

## 2. INCIDENT RESPONSE TEAM

| Role | Responsibility |
|------|---------------|
| **Incident Commander (IC)** | Coordinates response, makes decisions, communicates status |
| **Technical Lead** | Diagnoses root cause, implements fix |
| **Communications Lead** | Notifies affected churches/users, updates status page |

For a small team, one person may hold multiple roles.

---

## 3. RESPONSE PROCEDURE

### Step 1 — Detect & Acknowledge (0–15 min)

- CloudWatch alarm fires → check Sentry for error spike
- Or: user/church reports issue
- Acknowledge the incident and assign a severity level
- Create a private incident log (timestamp every action)

### Step 2 — Assess & Contain (15–60 min)

- Identify scope: how many churches/users affected?
- Check: Is it a data breach? (unauthorized access, data exposure)
- **If data breach**: jump to Section 5 (Breach Notification)
- Contain the damage:
  - Disable affected feature via feature flag or config
  - Rollback deployment if caused by recent deploy:
    ```bash
    # Rollback to previous ECS task definition
    aws ecs update-service --cluster shalom-cluster --service shalom-service \
      --task-definition <previous-task-definition-arn> --region ap-south-1
    ```
  - Block malicious IPs if attack:
    ```bash
    # Add IP to WAF block list (once WAF enabled)
    aws wafv2 update-ip-set ...
    ```

### Step 3 — Fix & Verify (1–4 hours)

- Develop and test the fix locally
- Deploy fix to production
- Verify fix resolves the issue (check Sentry, CloudWatch, manually test)

### Step 4 — Communicate (Throughout)

- **SEV-1/SEV-2**: Notify all affected churches within 1 hour via:
  - Push notification (if push system is functional)
  - Email to registered church admin contacts
- **SEV-3/SEV-4**: No user notification needed unless affecting payments

Template:
> "We're aware of an issue affecting [description]. Our team is working on a fix. [Estimated resolution time]. Your data is safe."

### Step 5 — Post-Incident Review (Within 48 hours)

Document:
- What happened (timeline)
- What was the root cause
- What was the impact (users affected, duration)
- What we'll do to prevent recurrence
- Action items with owners and deadlines

---

## 4. ESCALATION PATH

```
Alert → IC assesses severity
  → SEV-4: Fix in normal workflow
  → SEV-3: Fix within 4 hours, no user notification
  → SEV-2: All hands, fix within 1 hour, notify affected churches
  → SEV-1: All hands, fix immediately, notify all churches,
            consider data breach procedure
```

---

## 5. DATA BREACH NOTIFICATION (DPDP Act 2023 Compliance)

### What constitutes a data breach:
- Unauthorized access to member personal data (name, phone, email, address)
- Unauthorized access to payment records
- Database credential exposure
- Razorpay API key compromise

### Notification timeline:
1. **Within 72 hours of detection**: Notify the Data Protection Board of India
2. **Without unreasonable delay**: Notify all affected Data Principals (users)

### Notification must include:
- Nature of the breach
- Categories of personal data affected
- Approximate number of users affected
- Contact details for further information
- Measures taken to address the breach
- Measures users can take to protect themselves

### Immediate breach response actions:
1. Revoke compromised credentials (DB password, API keys, JWT secret)
2. Force-expire all user sessions (clear refresh_tokens table)
3. Rotate secrets in AWS SSM Parameter Store
4. Redeploy with new credentials
5. Audit database access logs for unauthorized queries
6. Preserve all logs for investigation (do NOT delete)

---

## 6. MONITORING & DETECTION

| Source | What It Catches | Dashboard |
|--------|----------------|-----------|
| **CloudWatch Alarms** | CPU > 80%, Memory > 80%, RDS CPU > 80%, Storage < 2GB | AWS Console → CloudWatch |
| **Sentry** | Application errors, unhandled exceptions, slow transactions | sentry.io dashboard |
| **ECS Health Checks** | Container crashes, /health endpoint failures | AWS Console → ECS |
| **RDS Events** | Failover, storage full, backup failures | AWS Console → RDS → Events |

---

## 7. RUNBOOKS

### App is down (502 errors)
1. Check ECS service: `aws ecs describe-services --cluster shalom-cluster --services shalom-service --region ap-south-1`
2. Check task count (desired vs running)
3. Check CloudWatch logs for crash reason
4. If OOM: increase task memory in CloudFormation
5. If crash loop: rollback to previous task definition

### Database unreachable
1. Check RDS status: `aws rds describe-db-instances --db-instance-identifier shalom-db --region ap-south-1`
2. Check if Multi-AZ failover occurred (RDS events)
3. Check security group rules haven't changed
4. Check connection pool exhaustion in app logs

### Payment webhooks failing
1. Check Razorpay dashboard → Webhooks → Recent deliveries
2. Check app logs for webhook errors: filter `webhookRoutes`
3. Verify webhook secret hasn't changed
4. Check `razorpay_webhook_events` table for failed/skipped events

### Job queue backed up
1. Check queue depth: `SELECT status, COUNT(*) FROM job_queue GROUP BY status;`
2. Check if cron advisory lock is stuck: `SELECT * FROM pg_locks WHERE locktype = 'advisory';`
3. If stuck: kill the holding connection and restart

---

## 8. CONTACTS

| Role | Contact | Method |
|------|---------|--------|
| Platform Admin | [Fill in] | Phone / WhatsApp |
| AWS Account Owner | [Fill in] | Email |
| Razorpay Support | https://dashboard.razorpay.com | Dashboard ticket |
| Twilio Support | https://console.twilio.com | Dashboard ticket |

---

## 9. REVIEW SCHEDULE

- Review this plan **quarterly** (every 3 months)
- Update after every SEV-1 or SEV-2 incident
- Test the escalation path with a tabletop exercise annually
