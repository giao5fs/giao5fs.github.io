---
title: A checklist for debugging production issues
date: 2026-10-28
tags: [debugging, craft, sample]
summary: A calm, repeatable order of questions to work through when something breaks in production.
---

> [!TIP]
> This is a sample post. Replace it with your own experience.

When production breaks, the hardest part is staying systematic. This is the order I would work through the questions.

## 1. Define the symptom precisely

Write down what is wrong, who is affected and since when. "The site is slow" becomes "Checkout requests for EU users take 8 seconds since 14:05".

## 2. Ask what changed

Most incidents follow a change. Check, in this order:

1. Deployments and configuration changes
2. Dependency or infrastructure updates
3. Data volume and traffic patterns
4. Expiring certificates, secrets and quotas

## 3. Reproduce or observe

Prefer evidence over theory. Pull the logs for one failing request and follow its correlation id across services.

```bash
# Find every log line for one request
grep "correlationId=7f3a91" /var/log/app/*.log | sort
```

If the database is involved, look at what is actually running:

```sql
SELECT TOP 10 session_id, status, wait_type, total_elapsed_time
FROM sys.dm_exec_requests
ORDER BY total_elapsed_time DESC;
```

## 4. Change one thing at a time

Each change should test one hypothesis. If you change three things and the problem disappears, you have learned nothing.

## 5. Write it down

Capture the timeline, the cause and the fix while it is fresh. A short note now is worth more than a perfect post-mortem next week.

---

> Make it work, then make it understood by the next person on call.
