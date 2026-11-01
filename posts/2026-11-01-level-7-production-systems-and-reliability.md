---
title: "Level 7: Production Systems and Reliability"
date: 2026-11-01
tags: [dotnet, reliability, observability, devops, series]
summary: Everything that happens after the code compiles. Observability, resilience, safe deployments, configuration, data changes on live systems, and handling incidents.
---

This is Level 7, the last level of the series [7 Levels of .NET Mastery](7-levels-of-dotnet-mastery.html). The code works on your machine. Now it must work for thousands of users, at night, during deployments, when a dependency fails, and when the person who wrote it is on holiday.

The central change in thinking is this: **failure is normal.** Networks drop packets, disks fill, deployments go wrong, and dependencies slow down. A reliable system is not one that never fails. It is one that fails in small, visible and recoverable ways.

## What you should know

### 1. Observability: see what the system is doing

You cannot fix what you cannot see. Observability rests on three kinds of signals.

**Logs** tell you what happened. Make them **structured**, so you can search by field instead of by text.

```csharp
// Text only: hard to search and aggregate
_logger.LogInformation("Order " + order.Id + " paid by " + user.Id);

// Structured: Id and UserId become searchable fields
_logger.LogInformation("Order {OrderId} paid by {UserId}", order.Id, user.Id);
```

Guidelines for logging:

- Use levels with meaning: `Error` for failures that need attention, `Warning` for unexpected but handled events, `Information` for important business events, `Debug` for development.
- Log exceptions with the exception object: `_logger.LogError(ex, "Payment failed for {OrderId}", id)`.
- Never log passwords, tokens or personal data.
- Include a **correlation id** in every log line of a request so you can follow it across services.

**Metrics** tell you how much and how fast: request rate, error rate, latency percentiles, CPU, memory, queue depth. They are cheap, and they power dashboards and alerts.

**Traces** show the path of one request across services and the database, with the time spent in each step.

OpenTelemetry is the standard way to produce all three in .NET:

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("shop-api"))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddSqlClientInstrumentation()
        .AddOtlpExporter())
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddRuntimeInstrumentation()
        .AddOtlpExporter());
```

For each service, watch the **golden signals**: latency, traffic, errors and saturation.

### 2. Health checks

A health endpoint tells the platform whether to send traffic to an instance.

```csharp
builder.Services.AddHealthChecks()
    .AddDbContextCheck<AppDbContext>("database", tags: new[] { "ready" });

app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new HealthCheckOptions { Predicate = c => c.Tags.Contains("ready") });
```

- **Liveness**: "is the process alive?" If it fails, restart it. Keep it simple, with no dependency checks.
- **Readiness**: "can it serve requests now?" If it fails, stop sending traffic but do not restart.

Restarting a healthy service because its database is down only makes the incident worse.

### 3. Resilience: survive failing dependencies

Every call to another system needs a **timeout**. Add **retries with backoff and jitter** only for safe, transient failures. Add a **circuit breaker** so you stop hammering a failing service. Decide what the **degraded behavior** is: stale data, a default, a queue, or a clear error.

```csharp
builder.Services
    .AddHttpClient<PaymentsClient>(c => c.BaseAddress = new Uri("https://payments.internal"))
    .AddStandardResilienceHandler();
```

The complete treatment is in [How to recover from downstream service failure](how-to-recover-from-downstream-service-failure.html). Two more tools:

- **Bulkheads** limit how much of your capacity one dependency may use.
- **Load shedding** rejects extra requests early (503 and `Retry-After`) instead of collapsing slowly.

### 4. Idempotency and messages

Assume that **any message can be delivered more than once**, and that any request may be retried. Design operations so that running them twice has the same effect as running them once.

- Give requests an **idempotency key** and record processed keys with a unique constraint.
- Use the **outbox pattern** to save data and the message to send in one transaction.
- Put a **dead-letter queue** behind every consumer, so a bad message does not block the others.
- Make consumers tolerant of messages arriving out of order.

See [How to handle concurrent requests safely](how-to-handle-concurrent-requests-safely.html) for idempotency in practice.

### 5. Configuration and secrets

- Keep configuration **outside the code**, per environment. The same build should run in test and production with different settings.
- Store secrets in a secret manager (Key Vault, AWS Secrets Manager or similar), never in the repository or the image.
- Validate options at startup, so a bad setting stops the deployment instead of failing at 3 a.m.
- Use **feature flags** to separate "deployed" from "released". You can switch a feature off without a new deployment.

### 6. Safe deployments

Most incidents follow a change. Make changes small, reversible and observable.

- **Automate the pipeline**: build, test, scan, deploy. A person typing commands on a server is a risk.
- **Deploy gradually**: rolling updates, blue-green, or canary releases that send a small share of traffic to the new version first.
- **Roll back quickly**: keep the previous version ready, and practice the rollback.
- **Watch the dashboards during and after a release**, and define in advance what counts as "bad enough to roll back".
- **Make versions compatible**: during a rolling deployment, old and new code run at the same time against the same database and the same messages.

### 7. Changing data on a live system

Database changes are the riskiest part of a release, because you cannot undo them as easily as code. Use the **expand and contract** approach:

1. **Expand:** add the new column or table. Old code ignores it.
2. **Deploy** code that writes both the old and new fields, then code that reads the new one.
3. **Backfill** existing rows in small batches, not in one huge transaction.
4. **Contract:** only after all code uses the new field, remove the old one in a later release.

Never rename or drop a column in the same release as the code change. Test migrations against a copy of production-sized data to see how long they lock tables.

### 8. Capacity and load testing

Do not learn your limits from your customers. Before big releases and campaigns:

- Run **load tests** (k6, NBomber, JMeter) with realistic data volumes and traffic shapes.
- Find the **breaking point** and which resource gives out first: CPU, memory, database connections, thread pool or a dependency.
- Add **autoscaling** only after you know what to scale, and set limits so scaling cannot overwhelm your database.
- Set **resource requests and limits** deliberately in containers. A too-small CPU limit causes throttling that looks like slow code.

### 9. Incident response

When something breaks, the order of work is: **stop the damage, restore service, then find the cause.**

1. **Detect:** an alert fires, based on symptoms users feel (errors, latency), not only on CPU.
2. **Declare:** name an incident owner and open one place for communication.
3. **Mitigate first:** roll back, switch off a feature flag, scale up, or fail over. Do not debug on a burning system if a rollback fixes it in two minutes.
4. **Investigate:** use the method from [How to find the cause of a production performance issue](how-to-find-the-cause-of-a-production-performance-issue.html): what changed, which layer, which hypothesis.
5. **Communicate:** short, regular updates to the people affected.
6. **Review without blame:** write a postmortem with the timeline, the cause, what went well and the concrete actions that will prevent a repeat. People cause incidents by working inside a system that allowed the mistake, and the fix is a better system.

Good alerts are few and actionable. Each alert should have a runbook that says what it means and what to do first.

### 10. Security basics in production

- Keep dependencies updated and scan them for known vulnerabilities (`dotnet list package --vulnerable`).
- Use least privilege: each service gets only the permissions it needs.
- Use HTTPS everywhere, including inside your network where possible.
- Apply rate limiting on public endpoints (`AddRateLimiter`).
- Back up data, and **test restoring** from the backup. A backup that has never been restored is only a hope.

## Common mistakes

| Mistake | Consequence |
| --- | --- |
| No timeouts on outgoing calls | One slow dependency takes everything down |
| Retrying everything, everywhere | Load multiplies and an outage grows |
| Logging text without structure or correlation ids | Impossible to follow a request |
| Alerting on every spike | Alert fatigue, real problems ignored |
| Big-bang releases with no rollback plan | Long, stressful incidents |
| Dropping columns in the same release as the code | Cannot roll back |
| Liveness check that tests the database | Restart loops during a database incident |
| Untested backups | Discovering the problem during a disaster |

## Practice plan

1. **Instrument the Level 5 API.** Add OpenTelemetry traces and metrics, structured logs with a correlation id, and liveness and readiness endpoints.
2. **Break it on purpose.** Stop the database, then make a dependency slow, then unreachable. Watch what your service does. Fix the worst behavior with timeouts, a circuit breaker and a fallback.
3. **Dashboard and alert.** Build one dashboard with the golden signals and one alert on error rate. Trigger it and see whether it fires.
4. **Practice a migration.** Rename a column using expand and contract across three deployments.
5. **Run a game day.** With a friend, one of you breaks something in a test environment and the other has to find it using only logs, metrics and traces. Then write a short postmortem.

## Are you ready to call yourself comfortable here?

- [ ] A dependency going down does not take my service down with it.
- [ ] I can find the cause of a production problem from logs, metrics and traces instead of guessing.
- [ ] I deploy in small steps and I know how to roll back.
- [ ] My operations are safe to run twice.
- [ ] I can change a live database schema without downtime.
- [ ] I have written or taken part in a blameless postmortem.

## Where to go from here

Mastery is not a title that you reach at Level 7. It is the habit of recognizing which level a problem belongs to, and reaching for the right tool. When something goes wrong in production, go back down the levels: many "reliability" problems are Level 4 mistakes, many "performance" problems are Level 5 queries, and many "design" problems are Level 2 types that did not protect their rules.

Previous: [Level 6: Performance and Runtime Internals](level-6-performance-and-runtime-internals.html). Overview: [7 Levels of .NET Mastery](7-levels-of-dotnet-mastery.html).
