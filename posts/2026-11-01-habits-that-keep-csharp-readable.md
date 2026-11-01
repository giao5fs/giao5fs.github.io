---
title: Habits that keep C# code readable
date: 2026-11-01
tags: [csharp, craft, sample]
summary: Five small habits that make C# code easier to read, review and change six months later.
---

> [!NOTE]
> This is a sample post that shows what the blog can do. Delete this file or replace its text with your own writing.

Most code is read far more often than it is written. These habits cost almost nothing while you write and save a lot of time during reviews and bug fixes.

## Name things for the reader

A name should say what a value means, not how it was produced. Compare these two versions of the same check:

```csharp
// Before
if (u.s == 2 && d > 30) { Send(u); }

// After
if (user.Status == AccountStatus.Overdue && daysOverdue > ReminderThresholdDays)
{
    SendReminder(user);
}
```

The second version needs no comment, and a reviewer can spot a wrong threshold at a glance.

## Return early instead of nesting

Guard clauses keep the happy path at the left margin.

```csharp
public decimal CalculateDiscount(Order order)
{
    if (order is null) throw new ArgumentNullException(nameof(order));
    if (order.Lines.Count == 0) return 0m;
    if (!order.Customer.IsActive) return 0m;

    return order.Total * 0.1m;
}
```

## Give domain concepts their own type

A `string` can hold anything. A small type can only hold what it should.

```csharp
public readonly record struct EmailAddress
{
    public string Value { get; }

    public EmailAddress(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || !value.Contains('@'))
            throw new ArgumentException("Not a valid email address.", nameof(value));
        Value = value.Trim();
    }
}
```

## Make failures loud and specific

Swallowed exceptions turn small bugs into long investigations. Catch an exception only when you can handle it, and add context when you rethrow.

## Let tests describe behavior

Name a test after the rule it protects, such as `Overdue_accounts_receive_one_reminder_per_week`. When it fails, the name tells you what broke before you open the code.

## Quick reference

| Smell | Try this |
| --- | --- |
| Method longer than one screen | Extract well-named private methods |
| Boolean parameters (`Save(true, false)`) | Use an enum or two methods |
| Deep `if` nesting | Guard clauses and early returns |
| Primitive values passed around | Small value types such as `EmailAddress` |

Readable code is a habit more than a talent. Pick one item from this list and apply it in your next pull request.
