# Agents
Invariants: see [doc/invariants.md](doc/invariants.md). Status tracked in `my/prj/KpVotes/invariant-status.md`.

## Зачем нужны агенты

Сервис KpVotes работает как один фоновый агент, который периодически получает оценки с Kinopoisk и публикует новые твиты. Агент реализован классом `KpVotesJob` (Quartz `IJob`) и запускается по расписанию, заданному в `KpVotesJobOptions`. Запуск происходит из `Program.cs`, где Quartz получает конфигурацию из секции `KpVotesJobOptions` (или переменных окружения с префиксом `KpVotes_`).

Любые изменения или новые агенты должны строго соответствовать правилам из [`docs/coding-style.md`](coding-style.md).

## Состав

| Агент | Тип | Ответственность | Настройки |
| --- | --- | --- | --- |
| Loader | `IKpLoader` (`AngleSharpLoader`) | Загружает HTML текущих голосов по URI `KpVotesJobOptions.VotesUri`. Настраивает HTTP-заголовок `User-Agent` и выполняет запросы через AngleSharp. | `AngleSharpLoaderOptions.UserAgent` |
| Parser | `IKpParser` (`KpParser`) | Преобразует HTML в `KpVote` и отбрасывает CAPTCHA. В случае CAPTCHA кидает `InvalidOperationException`. | Нет отдельных опций |
| Publisher | `ITwitterClient` (`TwitterClient`) | Публикует твиты с оценками и работает через корпоративный прокси. | `TwitterCredentials.*`, `ProxyOptions.*`, задержка `KpVotesJobOptions.TwitterDelay` |
| Orchestrator | `KpVotesJob` | Сравнивает свежие оценки с кэшем (`votes.json`), пишет обновления на диск и в Twitter. | `KpVotesJobOptions` |

## Жизненный цикл `KpVotesJob`

1. **GetSiteVotes** — если `SkipLoad=true`, job использует сохранённый файл `PageVotesPath`, иначе качает HTML через loader и парсит его.
2. **GetFileVotes** — читает кэш из `CachePath`. Если файла нет, создаёт его перед первой публикацией.
3. **Diff** — объединяет новые и закешированные голоса по ключу `{Uri, Vote}` и обрабатывает только новые записи.
4. **SendVoteToTwitter** — публикует сообщения с задержкой `TwitterDelay` между твитами.
5. **SaveFileVotes** — перезаписывает кэш после каждой удачной отправки для обеспечения идемпотентности.
6. **Clean** — удаляет `PageVotesPath`, чтобы избежать устаревших данных.

## Конфигурация

Все настройки читаются через `HostBuilder.ConfigureAppConfiguration`, поэтому переменные окружения используют префикс `KpVotes_` и имена секций. Примеры:

- `KpVotes_KpVotesJobOptions__VotesUri=/user/12345/votes/`
- `KpVotes_KpVotesJobOptions__CachePath=D:\\data\\votes.json`
- `KpVotes_AngleSharpLoaderOptions__UserAgent=Mozilla/5.0 ...`
- `KpVotes_TwitterCredentials__ConsumerKey=...`
- `KpVotes_ProxyOptions__Host=proxy.corp`

## Расширение

- **Новый загрузчик**: реализовать `IKpLoader`, зарегистрировать в DI вместо `AngleSharpLoader`, добавить секцию опций и валидировать их при старте.
- **Новый парсер**: реализовать `IKpParser` и позаботиться о возврате `KpParserResult.Captcha`, чтобы job мог корректно обработать капчу.
- **Дополнительный канал публикации**: создать сервис, реализующий тот же паттерн, что и `ITwitterClient`, и вызвать его из `KpVotesJob.SendVoteToTwitter` или отдельного обработчика.

## Мониторинг и откладывание запуска

- Quartz триггеры задаются расширением `ScheduleJob<T>`: можно комбинировать `Interval`, `cronExpr` и `startNow`/`startNowDelay` для тонкой настройки.
- Логи (NLog) записывают ключевые этапы: старт/конец секций, количество голосов, ошибки отправки. При проблемах достаточно найти пары "Begin/End" для нужного этапа.

Эта схема позволяет добавлять новые агенты без изменения базовой инфраструктуры: достаточно определить интерфейс, зарегистрировать его в `Program.cs` и при необходимости расширить job.
