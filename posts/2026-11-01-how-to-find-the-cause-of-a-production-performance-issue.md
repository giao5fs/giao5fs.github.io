---
title: How to Find the Cause of a Production Performance Issue
date: 2026-11-01
tags: [dotnet, performance, debugging, observability]
summary: A repeatable method for turning "the site is slow" into a specific cause, by narrowing down the layer first and using traces, counters and database tools second.
---

"The site is slow." It is the least precise bug report there is, and the most expensive one to guess about. Teams lose days adding caches, scaling servers and rewriting code, only to learn that the real cause was a missing database index.

Finding the cause of a performance problem is a search, and a search needs a method. The idea of this post is simple: **narrow down where the time goes before you decide why.** Layer by layer, you remove places the problem is not, until one remains.

## Step 1: Describe the symptom precisely

Replace "slow" with numbers. Answer these questions first:

- **What exactly is slow?** All pages, or one endpoint? One customer, or everyone?
- **How slow?** Compare percentiles with a normal baseline. Averages hide problems, so look at p50, p95 and p99 latency.
- **Since when?** Find the moment it began. A sharp start points to a change. A slow drift points to growth, such as data volume or a leak.
- **Is it constant or periodic?** A pattern every hour often means a scheduled job, a cache expiry or a backup.
- **Is it throughput or latency?** "Each request takes longer" and "we can serve fewer requests per second" are different problems.

Write the answers down. They already eliminate many causes.

## Step 2: Ask what changed

Most performance problems have a trigger. Check, in this order:

1. Deployments and configuration changes around the start time
2. Infrastructure changes: scaling, instance types, network or database settings
3. Traffic: a marketing campaign, a new client, a bot
4. Data: a table that crossed some size, or a customer with unusually large data
5. Dependencies: a slower downstream service

If a deployment lines up with the start time, compare it with the previous version first. It is the cheapest check, and it is often the answer.

## Step 3: Find the layer

A request passes through a chain: the client, the network and load balancer, your application, and its dependencies (database, cache, other services). The time is spent in one or more of these links. **A distributed trace shows this directly.** It draws one request as a set of spans, so you can see that 40 ms was spent in your code and 1,800 ms waiting for a SQL query.

If you have no tracing, use the next best thing: logs with timings, or middleware that records how long each stage took.

Adding your own span around a suspicious operation is a few lines with `ActivitySource`, which OpenTelemetry understands:

```csharp
private static readonly ActivitySource Source = new("Shop.Orders");

public async Task<Discounts> LoadDiscountsAsync(int customerId, CancellationToken ct)
{
    using var activity = Source.StartActivity("LoadDiscounts");
    activity?.SetTag("customer.id", customerId);

    return await _repository.GetDiscountsAsync(customerId, ct);
}
```

Once you know which layer owns the time, you only have to investigate that layer.

## Step 4: Check the application's own health

If the time is inside your process, the next question divides the problem in two: **is the CPU busy, or is the process waiting?**

```bash
dotnet-counters monitor --process-id <pid> System.Runtime Microsoft.AspNetCore.Hosting
```

| What you see | What it usually means |
| --- | --- |
| CPU near 100% | Real work is the bottleneck: an expensive algorithm, serialization, regex, or too much logging |
| Low CPU, but requests are slow | The process is **waiting**: on a database, another service, a lock or the thread pool |
| High "time in GC" or many Gen 2 collections | Too many allocations or a memory problem. See [How to diagnose a memory leak in .NET](how-to-diagnose-a-memory-leak.html) |
| Thread pool queue length growing | Thread pool starvation |

### CPU is busy

Record a CPU profile and look for the methods that use the most time:

```bash
dotnet-trace collect --process-id <pid> --profile cpu-sampling
```

Open the `.nettrace` file in Visual Studio or PerfView and sort by inclusive time. The top few entries are where to start. Fix the biggest one only, then measure again.

### CPU is low and requests are slow

Look at what the threads are doing right now:

```bash
dotnet-stack report --process-id <pid>
```

If many threads are stuck on the same line, such as a lock, a `.Result` or `.Wait()` call, or a database call, you have found the wait.

**Thread pool starvation** deserves a special mention because it is common and confusing. If code blocks threads while waiting for async work (`.Result`, `.Wait()`, `GetAwaiter().GetResult()`), the pool runs out of free threads. New requests queue, latency climbs, and CPU stays low. The fix is to make the call chain `async` all the way down, not to add threads.

```csharp
// Blocks a pool thread for the whole call
var data = _client.GetDataAsync(id).Result;

// Frees the thread while it waits
var data = await _client.GetDataAsync(id, ct);
```

## Step 5: Check the database

In many web systems, the database is the answer. Signs include one slow span in a trace, or a connection pool that is exhausted.

- **Find the slow queries.** Use your database's own tools: Query Store or `sys.dm_exec_query_stats` in SQL Server, `pg_stat_statements` in PostgreSQL. Sort by total time, not only by the slowest single call. A query that takes 20 ms but runs 50,000 times a minute can cost more than one that takes 2 seconds once.
- **Read the execution plan.** A table scan on a large table, or an estimated row count that is far from the real one, explains many slow queries. A missing or unused index is the classic cause.
- **Look for the N+1 pattern.** One query loads a list, and then one more query runs for each item. In a trace it looks like a long row of tiny identical spans. Fix it with a join, `Include` or a projection.
- **Look for blocking.** Queries that are not slow by themselves but wait for locks held by another transaction. Long transactions are usually the cause.
- **Check the connection pool.** If requests wait to get a connection, a few slow queries or leaked connections (a missing `using`) may be holding them all.

Turning on EF Core's SQL logging in a test environment is an easy way to see what your code actually asks the database to do.

## Step 6: Check the dependencies and the infrastructure

If the trace shows the time is spent waiting for another service or a cache, the investigation moves there. Apply the same method to that service. Also look at the less visible parts:

- DNS or TLS handshake time for new connections, which can be a sign that `HttpClient` instances are created per request instead of being reused
- Network limits, such as SNAT port exhaustion on cloud platforms
- CPU or memory throttling in containers, which makes a healthy-looking process slow
- A noisy neighbor on shared hardware

## Step 7: Form a hypothesis, change one thing, measure

When you have a suspect, resist the urge to fix five things at once. The loop is:

1. **State a hypothesis** in one sentence: "The order list is slow because it runs one query per row."
2. **Predict what the fix will do:** "Latency for that endpoint should fall from 1.8 s to under 200 ms."
3. **Make one change.**
4. **Measure with the same method as before.** Compare p95, not a single request.
5. If the number did not move, your hypothesis was wrong. Undo the change and form a new one.

Fixing several things at once makes it impossible to know which one worked, or whether one of them made things worse.

## Quick symptom guide

| Symptom | First thing to check |
| --- | --- |
| Slow right after a deployment | Diff against the last version; look for new queries and new calls |
| Slow every hour, on the hour | Scheduled jobs, cache expiry, backups |
| Gets slower as data grows | Missing index, unbounded query, no paging |
| Low CPU, high latency | Waiting: thread pool, locks, database, downstream service |
| High CPU | CPU profile with `dotnet-trace` |
| Slow only for one customer | That customer's data volume, a specific query plan |
| Fine at first, slow after hours | Memory growth, leaked connections, cache that never evicts |

## Make the next investigation shorter

The best time to build the tools is before the incident.

- Collect the golden signals for every service: request rate, error rate, latency percentiles and saturation (CPU, memory, thread pool, connection pool).
- Add distributed tracing with OpenTelemetry, and propagate a correlation id through logs.
- Keep dashboards for each dependency separately.
- Run load tests against realistic data volumes before big releases.
- Write down each investigation: the symptom, the cause and the fix. The next engineer will thank you.

## Summary

- Turn "slow" into numbers: which endpoint, how slow, since when.
- Check what changed before looking for what is broken.
- Find the **layer** first with a trace, then investigate only that layer.
- Separate "busy" from "waiting": CPU profile for the first, thread stacks and dependency checks for the second.
- Check the database early, since slow queries, missing indexes and N+1 are the most common cause.
- Change one thing at a time and measure after each change.
