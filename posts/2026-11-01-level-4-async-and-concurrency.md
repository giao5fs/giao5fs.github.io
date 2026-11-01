---
title: "Level 4: Async and Concurrency"
date: 2026-11-01
tags: [dotnet, csharp, async, concurrency, series]
summary: What async and await really do, how to avoid blocking and deadlocks, how to cancel and limit work, and how to share state between threads safely.
---

This is Level 4 of the series [7 Levels of .NET Mastery](7-levels-of-dotnet-mastery.html). It is the level where many production bugs are born, because the code often works in a test with one user and fails with a hundred.

## What you should know

### 1. What `async` and `await` actually do

`async` does **not** mean "runs on another thread". It means: *when this method must wait for something (a database, a network call, a file), release the thread so it can do other work, and continue later.*

```csharp
public async Task<string> GetTitleAsync(string url, CancellationToken ct)
{
    using var client = new HttpClient();
    var html = await client.GetStringAsync(url, ct);   // thread is free while waiting
    return ExtractTitle(html);                          // continues when data arrives
}
```

This matters because a server has a limited number of threads. If each request holds a thread while it waits for a database, 200 slow requests can use all of them. With `await`, the same threads serve thousands of waiting requests.

Two kinds of work exist:

- **I/O-bound** (waiting for a disk, network or database): use `async`/`await`. No thread is needed during the wait.
- **CPU-bound** (calculating, parsing, compressing): `async` does not help. On a desktop app, move it to a background thread with `Task.Run`. In a web server, `Task.Run` just moves work to another pool thread and adds overhead, so keep CPU work simple or move it to a background worker.

### 2. The rules of async code

1. **Async all the way.** If a method awaits, its caller awaits too, up to the entry point. Do not mix blocking and async.
2. **Never block on a task.** Avoid `.Result`, `.Wait()` and `.GetAwaiter().GetResult()` in application code.
3. **Return `Task`, not `void`.** `async void` is only for event handlers. Exceptions in `async void` can crash the process, and the caller cannot await them.
4. **Name async methods with the `Async` suffix.**
5. **Always pass a `CancellationToken`** through the chain.

```csharp
// Bad: blocks a thread and can deadlock in some environments
var user = _service.GetUserAsync(id).Result;

// Good
var user = await _service.GetUserAsync(id, ct);
```

**Why blocking is dangerous:** in a web server it wastes a thread for the whole wait, which leads to *thread pool starvation* (described in [How to find the cause of a production performance issue](how-to-find-the-cause-of-a-production-performance-issue.html)). In desktop and old ASP.NET applications that have a synchronization context, it can cause a real deadlock: the blocked thread waits for the task, and the task waits for that same thread to continue.

### 3. `Task` basics

```csharp
Task<int> task = ComputeAsync();     // starts running right away
// ... do other work ...
int result = await task;             // wait for it here
```

Useful members to know:

| API | Purpose |
| --- | --- |
| `Task.WhenAll(tasks)` | Wait for all tasks. Throws if any failed. |
| `Task.WhenAny(tasks)` | Continue when the first task finishes. |
| `Task.Delay(ts, ct)` | Wait without blocking a thread. |
| `Task.FromResult(x)` | Return a completed task from a sync path. |
| `ValueTask<T>` | A cheaper task for methods that often finish synchronously. Use it only when you have measured a reason. |

Run independent calls at the same time instead of one after another:

```csharp
// Sequential: total time = a + b
var user = await GetUserAsync(id, ct);
var orders = await GetOrdersAsync(id, ct);

// Concurrent: total time = max(a, b)
var userTask = GetUserAsync(id, ct);
var ordersTask = GetOrdersAsync(id, ct);
await Task.WhenAll(userTask, ordersTask);
var (user2, orders2) = (userTask.Result, ordersTask.Result);   // already completed, safe
```

### 4. Cancellation

A `CancellationToken` is how a caller says "stop, I no longer need this". Pass it to every async API that accepts one. In ASP.NET Core, the request's token is cancelled when the client disconnects.

```csharp
app.MapGet("/report", async (ReportService service, CancellationToken ct) =>
{
    var report = await service.BuildAsync(ct);
    return Results.Ok(report);
});

public async Task<Report> BuildAsync(CancellationToken ct)
{
    foreach (var part in _parts)
    {
        ct.ThrowIfCancellationRequested();     // checkpoint in CPU-heavy loops
        await part.LoadAsync(ct);
    }
    return Report.Create(_parts);
}
```

To add a time limit, combine tokens:

```csharp
using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, timeout.Token);
await client.GetAsync(url, linked.Token);
```

Catch `OperationCanceledException` only where you can do something useful. Usually it should travel up and be ignored by the framework.

### 5. Limit parallelism

Starting 10,000 tasks at once can exhaust sockets, memory and downstream services. Always set a limit.

```csharp
await Parallel.ForEachAsync(
    urls,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (url, token) =>
    {
        var data = await client.GetStringAsync(url, token);
        await SaveAsync(url, data, token);
    });
```

For a producer and consumer, use `Channel<T>`. It is a thread-safe, async-friendly queue with optional backpressure:

```csharp
var channel = Channel.CreateBounded<Job>(capacity: 100);

// Producer
await channel.Writer.WriteAsync(job, ct);   // waits when the channel is full
channel.Writer.Complete();

// Consumer
await foreach (var j in channel.Reader.ReadAllAsync(ct))
    await ProcessAsync(j, ct);
```

### 6. Thread safety

Whenever two threads can touch the same data and at least one writes, you need protection. See [How to handle concurrent requests safely](how-to-handle-concurrent-requests-safely.html) for the full picture. The short version:

- Prefer **no shared state**: stateless services, immutable objects, local variables.
- `lock` for short synchronous sections. `SemaphoreSlim` for async sections (you cannot `await` inside a `lock`).
- `Interlocked` for a single counter or flag.
- `ConcurrentDictionary`, `ConcurrentQueue` and `ImmutableDictionary` when you need a shared collection.
- `List<T>` and `Dictionary<K,V>` are **not** thread-safe. Concurrent writes can corrupt them or throw strange errors.

```csharp
// Unsafe: the increment is read-modify-write, not atomic
_counter++;

// Safe
Interlocked.Increment(ref _counter);
```

### 7. Exceptions in async code

An exception thrown in an async method is stored in the returned task, and rethrown when you `await` it. If you never await a task, you never see the exception ("fire and forget" hides failures).

```csharp
// Exception is lost: nobody observes the task
_ = SendEmailAsync(user);

// Handle failures on purpose, or move this to a background queue
try { await SendEmailAsync(user, ct); }
catch (Exception ex) { _logger.LogError(ex, "Email failed for {UserId}", user.Id); }
```

With `Task.WhenAll`, `await` rethrows only the **first** exception. Inspect `task.Exception.InnerExceptions` if you need them all.

For work that should continue after the request ends, use a hosted background service and a queue, not a floating task. See [How to recover from downstream service failure](how-to-recover-from-downstream-service-failure.html) for the outbox idea.

### 8. `ConfigureAwait`

In library code, `await task.ConfigureAwait(false)` tells the runtime that you do not need to return to the original context. ASP.NET Core has no synchronization context, so in an application it makes no difference. Libraries shared with desktop applications should still use it.

## Common mistakes

| Mistake | Result | Fix |
| --- | --- | --- |
| `.Result` or `.Wait()` | Thread starvation, deadlocks | `await` all the way |
| `async void` | Lost exceptions, crashes | Return `Task` |
| Fire and forget | Silent failures | Await, or use a background queue |
| No `CancellationToken` | Work continues after the client left | Pass the token down |
| Unbounded `Task.WhenAll` over thousands of items | Overload | `Parallel.ForEachAsync` with a limit |
| Sharing a `DbContext` between tasks | Random exceptions | One `DbContext` per task or request |
| `Task.Run` in a web request to look "async" | Extra thread use, no benefit | Use real async APIs |
| `lock` around an `await` | Compile error, or a design that blocks | `SemaphoreSlim` |

## Practice plan

1. **Parallel downloader.** Download 100 URLs, five at a time, with cancellation (press a key to cancel) and a progress line.
2. **Break it on purpose.** In a small web API, write an endpoint that calls `.Result` on a delayed task. Send 200 concurrent requests with a load tool and watch latency and the thread pool counters. Then fix it with `await` and compare.
3. **Pipeline.** Build a producer that reads lines from a file, a `Channel<T>` with a capacity of 50, and three consumers that process lines.
4. **Race condition.** Write code where 100 tasks increment a shared `int` 1,000 times each. Print the result, then fix it with `Interlocked`.

## Are you ready for Level 5?

- [ ] I never block on a task in application code.
- [ ] I pass a `CancellationToken` through my call chain.
- [ ] I can explain why `async` does not mean "another thread".
- [ ] I limit concurrency whenever I process many items.
- [ ] I can explain why a shared `Dictionary` needs protection.
- [ ] I know what happens to an exception in a task nobody awaits.

Previous: [Level 3: Collections and LINQ](level-3-collections-and-linq.html). Next: [Level 5: ASP.NET Core and Data Access](level-5-aspnet-core-and-data-access.html).
