---
title: "Level 2: Types and OOP Design"
date: 2026-11-01
tags: [dotnet, csharp, design, series]
summary: How to model a problem with clear types. Classes, structs and records, interfaces, composition over inheritance, and the SOLID principles used as guidelines.
---

This is Level 2 of the series [7 Levels of .NET Mastery](7-levels-of-dotnet-mastery.html). At Level 1 you learned the language. At this level you learn how to **shape code** so it stays easy to change.

Good design here is not about patterns with famous names. It is about one question: *where should each piece of knowledge live?* A rule that lives in one type is easy to change. A rule copied across ten methods is a bug waiting to happen.

## What you should know

### 1. Class, struct or record

These three look similar and behave differently.

| Kind | Semantics | Use it for |
| --- | --- | --- |
| `class` | Reference type, identity equality by default | Objects with identity and behavior: `Order`, `Customer`, services |
| `struct` | Value type, copied on assignment | Small, immutable values: `Point`, `Money` in hot code |
| `record` (class) | Reference type, value equality, immutable by convention | Data carriers and value objects: DTOs, `Money`, `Address` |
| `record struct` | Value type with value equality | Small value objects that must not allocate |

A rule of thumb: start with `record` for data, `class` for behavior, and use `struct` only when you have measured a reason.

```csharp
public sealed record Address(string Street, string City, string Country);

public sealed class Customer
{
    public Customer(Guid id, string name, Address address)
    {
        Id = id;
        Name = name;
        Address = address;
    }

    public Guid Id { get; }                 // identity
    public string Name { get; private set; }
    public Address Address { get; private set; }

    public void MoveTo(Address newAddress) => Address = newAddress;
}
```

Two `Address` values with the same data are equal. Two `Customer` objects with the same name are still different customers, because identity is the `Id`.

### 2. Encapsulation: protect your rules

A type should not let other code put it in an invalid state. Make setters private, validate in the constructor, and expose behavior instead of raw fields.

```csharp
public sealed class ShoppingCart
{
    private readonly List<CartLine> _lines = new();

    public IReadOnlyList<CartLine> Lines => _lines;

    public void Add(Product product, int quantity)
    {
        if (quantity <= 0)
            throw new ArgumentOutOfRangeException(nameof(quantity), "Quantity must be positive.");

        var existing = _lines.Find(l => l.ProductId == product.Id);
        if (existing is null)
            _lines.Add(new CartLine(product.Id, product.Price, quantity));
        else
            existing.Increase(quantity);
    }

    public decimal Total => _lines.Sum(l => l.Price * l.Quantity);
}
```

Outside code cannot add a line with a negative quantity, because the only way in is `Add`. This is the core of object-oriented design: **the object guards its own rules.**

### 3. Value objects

A value object wraps a primitive and gives it meaning and rules. It prevents a whole class of mistakes, such as passing a customer id where an order id is expected.

```csharp
public readonly record struct OrderId(Guid Value)
{
    public static OrderId New() => new(Guid.NewGuid());
    public override string ToString() => Value.ToString();
}

public sealed record Money(decimal Amount, string Currency)
{
    public static Money Zero(string currency) => new(0m, currency);

    public Money Add(Money other)
    {
        if (Currency != other.Currency)
            throw new InvalidOperationException("Cannot add different currencies.");
        return this with { Amount = Amount + other.Amount };
    }
}
```

The compiler now refuses `Ship(customerId, orderId)` if the arguments are swapped. That is a bug caught before the program runs.

### 4. Interfaces and abstraction

An interface describes **what** something can do, without saying how. Use one when there are really different implementations, or when you need a seam to isolate a slow or external dependency.

```csharp
public interface IClock
{
    DateTimeOffset UtcNow { get; }
}

public sealed class SystemClock : IClock
{
    public DateTimeOffset UtcNow => DateTimeOffset.UtcNow;
}

public sealed class DiscountPolicy
{
    private readonly IClock _clock;
    public DiscountPolicy(IClock clock) => _clock = clock;

    public decimal Rate() => _clock.UtcNow.DayOfWeek == DayOfWeek.Friday ? 0.1m : 0m;
}
```

In a test you pass a fake `IClock` and the result no longer depends on the day you run the test. (Newer .NET versions also include `TimeProvider`, which does this job in the standard library.)

**Do not create an interface for every class.** An interface with one implementation and no reason to change is only extra code to read.

### 5. Composition over inheritance

Inheritance means "is a" and locks you into a hierarchy. Composition means "has a" and lets you combine behavior freely.

```csharp
// Hierarchy that grows out of control
class Report { }
class PdfReport : Report { }
class EmailedPdfReport : PdfReport { }
class EmailedExcelReport : ExcelReport { }

// Composition: two independent parts
public sealed class ReportService
{
    private readonly IReportFormatter _formatter;   // Pdf, Excel, Html...
    private readonly IReportSender _sender;         // Email, Storage...

    public ReportService(IReportFormatter formatter, IReportSender sender)
        => (_formatter, _sender) = (formatter, sender);

    public async Task SendAsync(ReportData data, CancellationToken ct)
        => await _sender.SendAsync(_formatter.Format(data), ct);
}
```

Use inheritance rarely, and only for real "is a" relationships where the base class is designed to be extended. Mark other classes `sealed`.

### 6. Polymorphism without `if` chains

When you see the same `if (type == ...)` or `switch` repeated in many places, the behavior belongs inside the types.

```csharp
public abstract record Shape
{
    public abstract double Area();
}

public sealed record Circle(double Radius) : Shape
{
    public override double Area() => Math.PI * Radius * Radius;
}

public sealed record Rectangle(double Width, double Height) : Shape
{
    public override double Area() => Width * Height;
}
```

Adding a new shape means adding one type, not editing every `switch`. (For closed sets that rarely change, a `switch` expression on a record hierarchy is also fine. Choose the one that matches how your code will grow.)

### 7. SOLID as guidelines

| Principle | Plain meaning | Warning sign when broken |
| --- | --- | --- |
| **S**ingle responsibility | A class has one reason to change | A class called `Manager` or `Helper` with 40 methods |
| **O**pen/closed | Add behavior without editing working code | Every new feature edits the same big `switch` |
| **L**iskov substitution | A subtype can replace its base type safely | A subclass that throws `NotSupportedException` |
| **I**nterface segregation | Small interfaces focused on what callers need | Implementations full of empty methods |
| **D**ependency inversion | Depend on abstractions you own | Business code calling `new SqlConnection()` directly |

These are tools for thinking, not laws. Apply them when a design hurts, not before.

## Common mistakes

- **Anemic models:** classes that are only properties, with all rules in a "service" next to them. Move the rules into the type that owns the data.
- **Primitive obsession:** `string email`, `int status`, `decimal price` everywhere. Introduce small types for concepts that have rules.
- **Over-abstraction:** `IUserService`, `UserService`, `UserServiceFactory`, `IUserServiceFactory`. Ask what real problem each one solves.
- **Public everything:** public setters and public collections that anyone can modify.
- **Deep inheritance:** more than two levels is usually a sign that composition fits better.

## Practice plan

1. **Library system.** Model books, members and loans. Rules: a member may hold at most five books, and a loan cannot be extended twice. Put each rule inside a type.
2. **Replace primitives.** Take any code you wrote at Level 1 and introduce at least three value objects, such as `EmailAddress`, `Money` and `Quantity`.
3. **Remove a `switch`.** Find or write a `switch` on a type code, and replace it with polymorphism. Compare which version is easier to extend.
4. **Fake the clock.** Write a class that depends on `IClock` and test it for a Friday and a Monday without waiting.

## Are you ready for Level 3?

- [ ] I can explain when to choose a `record`, a `class` and a `struct`.
- [ ] My types protect their own rules, and outside code cannot create invalid objects.
- [ ] I can replace a bad inheritance hierarchy with composition.
- [ ] I create an interface only when it has a purpose.
- [ ] I can point at a class and say what its single responsibility is.

Previous: [Level 1: C# Fundamentals](level-1-csharp-fundamentals.html). Next: [Level 3: Collections and LINQ](level-3-collections-and-linq.html).
