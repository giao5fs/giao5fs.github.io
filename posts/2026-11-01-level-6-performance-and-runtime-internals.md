---
title: "Level 6: Performance and Runtime Internals"
date: 2026-11-01
tags: [dotnet, performance, gc, benchmarking, series]
summary: How the .NET runtime works, how to measure instead of guess, and how to reduce allocations and CPU cost where it matters, using BenchmarkDotNet and diagnostic tools.
---

This is Level 6 of the series [7 Levels of .NET Mastery](7-levels-of-dotnet-mastery.html). At this level you stop treating the runtime as a black box. You learn how memory, the garbage collector and the JIT behave, and you learn the most important performance habit: **measure first.**

## Rule zero: measure before you optimize

Most code is not performance critical. Time spent making a rarely used method 10 times faster is wasted, and the result is usually code that is harder to read. The method is always the same:

1. Define the goal in numbers ("p95 latency under 200 ms").
2. Measure the current state with a realistic workload.
3. Find the bottleneck with a profiler, not a guess.
4. Change one thing.
5. Measure again, and keep the change only if the number improved.

Often the biggest wins are not in C# at all: a missing database index, a chatty network call or a lack of caching. Look at [How to find the cause of a production performance issue](how-to-find-the-cause-of-a-production-performance-issue.html) before you start tuning allocations.

## What you should know

### 1. Value types, reference types and the stack and heap

- A **value type** (`int`, `struct`, `enum`) is stored where it is declared: on the stack for locals, or inside the object that contains it. It is copied on assignment.
- A **reference type** (`class`, `string`, arrays, delegates) lives on the managed **heap**. Variables hold a reference.

Allocating on the heap costs more than using the stack, and the garbage collector must later clean those objects up. That is why reducing allocations in hot code reduces GC work.

**Boxing** happens when a value type is converted to `object` or an interface. It allocates a new object on the heap each time.

```csharp
int n = 42;
object boxed = n;               // allocation
int back = (int)boxed;          // unboxing

// Hidden boxing: non-generic collections and some string formatting
var list = new ArrayList();
list.Add(1);                    // boxes
var better = new List<int>();   // no boxing
better.Add(1);
```

### 2. The garbage collector

The GC frees memory for objects that nothing references. .NET uses **generations**, based on the observation that most objects die young.

| Generation | Contains | Collected |
| --- | --- | --- |
| Gen 0 | New, short-lived objects | Very often, very cheap |
| Gen 1 | Objects that survived one collection | Sometimes |
| Gen 2 | Long-lived objects | Rarely, and it is expensive |
| Large Object Heap (LOH) | Objects above about 85,000 bytes | Together with Gen 2 |

What this means for you:

- Short-lived objects are cheap. Do not fear small allocations in normal code.
- Many allocations mean many Gen 0 collections, which add small pauses and CPU use.
- Objects that survive long enough to reach Gen 2 and then die make Gen 2 collections expensive.
- Big arrays and strings go on the LOH. Repeatedly allocating large buffers is a classic cause of high memory and pauses.

Know two GC modes: **Workstation** (default for desktop) and **Server** (more heaps and threads, higher throughput for services). Concurrent (background) GC reduces pauses. Container limits affect both, so check them when a containerized service behaves badly.

For memory growth problems, see [How to diagnose a memory leak in .NET](how-to-diagnose-a-memory-leak.html).

### 3. Reduce allocations in hot paths

Find hot paths first. Then use these techniques where a measurement supports them.

**Avoid creating intermediate strings.**

```csharp
// Allocates a new string for each part
var parts = line.Split(',');
var total = parts.Select(int.Parse).Sum();

// No allocations: work on slices of the original memory
static int SumCsv(ReadOnlySpan<char> line)
{
    var sum = 0;
    while (!line.IsEmpty)
    {
        var comma = line.IndexOf(',');
        var part = comma < 0 ? line : line[..comma];
        sum += int.Parse(part);
        line = comma < 0 ? default : line[(comma + 1)..];
    }
    return sum;
}
```

`Span<T>` is a window over memory (an array, a stack buffer or a slice of a string) with no copying. It is a `ref struct`, so it cannot be stored in a field of a class or used across an `await`. `Memory<T>` is the version you can store and pass around async code.

**Reuse buffers.**

```csharp
var buffer = ArrayPool<byte>.Shared.Rent(8192);
try
{
    var read = await stream.ReadAsync(buffer.AsMemory(0, 8192), ct);
    Process(buffer.AsSpan(0, read));
}
finally
{
    ArrayPool<byte>.Shared.Return(buffer);
}
```

**Use `StringBuilder`, `string.Create` or interpolated string handlers** for building strings in loops, and avoid `+=` in loops.

**Avoid hidden allocations from LINQ and closures in tight loops.** A `foreach` over an array or `List<T>` allocates nothing. A LINQ chain allocates iterator objects and delegates. In a hot loop, a plain loop can be several times faster. In a normal request handler, the readability of LINQ is almost always worth it.

```csharp
// A lambda that captures a local variable allocates a closure object
var result = items.Where(i => i.Price > minPrice).ToList();

// A static lambda cannot capture, so the compiler can cache it
Func<Item, bool> isFree = static i => i.Price == 0;
```

**Use `struct` carefully.** A small, immutable struct avoids a heap allocation, but copying a large struct is slower than passing a reference. Mark structs `readonly`, keep them small (about 16 bytes or less) and measure.

### 4. The JIT and tiered compilation

C# compiles to intermediate language (IL). At run time the **JIT** turns IL into machine code. With **tiered compilation**, a method is first compiled quickly with little optimization (tier 0), and rebuilt with full optimization (tier 1) once it is called often.

Consequences:

- The first requests after startup are slower. This is "warm-up".
- A benchmark of a few calls measures the unoptimized code, which is why you use a proper benchmarking tool.
- Options like ReadyToRun and Native AOT trade peak speed or flexibility for faster startup. They matter for serverless functions and command-line tools.
- **Dynamic PGO** (default in recent .NET versions) uses runtime information to optimize hot paths further, so a long-running service often gets faster after some minutes.

### 5. Benchmark with BenchmarkDotNet

Never time code with `Stopwatch` around a single call. Use BenchmarkDotNet, which handles warm-up, repetition and statistics, and reports allocations.

```csharp
[MemoryDiagnoser]
public class CsvBenchmarks
{
    private const string Line = "12,34,56,78,90,11,22,33,44,55";

    [Benchmark(Baseline = true)]
    public int Split() => Line.Split(',').Select(int.Parse).Sum();

    [Benchmark]
    public int Span() => SumCsv(Line);
}

// Program.cs
BenchmarkRunner.Run<CsvBenchmarks>();
```

Run it in **Release** mode, outside the debugger. Read both columns that matter: the mean time and `Allocated`.

Use realistic input. A benchmark with ten items says little about a system that handles ten million.

### 6. Profile real applications

Benchmarks answer "which version of this code is faster". Profilers answer "where does my application spend time". Learn the main tools:

| Tool | Answers |
| --- | --- |
| `dotnet-counters` | Live numbers: CPU, GC heap size, GC counts, thread pool queue, request rate |
| `dotnet-trace` | CPU sampling and event traces for analysis in PerfView or Visual Studio |
| `dotnet-gcdump` | What is on the managed heap, and what grows |
| `dotnet-dump` | A full memory dump to analyze hangs, crashes and leaks |
| Visual Studio / JetBrains profilers | Call trees, allocation views and hot methods |
| OpenTelemetry traces | Where time goes across services and the database |

A CPU profile sorted by inclusive time points to the method worth improving. Fix the largest item, measure again, and stop when you reach the goal.

### 7. Common performance patterns

- **Cache** data that is expensive to compute and changes rarely. Always set an expiry and a size limit.
- **Batch** work: one query for 100 ids is faster than 100 queries; one HTTP call carrying a list beats a call per item.
- **Stream** large data instead of loading it all: `IAsyncEnumerable<T>`, `Stream`, and `AsNoTracking` reads.
- **Reuse `HttpClient`** through `IHttpClientFactory`. Creating one per request exhausts sockets and adds handshake time.
- **Compile once**: a `Regex` in a loop should be a static field, or use the source-generated `[GeneratedRegex]`.
- **Do less work**: the fastest code is the code that does not run. Return earlier, select fewer columns, avoid repeated calculation.

```csharp
public static partial class Patterns
{
    [GeneratedRegex(@"^\d{3}-\d{4}$", RegexOptions.CultureInvariant)]
    public static partial Regex PhoneNumber();
}
```

## Common mistakes

- Optimizing without measuring, or measuring the wrong thing.
- Benchmarking in Debug mode, or with data that does not match production.
- Micro-optimizing code that is not on the hot path.
- Making code unreadable for a gain of a few nanoseconds.
- Forcing garbage collection with `GC.Collect()`. It almost always makes things worse.
- Ignoring the database and network, which usually dominate the time.
- Caching without eviction, which turns a speed fix into a memory leak.

## Practice plan

1. **Benchmark two versions** of one function (for example, `Split` versus `Span`) with BenchmarkDotNet and `[MemoryDiagnoser]`. Explain every difference in the allocation column.
2. **Observe the GC.** Write a loop that allocates many small objects and watch Gen 0, Gen 1 and Gen 2 counts in `dotnet-counters`. Then keep references to them in a list and watch what changes.
3. **Profile a real endpoint.** Take your Level 5 API, load test one endpoint, record a CPU trace and find the top three methods. Improve one and show the before and after numbers.
4. **Find a boxing allocation** in some code you have written, remove it and prove it with a benchmark.

## Are you ready for Level 7?

- [ ] I measure before I optimize, and I record numbers before and after a change.
- [ ] I can explain what triggers a Gen 2 collection and why the LOH matters.
- [ ] I know when an allocation matters and when it does not.
- [ ] I can write and read a BenchmarkDotNet result.
- [ ] I can use `dotnet-counters` and a profiler on a running application.
- [ ] I check the database and network before tuning C# code.

Previous: [Level 5: ASP.NET Core and Data Access](level-5-aspnet-core-and-data-access.html). Next: [Level 7: Production Systems and Reliability](level-7-production-systems-and-reliability.html).
