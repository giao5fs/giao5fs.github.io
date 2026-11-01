---
title: How to Handle Concurrent Requests Safely
date: 2026-11-01
tags: [dotnet, concurrency, ef-core, reliability]
summary: Why two requests at the same time can corrupt your data, and how to prevent it at each layer: in memory, in the database and across multiple servers.
---

One user clicks "Buy" once. Your code works. Two users click "Buy" for the last item in stock at the same instant, and both succeed. The warehouse now owes one customer a product that does not exist.

Bugs like this pass every unit test and appear only under real traffic. A web server handles many requests at the same time, so any code that reads a value, makes a decision and then writes a new value is at risk. This post shows how to make that code safe, starting with the cheapest fix and moving outward.

## The core problem: check-then-act

Almost every concurrency bug has the same shape. The code **checks** a condition and then **acts** on it, and another request changes the world between the two steps.

```csharp
// Unsafe: two requests can both pass the check
var product = await db.Products.FindAsync(id);
if (product.Stock >= quantity)
{
    product.Stock -= quantity;      // both requests subtract from the same old value
    await db.SaveChangesAsync();
}
```

Request A and request B both read `Stock = 1`. Both see enough stock. Both save. Depending on timing, one update is lost, or the stock goes negative. This is called a **race condition**, and it cannot be fixed by "being careful". It needs a mechanism that makes the check and the act happen as one unit.

## Layer 1: Share less

The safest concurrent code is code that shares nothing.

- Keep services **stateless**. Keep request data in method parameters and local variables, not in fields.
- Prefer **immutable** objects (`record` types, `readonly` fields). Data that cannot change cannot be corrupted.
- Remember that `DbContext` is **not thread-safe**. Use one per request (the default `Scoped` lifetime) and never share it between parallel tasks.
- Be careful with `static` fields and singletons. Anything mutable in them is shared by every request.

Many "concurrency problems" disappear after this step, because the shared state was never needed.

## Layer 2: Protect shared state in memory

When shared mutable state is unavoidable, protect it.

**Use `lock` for short, synchronous sections:**

```csharp
private readonly object _gate = new();
private int _count;

public void Increment()
{
    lock (_gate) { _count++; }
}
// For a single counter, Interlocked.Increment(ref _count) is cheaper still.
```

**Do not `await` inside a `lock`.** It does not compile, and for a good reason. Use `SemaphoreSlim` for async code:

```csharp
private readonly SemaphoreSlim _gate = new(1, 1);

public async Task RefreshAsync(CancellationToken ct)
{
    await _gate.WaitAsync(ct);
    try
    {
        await ReloadSettingsAsync(ct);
    }
    finally
    {
        _gate.Release();   // always release, even if the work throws
    }
}
```

**Know the limits of `ConcurrentDictionary`.** Its methods are thread-safe, but the factory passed to `GetOrAdd` can run more than once when two threads race. If the factory is expensive or has side effects, wrap the value in `Lazy<T>`:

```csharp
var lazy = _cache.GetOrAdd(key, k => new Lazy<Task<Data>>(() => LoadAsync(k)));
return await lazy.Value;   // only one thread runs LoadAsync for this key
```

(If `LoadAsync` can fail, remove the failed entry so the error is not cached.)

## Layer 3: Let the database decide

In-memory locks protect one process. Your data lives in a database that every request, and every server, shares. This is where most real protection belongs, and there are three good tools.

### Option A: One atomic statement

Often the best fix is to remove the separate read. Let the database check and update in one statement:

```csharp
var updated = await db.Products
    .Where(p => p.Id == id && p.Stock >= quantity)
    .ExecuteUpdateAsync(
        s => s.SetProperty(p => p.Stock, p => p.Stock - quantity), ct);

if (updated == 0)
    return Results.Conflict("Not enough stock.");
```

This produces a single `UPDATE ... WHERE Stock >= @quantity`. The database makes it atomic, so two requests cannot both take the last item. No lock is held between a read and a write, so it also scales well.

### Option B: Optimistic concurrency

When you must load an entity, edit it and save it, add a **concurrency token**. EF Core then refuses to save if someone else changed the row after you read it.

```csharp
public class Product
{
    public int Id { get; set; }
    public int Stock { get; set; }

    [Timestamp]
    public byte[] RowVersion { get; set; } = [];
}
```

```csharp
try
{
    product.Stock -= quantity;
    await db.SaveChangesAsync(ct);
}
catch (DbUpdateConcurrencyException)
{
    // Someone else changed this row first: reload and retry, or tell the caller
    return Results.Conflict("The item was changed by someone else. Please try again.");
}
```

"Optimistic" means you assume conflicts are rare, hold no locks, and handle the unlucky case when it happens. It is the right default for most business data.

### Option C: Pessimistic locking and transactions

If conflicts are frequent and a retry is expensive, lock the row while you work, for example with `SELECT ... WITH (UPDLOCK)` in SQL Server or `FOR UPDATE` in PostgreSQL, inside a transaction. This is simple to reason about, but it makes requests wait for each other, so keep the transaction short and never call another service inside it.

Also use **unique constraints and foreign keys** as a last line of defense. A unique index on `(UserId, CouponCode)` prevents a double redemption no matter how many requests arrive, and no application bug can bypass it.

## Layer 4: Multiple servers and repeated requests

If your application runs on more than one instance, a `lock` or a `SemaphoreSlim` protects only one of them. Two servers can still collide, which is another reason the database layer is the real protection.

Another source of "concurrent" requests is **retries**. A client times out and sends the same request again, while the first one is still running. The fix is **idempotency**: a request carries a unique key, and processing the same key twice has the same effect as processing it once.

```csharp
// Idempotency-Key header; the table has a UNIQUE index on Key
try
{
    db.ProcessedRequests.Add(new ProcessedRequest { Key = key });
    await db.SaveChangesAsync(ct);
}
catch (DbUpdateException)
{
    return Results.Ok(await LoadPreviousResultAsync(key, ct));   // already handled
}

// ...perform the operation...
```

When you need a lock across servers (for example a scheduled job that must run on only one instance), use a distributed lock such as a database lock or a Redis-based lock. Treat these carefully: they can expire while work is still running, so the work itself should still be safe to repeat.

## Choosing the right tool

| Situation | Reach for |
| --- | --- |
| Mutable state that nobody needs to share | Remove the sharing |
| Short in-memory critical section | `lock`, `Interlocked` |
| Async in-memory critical section | `SemaphoreSlim` |
| Counter or stock update | Atomic `UPDATE` with `ExecuteUpdateAsync` |
| Edit-and-save of a record, conflicts rare | Optimistic concurrency token |
| Frequent conflicts, short work | Row lock in a transaction |
| Duplicates must be impossible | Unique constraint |
| Clients retry requests | Idempotency key |

## How to test it

Concurrency bugs do not show up in a single-request test. Write a test that fires many requests at once and asserts the outcome:

```csharp
var tasks = Enumerable.Range(0, 50)
    .Select(_ => client.PostAsync("/orders", content));
var responses = await Task.WhenAll(tasks);

Assert.Equal(1, responses.Count(r => r.IsSuccessStatusCode));   // only one wins the last item
```

Run it against a real database, not an in-memory fake, because the guarantees you are testing come from the database engine.

## Summary

- A race condition happens when code **checks and then acts**, and the world changes in between.
- Share as little mutable state as you can.
- Use `lock` or `SemaphoreSlim` only for in-memory state, and know that they stop at the process boundary.
- Let the database enforce the rules: atomic updates, concurrency tokens and unique constraints.
- Make operations idempotent, because retries create concurrency you did not plan for.
- Test with many simultaneous requests against a real database.
