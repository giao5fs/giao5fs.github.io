---
title: "Level 1: C# Fundamentals"
date: 2026-11-01
tags: [dotnet, csharp, fundamentals, series]
summary: The base of everything in .NET. What to learn in C#, the habits that keep code correct from day one, and a practice plan to prove you are ready for Level 2.
---

This is Level 1 of the series [7 Levels of .NET Mastery](7-levels-of-dotnet-mastery.html). Every later level depends on this one. A developer who skips it can still ship features, but spends years confused by bugs that a solid base would have prevented.

The goal of this level is not to know every keyword. It is to write **correct, readable C# without guessing**, and to read the compiler's messages as help instead of noise.

## What you should know

### 1. Types, values and null

C# is a statically typed language. Every variable has a type, and the compiler checks it. Learn the built-in types (`int`, `long`, `decimal`, `double`, `bool`, `char`, `string`) and when each is the right choice.

- Use `decimal` for money. `double` and `float` are binary floating point and cannot represent `0.1` exactly.
- Use `DateTimeOffset` for points in time, and store them in UTC.
- Use `var` when the type is obvious on the right side, and an explicit type when it helps the reader.

```csharp
Console.WriteLine(0.1 + 0.2 == 0.3);        // False (double)
Console.WriteLine(0.1m + 0.2m == 0.3m);     // True  (decimal)
```

Turn on **nullable reference types** in every project (`<Nullable>enable</Nullable>`). Then the compiler tells you where a value may be `null`:

```csharp
string? middleName = GetMiddleName();   // may be null: the ? says so
string name = GetName();                // promise: never null

Console.WriteLine(middleName.Length);   // warning: possible null reference
Console.WriteLine(middleName?.Length ?? 0);   // safe
```

Treat these warnings as errors in new code. Silencing them with `!` hides the problem instead of removing it.

### 2. Control flow and pattern matching

`if`, `switch`, `for`, `foreach` and `while` are the basics. Modern C# adds **switch expressions and patterns**, which make branching shorter and safer.

```csharp
public static string Classify(int temperature) => temperature switch
{
    < 0   => "freezing",
    < 15  => "cold",
    < 25  => "mild",
    _     => "hot"
};

public static decimal ShippingCost(Order order) => order switch
{
    { Total: >= 100 }                => 0m,
    { Country: "VN", Weight: < 2 }   => 15_000m,
    { Country: "VN" }                => 30_000m,
    _                                => 120_000m
};
```

Use a `foreach` when you only read each item, and a `for` loop when you need the index. Avoid changing a collection while looping over it, because it throws an exception.

### 3. Methods and parameters

Learn how parameters work: by value (default), `ref`, `out`, `in`, optional parameters and named arguments. Keep methods small and give each one a single clear job.

```csharp
public static bool TryParsePort(string? text, out int port)
{
    port = 0;
    return int.TryParse(text, out var value)
        && value is >= 1 and <= 65535
        && (port = value) > 0;
}
```

A good rule: if you need a comment to explain **what** a block does, extract it into a method with a good name instead.

### 4. Strings

Strings are immutable. Every change creates a new string, so building one in a loop with `+=` is slow for large inputs.

```csharp
// Slow for thousands of items: creates a new string each time
var result = "";
foreach (var item in items) result += item + ",";

// Better
var sb = new StringBuilder();
foreach (var item in items) sb.Append(item).Append(',');

// Often best: let the library do it
var joined = string.Join(',', items);
```

Learn string interpolation (`$"Hello {name}"`), raw string literals (`"""..."""`), and the culture rules. Compare strings with an explicit comparison, and parse numbers with `CultureInfo.InvariantCulture` when the data is not meant for a human reader:

```csharp
if (string.Equals(a, b, StringComparison.OrdinalIgnoreCase)) { /* ... */ }
var price = decimal.Parse("1234.56", CultureInfo.InvariantCulture);
```

### 5. Exceptions

An exception means "something went wrong that this code cannot handle here". It is not a way to return normal results.

```csharp
// Bad: using an exception for a case that is expected
try { return int.Parse(input); }
catch (FormatException) { return 0; }

// Good: the failure is part of the normal flow
return int.TryParse(input, out var n) ? n : 0;
```

Rules to remember:

- Catch only the exceptions you can handle. Never write an empty `catch { }`.
- Use `throw;` to rethrow, not `throw ex;`, which resets the stack trace.
- Use `finally` or `using` to release resources.
- Validate arguments at the start of public methods (`ArgumentNullException.ThrowIfNull(x)`).

### 6. Resources and `IDisposable`

Files, sockets, database connections and streams hold resources that the garbage collector does not release in a timely way. Anything that implements `IDisposable` must be disposed. The `using` declaration makes this easy:

```csharp
using var stream = File.OpenRead(path);
using var reader = new StreamReader(stream);
var firstLine = await reader.ReadLineAsync();
// both are disposed at the end of the method, even if an exception occurs
```

### 7. Records, tuples and local functions

A `record` is a short way to write a type that is mostly data, with value-based equality:

```csharp
public record Point(int X, int Y);

var a = new Point(1, 2);
var b = new Point(1, 2);
Console.WriteLine(a == b);        // True
var c = a with { X = 10 };        // copy with one change
```

## Common mistakes

| Mistake | Why it hurts | Better |
| --- | --- | --- |
| `double` for money | Rounding errors that add up | `decimal` |
| Ignoring nullable warnings | Null reference exceptions in production | Fix the design, or handle null |
| `catch (Exception) { }` | Hides real failures | Catch specific types, log, or let it bubble |
| Comparing strings with `==` when case or culture matters | Wrong results for some inputs | `StringComparison.OrdinalIgnoreCase` |
| Forgetting `using` on streams | Locked files, leaked handles | `using var` |
| Long methods with many `if` levels | Hard to read and test | Extract methods, return early |

## A short style guide

- Names: `PascalCase` for types and methods, `camelCase` for locals and parameters, `_camelCase` for private fields.
- Prefer early returns to deeply nested `if` blocks.
- One class per file, and file names equal to the type name.
- Use `dotnet format` and an `.editorconfig` so style is never a discussion.

## Practice plan

Do these without a web framework. The point is to feel the language.

1. **Word counter.** Read a text file and print the ten most frequent words. Handle a missing file with a clear message.
2. **Temperature report.** Parse a CSV of daily temperatures. Skip bad lines, count them, and print the min, max and average.
3. **Expression calculator.** Read `12 + 7 * 3` from the console and print the result. Use a `switch` expression for operators.
4. **Tiny bank account.** A class with `Deposit` and `Withdraw`. Throw on invalid input, and write tests for each rule.

Run each one with nullable warnings turned on, and fix every warning.

## Are you ready for Level 2?

You are ready when you can say yes to all of these:

- [ ] I can read unfamiliar C# without stopping at the syntax.
- [ ] I know why `decimal` is used for money and `DateTimeOffset` for time.
- [ ] I fix nullable warnings instead of silencing them.
- [ ] I use `TryParse`-style methods instead of catching exceptions for normal cases.
- [ ] I dispose of every `IDisposable` I create.
- [ ] I can write a `switch` expression with property patterns.

Next: [Level 2: Types and OOP Design](level-2-types-and-oop-design.html).
