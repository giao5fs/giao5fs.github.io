---
title: How to Diagnose a Memory Leak in .NET
date: 2026-11-01
tags: [dotnet, debugging, memory, performance]
summary: A step-by-step method to confirm a memory leak, capture evidence with dotnet-counters and dotnet-gcdump, and trace the objects back to the root that keeps them alive.
---

The alert says memory is at 90% and still climbing. A restart fixes it for a day. Is it a leak, or is the garbage collector just doing its job?

Diagnosing a leak is a detective task. The goal is not to guess a cause, but to collect evidence in a fixed order: confirm the problem, find which objects grow, and find what keeps them alive. This post follows that order.

## Step 1: Confirm it is really a leak

A .NET process is allowed to use a lot of memory. The garbage collector (GC) often keeps memory it could release, because reusing it is cheaper than asking the operating system again. High memory alone is not a leak. A leak has a specific shape: **memory that is still in use after a full collection keeps growing over time.**

Watch the process for a while with `dotnet-counters`:

```bash
dotnet tool install --global dotnet-counters
dotnet-counters monitor --process-id <pid> System.Runtime
```

Counter names differ slightly between .NET versions. Look for these three values:

| Counter | What to look for |
| --- | --- |
| GC heap size | Climbs steadily and never returns to a lower baseline |
| Gen 2 collection count | Gen 2 collections happen, yet the heap does not shrink afterwards |
| Working set | Compare with the GC heap size (see Step 2) |

If the heap grows during a traffic spike and falls back afterwards, that is normal. If the "low point" after each Gen 2 collection is higher than the last one, you have a leak.

## Step 2: Decide whether it is managed or native memory

Compare the GC heap size with the process working set.

- **GC heap grows with the working set:** managed objects are being retained. Continue with Step 3.
- **GC heap stays flat but the working set grows:** the leak is outside the managed heap. Suspect native libraries, unmanaged resources that are never disposed (`IDisposable`), pinned buffers, or memory fragmentation.

This check saves hours. Taking heap dumps of a managed heap that is not growing will show you nothing.

## Step 3: Capture two snapshots and compare them

One snapshot tells you what the heap holds. Two snapshots tell you what is **growing**. Take the first one after the application has warmed up, run realistic load for a while, then take the second.

```bash
dotnet tool install --global dotnet-gcdump
dotnet-gcdump collect --process-id <pid> --output before.gcdump
# ...apply load for 10-30 minutes...
dotnet-gcdump collect --process-id <pid> --output after.gcdump
```

Open both files in Visual Studio (or PerfView) and compare the type tables. A command-line summary is also available:

```bash
dotnet-gcdump report after.gcdump
```

Look for a type whose instance count and size grew between the two files. Ignore `string` and `byte[]` at first, since they are always large. Ask instead: which of **my** types, or which collection type holding my objects, keeps increasing?

## Step 4: Find what keeps the objects alive

An object leaks because something still has a reference to it. That "something" is called a **GC root**. To find it, take a full dump and use the analyzer:

```bash
dotnet tool install --global dotnet-dump
dotnet-dump collect --process-id <pid>
dotnet-dump analyze <dumpfile>
```

Inside the analyzer, three commands do most of the work:

```text
> dumpheap -stat              # types ordered by total size
> dumpheap -type OrderCache   # list the instances of one type
> gcroot <object-address>     # show the reference chain from a root to this object
```

The output of `gcroot` is the answer you are looking for. It reads like a path: a static field, which holds a dictionary, which holds a list, which holds your object. Read it from the root down and the cause is usually obvious.

## The usual suspects

Most leaks in real systems come from a short list.

**1. A static or singleton collection that only grows.** A cache, a registry or a "seen ids" set with no eviction policy.

```csharp
public class PriceService
{
    // Never shrinks: one entry per customer, forever
    private static readonly Dictionary<int, Price> _cache = new();

    public Price Get(int customerId) =>
        _cache.TryGetValue(customerId, out var p) ? p : _cache[customerId] = Load(customerId);
}
```

Use a cache that has limits and expiry, such as `IMemoryCache` with a size limit:

```csharp
builder.Services.AddMemoryCache(o => o.SizeLimit = 10_000);

_cache.Set(customerId, price, new MemoryCacheEntryOptions
{
    Size = 1,
    AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10)
});
```

**2. Event handlers that are never removed.** A long-lived publisher keeps every subscriber alive.

```csharp
public sealed class Dashboard : IDisposable
{
    private readonly PriceFeed _feed;

    public Dashboard(PriceFeed feed)
    {
        _feed = feed;
        _feed.PriceChanged += OnPriceChanged;   // feed now references this object
    }

    public void Dispose() => _feed.PriceChanged -= OnPriceChanged;  // the fix

    private void OnPriceChanged(object? sender, PriceEventArgs e) { /* ... */ }
}
```

**3. Captured variables and timers.** A lambda or a `Timer` callback that captures a large object keeps it alive for as long as the timer runs.

**4. A scoped object captured by a singleton.** A singleton holding a `DbContext` keeps its entire change tracker, and every entity it ever loaded, in memory.

**5. Undisposed resources.** Streams, `HttpResponseMessage`, timers and native handles that nobody disposes. These often show up as native memory growth rather than a growing managed heap.

**6. Large Object Heap fragmentation.** Arrays larger than about 85,000 bytes go to the Large Object Heap. Repeatedly allocating buffers of changing sizes can leave the heap fragmented, so memory is reserved but poorly reused. Pooling buffers with `ArrayPool<byte>` is the usual remedy.

## Step 5: Fix it and prove it

A fix is not finished until you have measured it. Repeat the same test:

1. Deploy the change to a test environment.
2. Run the same load for the same duration.
3. Watch the same counters.

The "low point" of the heap after each Gen 2 collection should now stay flat. Keep the dashboards that showed the problem, and add an alert on the post-collection heap size so that the next leak is caught in hours and not weeks.

## A checklist to keep

- Confirm the pattern: the post-GC heap grows over time.
- Compare the GC heap with the working set to separate managed from native.
- Take two `dotnet-gcdump` snapshots and compare them.
- Use `gcroot` to find the reference chain, and read it from the root.
- Check the usual suspects: static collections, event handlers, captured scopes, undisposed resources.
- Verify the fix with the same load test.

Memory leaks feel mysterious because their symptom appears far from their cause. A fixed order of questions turns the mystery into a short investigation. If the leak turns out to be a performance problem in disguise, the method in [How to find the cause of a production performance issue](how-to-find-the-cause-of-a-production-performance-issue.html) is the next step.
