# Стиль кодирования

## Базовые правила

- Отступы табуляцией (`\t`), визуальный размер табуляции = 2 пробела. Файлы .editorconfig будут обновлены позже, но IDE должна быть настроена соответственно.
- `record`/`record struct` использовать для неизменяемых данных (DTO, события, опции). Сервисные типы оформлять как `class` с первичным конструктором.
- Использовать первичные конструкторы и init-only свойства для внутренних DTO.
- Предпочитать expression-bodied (arrow) члены для методов, свойств и локальных функций.
- Не добавлять явные `using System;`, `using System.Collections.Generic;`, `using System.IO;`, `using System.Linq;` и другие базовые пространства из BCL — они уже подтягиваются через `<ImplicitUsings>enable</ImplicitUsings>`.
- Для массивов/списков использовать collection expressions (`["Inc", "Incoming"]`) вместо устаревшего синтаксиса `new[] { ... }`.
- Максимальная длина строки — **120 символов**. Если строковая константа превышает лимит, разбивать её на конкатенацию нескольких строк через `+` (по смысловым кускам).
- Модификаторы доступа по умолчанию (внутри файлов-`internal` и `private`) не дублировать без необходимости.
- Не использовать `sealed`, пока нет явной причины (например, оптимизация виртуальных вызовов).
- По возможности писать в функциональном стиле: неизменяемость, `Select/Where`, pattern matching, `with`-выражения.
- Названия файлов = названия типов (PascalCase). Для модулей (Partial) добавлять суффиксы `*.Pipeline.cs`, `*.Extensions.cs` и т. д.

## Организация кода

1. **Модули**: код группируется по функциональным областям (`Commit`, `Git`, `WebDav`, `Enrichment`, `Pipeline`, `Publish` и т. д.), каждый модуль использует namespace `stdray.Obsidian.<Module>`; отдельные слои `Application`/`Infrastructure` не выделяются, композиция сервиса вынесена в `DependencyInjection`.
2. **Именование**: альясы namespace не использовать. Для статических импортов (например, `using static System.Math`) требуется обоснование в код-ревью.
3. **Файлы**: один публичный тип на файл. Внутренние вспомогательные записи можно располагать в том же файле, помечая `file`-видимостью.
4. **Async**: все операции ввода/вывода выполняются асинхронно (`Task`, `ValueTask`). Методы содержат суффикс `Async`.

## Паттерны

- **Dependency Injection**: через `IServiceCollection` и минимальные фабрики. Настройка сервисов — в `CompositionRoot`.
- **Конфигурация**: использовать `record WebDavOptions(string Endpoint, string Username, string Password, string RemotePath);` и подобные первичные записи.
- **Логи**: Serilog, шаблон `"{agent}::{operation} => {status}"`. Не логировать содержимое заметок.
- **Ошибки**: использовать `OneOf`/Discriminated Unions (через record) или `Result<T>`; исключения бросать только для truly exceptional scenarios.
- **Тесты**: xUnit + Verify для снапшот-тестов diff'ов.

## Практические примеры

```csharp
namespace stdray.Obsidian.Sync;

file readonly record WebDavOptions(string Endpoint, string Username, string Password, string RemotePath);

class SyncAgent(WebDavClient client, ConflictResolutionAgent resolver)
{
	public async Task<SyncDelta> RunAsync(CancellationToken token) =>
		await client.DownloadAsync(token)
			.Map(delta => resolver.Resolve(delta));
}
```

```csharp
class CommitMessageService(OpenAiClient client)
{
	public ValueTask<string> CreateMessageAsync(GitDelta delta, CancellationToken token) =>
		delta.IsEmpty
			? ValueTask.FromResult("chore: sync vault")
			: client.CreateCompletionAsync(PromptBuilder.Build(delta), token);
}
```

## Проверка стиля

- Ветка build pipeline будет подключать `dotnet format` и Roslyn analyzer с правилами TabIndentation + expression-bodied members.
- Перед коммитом запускать `dotnet format --verify-no-changes` (команда будет добавлена в CI).
