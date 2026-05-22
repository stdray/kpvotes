# KpVotes — миграция .NET → bun/TypeScript + Lightpanda

## Что было (.NET)

Сервис на .NET 10 + Quartz, который раз в 2 часа:
1. Загружал HTML `kinopoisk.ru/user/1719755/votes` через **AngleSharp** (статический HTTP GET, без JS)
2. Парсил голоса через AngleSharp HtmlParser (селекторы `.historyVotes .item`, `.nameRus a`, `.vote`)
3. Сравнивал с кэшем `votes.json` по ключу `{Uri, Vote}`
4. Новые оценки постил в Twitter через LinqToTwitter (OAuth 1.0a)
5. Кэш: JSON-массив `[{"Uri":"/film/...","Name":"...","Vote":7}]`

**Проблема**: AngleSharp не исполняет JavaScript → Kinopoisk в ответ на простой HTTP GET отдаёт SSO-редиректы и капчу Yandex SmartCaptcha.

## Тестирование Lightpanda

**Lightpanda** — headless-браузер на Zig, совместимый с Playwright/Puppeteer через CDP. Исполняет JavaScript, 9x быстрее Chrome, 16x меньше памяти.

| Попытка | Результат |
|---------|-----------|
| 1 (без ожидания) | SSO-редирект не доиграл |
| 2-3 | Rate-limit → капча `Are you not a robot?` |
| **4 (после паузы)** | ✅ **Страница загружена полностью!** |

**Вывод**: Lightpanda подходит. Капча была из-за частоты запросов, а не детекта браузера. Страница отдаётся с реальным HTML, содержащим `.historyVotes .item`.

### Команда для загрузки страницы
```bash
docker exec lightpanda lightpanda fetch \
  --dump html \
  --http-timeout 60000 \
  --wait-ms 15000 \
  "https://www.kinopoisk.ru/user/1719755/votes"
```

## Что сделано (bun/TS)

### Структура проекта
```
kpvotes-ts/
├── src/
│   ├── types.ts        — Vote, Config
│   ├── config.ts       — загрузка конфига (JSON + env vars override)
│   ├── cache.ts        — readCache, writeCache, diff (совместим со старым форматом)
│   ├── loader.ts       — docker exec lightpanda fetch → HTML
│   ├── parser.ts       — cheerio-парсер (.historyVotes .item, .nameRus a, .vote)
│   ├── twitter.ts      — twitter-api-v2 (OAuth 1.0a)
│   └── index.ts        — главный цикл: загрузка→парс→diff→твит (setInterval)
├── config.json          — конфиг-шаблон (без секретов)
├── config.local.json    — создать вручную с ключами Twitter
├── Dockerfile           — oven/bun:1, multistage
├── docker-compose.yml   — lightpanda + kpvotes
├── docker-compose.override.yml — mount config.local.json
└── package.json         — cheerio, twitter-api-v2
```

### Зависимости
- **cheerio** — парсинг HTML (замена AngleSharp HtmlParser)
- **twitter-api-v2** — Twitter API v2 через OAuth 1.0a (замена LinqToTwitter)
- **Lightpanda** — запускается как sidecar Docker-контейнер

### Совместимость с кэшем
Формат `votes.json` полностью совместим со старым .NET-проектом:
```json
[{"Uri":"/film/1048345/","Name":"Пробуждающая совесть 2: Дар змеи (2019)","Vote":5}]
```
Можно скопировать старый файл в `data/votes.json`.

### Результаты тестов
- Парсер протестирован на реальном HTML от Lightpanda — **50 голосов извлечено корректно**
- Docker-образ собирается (92 MB контент)

## Что осталось

1. **[x] Секреты Twitter** — созданы в YobaConf (см. ниже).
2. **[x] Прокси-конфиг** — server + username + password в YobaConf (см. ниже).
3. **[ ] Перенос кэша** — скопировать старый `votes.json` в `data/votes.json`.
4. **[ ] Продакшн-деплой** — настроить на сервере где сейчас работает .NET-версия.
5. **[x] Интеграция с YobaConf** — `config.ts` использует `@stdray-npm/yobaconf-client`. `config.json` больше не нужен. Bootstrap через `YOBACONF_ENDPOINT` + `YOBACONF_API_KEY`.

## YobaConf bindings

Конфигурация и секреты вынесены в YobaConf. Все binding-и имеют `tagSet: {project: "kpvotes"}`.

### Plain (7)
| keyPath | value |
|---------|-------|
| `kpvotes.kp-uri` | `https://www.kinopoisk.ru` |
| `kpvotes.votes-uri` | `user/1719755/votes` |
| `kpvotes.cache-path` | `/app/data/votes.json` |
| `kpvotes.interval-minutes` | `120` |
| `kpvotes.user-agent` | `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0` |
| `kpvotes.lightpanda-cdp-url` | `ws://lightpanda:9222` |
| `kpvotes.proxy-server` | `88.210.13.15:22001` |

### Secret (6)
| keyPath | stored in YobaConf |
|---------|-------------------|
| `kpvotes.twitter-app-key` | AES-256-GCM encrypted |
| `kpvotes.twitter-app-secret` | AES-256-GCM encrypted |
| `kpvotes.twitter-access-token` | AES-256-GCM encrypted |
| `kpvotes.twitter-access-secret` | AES-256-GCM encrypted |
| `kpvotes.proxy-username` | AES-256-GCM encrypted |
| `kpvotes.proxy-password` | AES-256-GCM encrypted |

### Потребление из KpVotes

Через `@stdray-npm/yobaconf-client` (npm, уже опубликован):

```ts
// config.ts — вариант с YobaConf вместо config.json + env vars
import { YobaConfClient } from "@stdray-npm/yobaconf-client";

const client = new YobaConfClient({
  endpoint: process.env.YOBACONF_ENDPOINT!,  // https://yobaconf.3po.su
  apiKey: process.env.YOBACONF_API_KEY!,
  tags: { project: "kpvotes" },
  template: "flat",   // nested JSON: { kpvotes: { kp-uri: "...", ... } }
});

const config = await client.fetch();
const kpUri = config.get("kpvotes.kp-uri");       // "https://www.kinopoisk.ru"
const appKey = config.get("kpvotes.twitter-app-key"); // расшифрован сервером
```

Альтернативно — через HTTP API напрямую:
```bash
curl -H "X-YobaConf-ApiKey: $YOBACONF_API_KEY" \
     "$YOBACONF_ENDPOINT/v1/conf?project=kpvotes"
```

`config.local.json` больше не нужен — все значения (включая секреты) приходят из YobaConf.

## Как запускать

### Локально (dev)
```bash
cd kpvotes-ts
cp config.json config.local.json
# отредактировать config.local.json — вставить ключи Twitter
docker compose up -d
docker compose logs -f app
```

### Продакшн
```bash
cd kpvotes-ts
# секреты через env vars:
KPVOTES_TWITTER_APPKEY=... KPVOTES_TWITTER_ACCESSTOKEN=... docker compose up -d
```

### Переменные окружения (префикс `KPVOTES_`)

| Переменная | По умолчанию |
|------------|-------------|
| `KPVOTES_CONFIG` | `/app/config.json` |
| `KPVOTES_CACHE_PATH` | `/app/data/votes.json` |
| `KPVOTES_INTERVAL_MINUTES` | `120` |
| `KPVOTES_TWITTER_APPKEY` | из config.json |
| `KPVOTES_TWITTER_APPSECRET` | из config.json |
| `KPVOTES_TWITTER_ACCESSTOKEN` | из config.json |
| `KPVOTES_TWITTER_ACCESSSECRET` | из config.json |

### Остановка
```bash
docker compose down
```

## Архитектура

```
┌──────────────────────────────────────────────┐
│ docker-compose                               │
│  ┌──────────────┐    ┌──────────────────┐   │
│  │  lightpanda  │    │     kpvotes      │   │
│  │  (Zig/CDP)   │    │   (bun/TS)       │   │
│  │              │    │                  │   │
│  │  :9222 (CDP) │◄───│ docker exec      │   │
│  │              │    │   lightpanda      │   │
│  │              │    │   fetch --dump    │   │
│  └──────────────┘    │                  │   │
│                      │  ↓ HTML          │   │
│                      │  cheerio parse   │   │
│                      │  ↓ votes[]       │   │
│                      │  diff(cache)     │   │
│                      │  ↓ new votes     │   │
│                      │  twitter-api-v2  │   │
│                      │  ↓ tweet         │   │
│                      │  write cache     │   │
│                      └──────────────────┘   │
│  volumes:                                    │
│    ./data → /app/data (votes.json)          │
│    /var/run/docker.sock (для docker exec)    │
└──────────────────────────────────────────────┘
```

## Исходный .NET проект

Старый проект лежит рядом: `../KpVotes/` (.NET 10 + AngleSharp + Quartz + LinqToTwitter).
Не удалять до полного переезда на новую версию.
