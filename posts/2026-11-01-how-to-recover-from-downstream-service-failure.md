---
title: How to Recover from Downstream Service Failure
date: 2026-11-01
tags: [dotnet, resilience, reliability, architecture]
summary: How to keep your service healthy when a service it depends on is slow or down, using timeouts, retries, circuit breakers, fallbacks and queues.
---

Your service is fine. The payments API it calls is not. Requests to it start taking 30 seconds, your threads pile up waiting, and within minutes your own service is down too, even though nothing in your code changed.

This is how most large outages spread: a **downstream** dependency fails, and the failure travels upstream to everything that calls it. You cannot stop dependencies from failing. You can make sure their failure stays small. This post covers the tools, in the order you should reach for them.

## Slow is worse than down

A service that is completely down fails fast. The connection is refused, you get an error, and you move on. A service that is slow is far more dangerous, because every caller keeps waiting, and waiting uses resources: threads, connections, memory and request slots. When enough of them are used up, your service stops accepting new work.

That is why the first rule of resilience is about time.

## Tool 1: Timeouts

Every call to another system needs a timeout. Without one, the worst case is "wait forever". With `HttpClient`, the default is 100 seconds, which is almost always too long.

Set two limits: how long one attempt may take, and how long the whole operation may take, including retries. Pick values from the dependency's normal behavior. If a call usually takes 200 ms, waiting 2 seconds is generous, and waiting 30 seconds is a bug.

Also pass the `CancellationToken` of the incoming request through to the call, so work stops when the caller has already given up.

## Tool 2: Retries, used carefully

Many failures are brief: a dropped connection, a node restarting, a short overload. A retry turns these into successes that nobody notices. But retries have rules:

- **Retry only transient errors**, such as timeouts, connection failures and HTTP 502, 503 and 504. Do not retry a 400 or a 404, since the result will not change.
- **Retry only safe operations.** Repeating a `GET` is harmless. Repeating a `POST` that charges a card is not, unless the operation is idempotent (it carries a unique key so the second call is recognized as a duplicate).
- **Wait longer each time and add random jitter.** Exponential backoff with jitter prevents all your clients from retrying at the same moment.
- **Keep the count low.** Two or three attempts are enough. Retries multiply load: if three layers each retry three times, one failing call becomes 27. When a dependency is overloaded, aggressive retries turn a small problem into an outage.

## Tool 3: Circuit breakers

If a dependency is failing, continuing to call it wastes your time and adds to its load. A circuit breaker watches the recent failure rate and, once it passes a threshold, **stops calling** for a short period. Callers fail immediately instead of waiting for a timeout.

The breaker has three states:

| State | Behavior |
| --- | --- |
| Closed | Normal. Calls go through and failures are counted. |
| Open | Too many failures. Calls fail instantly without touching the dependency. |
| Half-open | After a break period, a few test calls are allowed. If they succeed, the breaker closes. If not, it opens again. |

This gives the failing service room to recover, and it keeps your own threads free.

## Putting it together in .NET

The `Microsoft.Extensions.Http.Resilience` package (built on Polly) combines a rate limiter, total timeout, retry, circuit breaker and attempt timeout into one standard pipeline:

```csharp
using Polly;

builder.Services
    .AddHttpClient<PaymentsClient>(c => c.BaseAddress = new Uri("https://payments.internal"))
    .AddStandardResilienceHandler(o =>
    {
        o.AttemptTimeout.Timeout = TimeSpan.FromSeconds(2);
        o.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(8);

        o.Retry.MaxRetryAttempts = 2;
        o.Retry.BackoffType = DelayBackoffType.Exponential;
        o.Retry.UseJitter = true;

        o.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(30);
        o.CircuitBreaker.BreakDuration = TimeSpan.FromSeconds(15);
    });
```

The defaults are sensible, so start with `AddStandardResilienceHandler()` alone and tune the numbers with data from your own system. The library validates some combinations (for example, the sampling duration must be longer than the attempt timeout), and it will tell you at startup if the values do not fit together. Check the option names against the package version you install.

Resilience cannot guess how you want a failure to look to your users. That is a design decision, and it comes next.

## Tool 4: Decide what "degraded" means

When the dependency stays down, your service has to do something. Pick the behavior deliberately, per feature:

- **Serve stale data.** If the product price service is down, show the last known price from a cache and mark it as possibly out of date.
- **Use a default.** If the recommendation service fails, show the most popular items instead.
- **Hide the feature.** If reviews cannot load, render the page without the reviews section.
- **Queue the work.** If the email service is unavailable, accept the request and send the email later.
- **Fail clearly.** If a payment cannot be taken, say so and let the user retry. Never pretend it worked.

```csharp
public async Task<Price> GetPriceAsync(string sku, CancellationToken ct)
{
    try
    {
        var price = await _client.GetPriceAsync(sku, ct);
        _cache.Set(sku, price, TimeSpan.FromHours(1));
        return price;
    }
    catch (Exception ex) when (ex is HttpRequestException
                                or TimeoutRejectedException
                                or BrokenCircuitException)
    {
        if (_cache.TryGetValue(sku, out Price? stale) && stale is not null)
            return stale with { IsStale = true };

        throw;   // nothing to fall back to: let the caller decide
    }
}
```

`TimeoutRejectedException` is in `Polly.Timeout` and `BrokenCircuitException` is in `Polly.CircuitBreaker`. The resilience handler throws them when a timeout or an open circuit stops the call.

A fallback should be quick and should not depend on the same failing system. A fallback that calls another remote service can fail in the same way.

## Tool 5: Decouple with a queue

For work that does not have to finish while the user waits, the strongest design is to not call the dependency in the request at all. Save the work in your own database and let a background process deliver it.

The **outbox pattern** does this safely. In one database transaction you save your business data and a message row in an `Outbox` table. A background worker reads the table, calls the dependency, and marks each row as done. If the dependency is down, the rows simply wait. When it returns, the backlog drains. Because delivery can be repeated, the receiver must handle duplicates (see idempotency in [How to handle concurrent requests safely](how-to-handle-concurrent-requests-safely.html)).

Messages that keep failing should go to a **dead-letter** store after a limited number of attempts, so one bad message cannot block the queue and a person can inspect it.

## Tool 6: Protect yourself under load

- **Bulkheads:** limit how many concurrent calls may go to one dependency (a semaphore or a separate connection pool). A slow dependency can then use up only its own share, not the whole service.
- **Load shedding:** when you are overloaded, reject extra requests early with a 503 and a `Retry-After` header. A quick refusal is better than a slow collapse.
- **Health checks:** report readiness separately from liveness. A service that cannot reach a critical dependency can report "not ready" so a load balancer stops sending it traffic, but it should not be restarted, because a restart will not fix someone else's outage.

## You must see it to recover from it

None of this works if you find out from your customers. Measure each dependency separately:

- Request rate, error rate and latency (p50, p95 and p99) per dependency
- Circuit breaker state changes, logged and alerted
- Retry counts, since a rise in retries is an early warning
- Queue and outbox depth, and the age of the oldest message

## Test the failure, not only the success

Resilience settings that have never been exercised are guesses. Practice before the real incident:

1. In a test environment, make the dependency return errors, then make it slow, then make it unreachable.
2. Confirm that your service stays up, that the breaker opens and closes, and that users see the degraded behavior you chose.
3. Check what happens when the dependency comes back. A sudden flood of queued work can knock it over again, so drain backlogs at a controlled rate.

## Summary

- Slow dependencies are more dangerous than dead ones, so set timeouts on every call.
- Retry transient errors only, a few times, with backoff and jitter, and only for safe operations.
- Use a circuit breaker so you stop hammering a failing service and keep your resources free.
- Choose the degraded behavior for each feature on purpose: stale data, defaults, queues or a clear error.
- Move non-urgent work behind a queue or an outbox.
- Measure every dependency, and test failures before they happen.
