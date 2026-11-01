---
title: "Level 3: Collections and LINQ"
date: 2026-11-01
tags: [dotnet, csharp, linq, collections, series]
summary: Choosing the right collection by cost, writing LINQ that is correct and readable, and understanding deferred execution, the source of many subtle bugs.
---

This is Level 3 of the series [7 Levels of .NET Mastery](7-levels-of-dotnet-mastery.html). Almost every program is about collections of data: orders, users, log lines, prices. At this level you learn to **store data in the right structure** and **query it clearly**.

## What you should know

### 1. Pick a collection by how you use it

Each collection makes some operations cheap and others expensive. Ask three questions: Do I look items up by key? Does order matter? Must items be unique?

| Collection | Lookup | Add | Keeps order | Use it when |
| --- | --- | --- | --- | --- |
| `List<T>` | By index O(1), by value O(n) | End O(1) | Yes | Ordered items you mostly loop over |
| `Dictionary<K,V>` | By key O(1) | O(1) | No guarantee | Fast lookup by a key |
| `HashSet<T>` | Contains O(1) | O(1) | No | Uniqueness, "have I seen this?" |
| `Queue<T>` | Peek O(1) | Enqueue O(1) | FIFO | Work waiting to be processed |
| `Stack<T>` | Peek O(1) | Push O(1) | LIFO | Undo, parsing, depth-first search |
| `SortedDictionary<K,V>` | O(log n) | O(log n) | By key | Data that must stay sorted |
| `ImmutableList<T>` | O(log n) | O(log n) | Yes | Safe sharing without copying by hand |

A typical beginner mistake is searching a list inside a loop:

```csharp
// O(n * m): for each order, scan the whole customer list
foreach (var order in orders)
{
    var customer = customers.First(c => c.Id == order.CustomerId);
    Print(order, customer);
}

// O(n + m): build a dictionary once, then look up in constant time
var byId = customers.ToDictionary(c => c.Id);
foreach (var order in orders)
{
    var customer = byId[order.CustomerId];
    Print(order, customer);
}
```

With 10,000 orders and 10,000 customers, the first version does about 50 million comparisons on average. The second does 20,000 steps.

### 2. Expose the right type

Return the narrowest interface that fits.

- `IEnumerable<T>`: the caller will only loop over the items.
- `IReadOnlyList<T>`: the caller needs a count and indexing, but no changes.
- `IReadOnlyDictionary<K,V>`: lookup only.
- `List<T>`, `Dictionary<K,V>`: only inside a method, or when the caller truly owns and changes it.

```csharp
public IReadOnlyList<OrderLine> Lines => _lines;
```

Accept the widest type that works (`IEnumerable<T>`) and return a specific one (`IReadOnlyList<T>`).

### 3. LINQ: describe what you want

LINQ turns loops into a readable pipeline.

```csharp
var topCustomers = orders
    .Where(o => o.Status == OrderStatus.Paid)
    .GroupBy(o => o.CustomerId)
    .Select(g => new
    {
        CustomerId = g.Key,
        Orders = g.Count(),
        Total = g.Sum(o => o.Total)
    })
    .OrderByDescending(x => x.Total)
    .Take(10)
    .ToList();
```

Learn these operators well. They cover most daily work:

| Goal | Operators |
| --- | --- |
| Filter | `Where`, `OfType`, `Distinct` |
| Transform | `Select`, `SelectMany` |
| Order | `OrderBy`, `ThenBy`, `OrderByDescending` |
| Group and total | `GroupBy`, `Sum`, `Average`, `Min`, `Max`, `Count` |
| Test | `Any`, `All`, `Contains` |
| Pick | `First`, `FirstOrDefault`, `Single`, `Take`, `Skip` |
| Combine | `Join`, `Zip`, `Concat`, `Union`, `Intersect`, `Except` |
| Convert | `ToList`, `ToArray`, `ToDictionary`, `ToHashSet`, `ToLookup` |

Some helpful newer ones: `Chunk` (split into batches), `MaxBy` and `MinBy`, `DistinctBy`, and `CountBy` in recent .NET versions.

```csharp
var cheapestPerCategory = products
    .GroupBy(p => p.Category)
    .Select(g => g.MinBy(p => p.Price)!);

foreach (var batch in ids.Chunk(100))
    await SendBatchAsync(batch);
```

### 4. Deferred execution

This is the idea that matters most at this level. A LINQ query such as `Where` or `Select` does **not run when you write it**. It runs when you enumerate it, and it runs again every time you enumerate it.

```csharp
var query = orders.Where(o => IsExpensive(o));   // nothing has run

var count = query.Count();     // runs the filter over all orders
var first = query.First();     // runs it again
```

If `IsExpensive` is slow, or if `orders` is a database query, you have just paid twice. If the source changes between the two calls, the results can disagree. Materialize once when you need the data more than once:

```csharp
var expensive = orders.Where(IsExpensive).ToList();   // runs once
var count = expensive.Count;
var first = expensive[0];
```

The reverse mistake exists too: calling `ToList()` too early in a long pipeline, which loads everything into memory before filtering. Filter first, then materialize.

**Captured variables** can also surprise you with deferred execution:

```csharp
var threshold = 10;
var query = numbers.Where(n => n > threshold);
threshold = 100;                 // changes the result of the query above
Console.WriteLine(query.Count());
```

### 5. `IEnumerable<T>` versus `IQueryable<T>`

LINQ over a list in memory is **executed by your program**. LINQ over `IQueryable<T>` (EF Core, for example) is **translated to SQL** and executed by the database. They look the same and behave very differently.

```csharp
// Translated to SQL: only matching rows leave the database
var paid = await db.Orders
    .Where(o => o.Status == OrderStatus.Paid)
    .ToListAsync(ct);

// AsEnumerable switches to in-memory: every row is loaded first
var bad = db.Orders
    .AsEnumerable()
    .Where(o => o.Status == OrderStatus.Paid)
    .ToList();
```

Use only expressions the provider can translate. A custom C# method inside a `Where` for EF Core may fail, or silently load the whole table. Read more about this in [Level 5](level-5-aspnet-core-and-data-access.html).

### 6. Safe element access

| Method | When nothing matches | When many match |
| --- | --- | --- |
| `First` | Throws | Returns the first |
| `FirstOrDefault` | Returns default (`null` for classes) | Returns the first |
| `Single` | Throws | Throws |
| `SingleOrDefault` | Returns default | Throws |

Use `Single` when "exactly one" is a rule that must hold, and let it fail loudly if the data breaks that rule. Use `FirstOrDefault` when "none" is a normal outcome, and check for it.

### 7. Sorting, equality and keys

- `OrderBy` is a **stable** sort: items with equal keys keep their original order.
- A dictionary key needs correct `Equals` and `GetHashCode`. Records give you both. A class without them compares by reference.
- Never use a mutable object as a key if the part that decides equality can change after insertion, because the item gets lost in the dictionary.
- For text keys, choose a comparer on purpose: `new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase)`.

## Common mistakes

- Enumerating a deferred query many times.
- `list.Count() > 0` when `list.Any()` (or `list.Count > 0`) says it better and may be faster.
- `OrderBy` followed by another `OrderBy`, which discards the first sort. Use `ThenBy`.
- Modifying a collection inside `foreach`, which throws `InvalidOperationException`.
- Using `List<T>.Contains` in a loop on a large list instead of a `HashSet<T>`.
- A giant LINQ expression with five nested levels. Split it into named steps.

```csharp
// Hard to read
var r = a.Where(x => b.Any(y => y.Id == x.Id && c.Contains(y.Code))).Select(x => x.Name);

// Easier to read and debug
var validCodes = c.ToHashSet();
var matchingIds = b.Where(y => validCodes.Contains(y.Code)).Select(y => y.Id).ToHashSet();
var names = a.Where(x => matchingIds.Contains(x.Id)).Select(x => x.Name);
```

## Practice plan

1. **CSV questions.** Take a CSV file with a few thousand rows (sales, taxi trips, anything). Answer five questions using only LINQ: top ten by total, average per month, items sold in more than three regions, the latest record per customer, and duplicates.
2. **Speed up a join.** Write the "list inside a loop" version and the "dictionary" version, run both on 20,000 items and measure the time.
3. **Prove deferred execution.** Add a `Console.WriteLine` inside a `Where` lambda and count how many times it prints for each of your queries.
4. **Batch processing.** Process 1,050 ids in batches of 100 with `Chunk`.

## Are you ready for Level 4?

- [ ] I choose a collection by how it will be used, not by habit.
- [ ] I can predict when a LINQ query actually runs.
- [ ] I materialize results once when I need them more than once.
- [ ] I know the difference between in-memory LINQ and LINQ translated to SQL.
- [ ] I use `Single`, `First` and their `OrDefault` versions on purpose.

Previous: [Level 2: Types and OOP Design](level-2-types-and-oop-design.html). Next: [Level 4: Async and Concurrency](level-4-async-and-concurrency.html).
