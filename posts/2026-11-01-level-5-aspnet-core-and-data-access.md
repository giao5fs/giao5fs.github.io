---
title: "Level 5: ASP.NET Core and Data Access"
date: 2026-11-01
tags: [dotnet, aspnet-core, ef-core, sql, series]
summary: Building a web API that behaves under load. The request pipeline, dependency injection lifetimes, validation, authentication, and writing EF Core code you can trust.
---

This is Level 5 of the series [7 Levels of .NET Mastery](7-levels-of-dotnet-mastery.html). Here the language skills from earlier levels meet real users and a real database. Most professional .NET work happens at this level.

## What you should know

### 1. The request pipeline

An ASP.NET Core application is a **pipeline of middleware**. A request enters, passes through each component in order, reaches an endpoint, and the response travels back through the same components in reverse.

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddProblemDetails();
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseExceptionHandler();      // outermost: catches everything below
app.UseHttpsRedirection();
app.UseAuthentication();        // who are you?
app.UseAuthorization();         // what may you do?

app.MapGet("/health", () => Results.Ok("ok"));
app.Run();
```

**Order matters.** Authentication must run before authorization, and exception handling must wrap everything else. When a feature "does nothing", a wrong middleware order is a likely reason.

You can write your own middleware for cross-cutting concerns such as correlation ids or timing:

```csharp
app.Use(async (context, next) =>
{
    var id = context.Request.Headers["X-Correlation-Id"].FirstOrDefault() ?? Guid.NewGuid().ToString();
    context.Response.Headers["X-Correlation-Id"] = id;
    using (app.Logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id }))
    {
        await next();
    }
});
```

### 2. Endpoints: minimal APIs or controllers

Both are fine. Minimal APIs are lighter. Controllers offer more built-in conventions. Pick one style per project and keep endpoints thin: they should translate HTTP into a call to your application code, and the result back into HTTP.

```csharp
app.MapPost("/orders", async (CreateOrderRequest request, OrderService service, CancellationToken ct) =>
{
    var result = await service.CreateAsync(request, ct);
    return result.IsSuccess
        ? Results.Created($"/orders/{result.Value.Id}", result.Value)
        : Results.ValidationProblem(result.Errors);
});
```

Design the API with care:

- Use nouns in paths, and HTTP verbs for actions: `GET /orders/42`, `POST /orders`.
- Return correct status codes: `201` for created, `404` when missing, `409` for conflicts, `422` or `400` for invalid input.
- Return errors in a consistent format, ideally ProblemDetails.
- Use DTOs for input and output, **never your database entities**. Entities expose fields you did not mean to expose and tie your API to your table design.

### 3. Dependency injection and lifetimes

The built-in container creates your objects and passes them where needed. The lifetime decides how long each instance lives.

| Lifetime | One instance per | Typical use |
| --- | --- | --- |
| `Singleton` | Application | Caches, configuration, `HttpClient` factories. Must be thread-safe. |
| `Scoped` | HTTP request | `DbContext`, unit of work, per-request state |
| `Transient` | Every injection | Small, stateless helpers |

The most common bug: **a singleton that depends on a scoped service** (for example a singleton holding a `DbContext`). It works with one request and breaks under concurrency, and it keeps entities in memory forever. ASP.NET Core catches this in the Development environment, which is why you should keep scope validation turned on.

```csharp
builder.Services.AddDbContext<AppDbContext>(o => o.UseSqlServer(connectionString)); // scoped
builder.Services.AddScoped<OrderService>();
builder.Services.AddSingleton<IClock, SystemClock>();
```

When a singleton, such as a background service, needs a scoped dependency, create a scope manually:

```csharp
using var scope = _scopeFactory.CreateScope();
var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
```

### 4. Configuration and secrets

Configuration comes from layered sources: `appsettings.json`, environment-specific files, environment variables, and a secret store. Later sources override earlier ones.

```csharp
public sealed class PaymentsOptions
{
    public const string Section = "Payments";
    [Required, Url] public string BaseUrl { get; init; } = "";
    [Range(1, 60)] public int TimeoutSeconds { get; init; } = 5;
}

builder.Services
    .AddOptions<PaymentsOptions>()
    .BindConfiguration(PaymentsOptions.Section)
    .ValidateDataAnnotations()
    .ValidateOnStart();       // fail at startup, not at the first request
```

Never commit passwords or keys. Use user secrets in development and a secret manager or environment variables in production.

### 5. Validation

Validate everything that enters the system. Check shape (required fields, lengths, ranges) at the edge, and business rules inside your domain code.

```csharp
public sealed record CreateOrderRequest(
    [property: Required] string CustomerId,
    [property: MinLength(1)] List<OrderLineRequest> Lines);
```

For richer rules, FluentValidation or your own validators work well. The important part is that invalid input never reaches your database as a surprise.

### 6. Authentication and authorization

- **Authentication** answers "who is calling": JWT bearer tokens, cookies or an external identity provider.
- **Authorization** answers "may they do this": roles, claims and policies.

```csharp
builder.Services.AddAuthorizationBuilder()
    .AddPolicy("CanRefund", p => p.RequireClaim("permission", "orders.refund"));

app.MapPost("/orders/{id}/refund", RefundAsync).RequireAuthorization("CanRefund");
```

Also check **ownership**: a logged-in user must not read someone else's order by changing the id in the URL. This is called broken object-level authorization, and it is one of the most common real vulnerabilities.

### 7. EF Core: read the SQL

EF Core maps C# objects to tables and translates LINQ into SQL. It is productive, and it hides costs unless you look. Turn on SQL logging in development and read every query.

```csharp
builder.Services.AddDbContext<AppDbContext>(o => o
    .UseSqlServer(connectionString)
    .LogTo(Console.WriteLine, LogLevel.Information)   // development only
    .EnableSensitiveDataLogging(builder.Environment.IsDevelopment()));
```

**Read with projections and without tracking.** By default EF Core tracks every loaded entity so it can detect changes. For read-only endpoints that is wasted work.

```csharp
var orders = await db.Orders
    .AsNoTracking()
    .Where(o => o.CustomerId == customerId)
    .OrderByDescending(o => o.CreatedAt)
    .Select(o => new OrderSummary(o.Id, o.CreatedAt, o.Lines.Sum(l => l.Price * l.Quantity)))
    .Take(50)
    .ToListAsync(ct);
```

This selects only three columns, does the sum in SQL, and limits the rows.

**Avoid the N+1 problem.** One query loads a list, then one more query runs for each item:

```csharp
// N+1: one query for orders, then one per order for its lines
var orders = await db.Orders.ToListAsync(ct);
foreach (var o in orders)
    Console.WriteLine(o.Lines.Count);      // lazy loading triggers a query each time

// Fix 1: load the related data in the same query
var withLines = await db.Orders.Include(o => o.Lines).ToListAsync(ct);

// Fix 2 (usually better): project only what you need
var counts = await db.Orders.Select(o => new { o.Id, Lines = o.Lines.Count }).ToListAsync(ct);
```

**Always page large lists.** Never return an unbounded list from an endpoint. Use `Skip`/`Take`, or better, keyset paging (`WHERE Id > @last ORDER BY Id`) for big tables.

**Update efficiently.** Load-modify-save is fine for single entities. For bulk changes use `ExecuteUpdateAsync` and `ExecuteDeleteAsync`:

```csharp
await db.Orders
    .Where(o => o.Status == OrderStatus.Pending && o.CreatedAt < cutoff)
    .ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, OrderStatus.Expired), ct);
```

### 8. Transactions and migrations

- `SaveChangesAsync` runs in one transaction by default, so changes inside one call are all saved or none are.
- For several steps across several calls, use an explicit transaction, and keep it short.
- Handle conflicts with a concurrency token, as explained in [How to handle concurrent requests safely](how-to-handle-concurrent-requests-safely.html).
- Manage schema with migrations: `dotnet ef migrations add AddOrderStatus`. Review the generated SQL. Changes to live databases should be done in small, backward-compatible steps (add a column first, deploy code that uses it, remove the old one later).

### 9. Know some SQL

An ORM does not remove the need to understand the database. Learn how to:

- Read an **execution plan** and spot table scans.
- Create **indexes** for columns used in `WHERE`, `JOIN` and `ORDER BY`, and understand that every index slows writes a little.
- Understand **isolation levels** and what a deadlock is.
- Write a raw query or use Dapper for a report that is awkward in LINQ.

## Common mistakes

- Returning entities from endpoints instead of DTOs.
- Injecting a scoped service into a singleton.
- Loading whole entities for a response that needs three columns.
- N+1 queries hidden behind lazy loading or loops.
- No paging, no limits, no `AsNoTracking` on read paths.
- Catching exceptions in every endpoint instead of using central exception handling.
- Trusting the client: skipping validation and ownership checks.
- Putting business logic in controllers, so it cannot be reused or tested.

## Practice plan

1. **Build a CRUD API** for a small domain (a to-do list, a book store) using a real database, not in-memory. Add paging, validation and ProblemDetails errors.
2. **Count the queries.** For each endpoint, log the SQL and count how many queries run. Remove every N+1.
3. **Add an index.** Fill a table with 1 million rows, run a slow query, read the plan, add an index and measure again.
4. **Secure it.** Add JWT authentication, one policy, and an ownership check. Write a test that proves user A cannot read user B's data.
5. **Fail at startup.** Add options validation so a missing connection string stops the app on start.

## Are you ready for Level 6?

- [ ] I can explain singleton, scoped and transient, and spot a captive dependency.
- [ ] I read the SQL that EF Core generates for my queries.
- [ ] I can spot an N+1 query before it ships.
- [ ] My endpoints use DTOs, validation, paging and consistent errors.
- [ ] I check ownership, not only that the user is logged in.
- [ ] I can add an index and show with a measurement that it helped.

Previous: [Level 4: Async and Concurrency](level-4-async-and-concurrency.html). Next: [Level 6: Performance and Runtime Internals](level-6-performance-and-runtime-internals.html).
