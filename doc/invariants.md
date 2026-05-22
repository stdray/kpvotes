# Project Invariants

Единый каталог инвариантов для всех проектов в `D:\my\prj\`. Уровни:

- **MUST** — нарушение = ошибка, требует исправления. Проект не считается «в порядке» пока не закрыто.
- **SHOULD** — нарушение = предупреждение. Допустимо с rationale в `invariant-status.md#Exceptions`.
- **MAY** — рекомендация. Нарушение не считается проблемой.

Исключения декларируются в `my/prj/<project>/invariant-status.md` секцией `## Exceptions` с rationale и датой добавления.

---

## I. Все проекты (polyglot)

### I.1. Репозиторий

| # | Уровень | Инвариант |
|---|---------|-----------|
| I.1.1 | MUST | `.gitignore` — полный, с секциями под стек проекта |
| I.1.2 | MUST | `.gitattributes` — `* text=auto eol=lf` + построчно по расширениям |
| I.1.3 | MUST | `.editorconfig` — `charset=utf-8`, `eol=lf`, `insert_final_newline=true`, `trim_trailing_whitespace=true` |
| I.1.4 | SHOULD | `AGENTS.md` — инструкция для coding agents |
| I.1.5 | MUST | `AGENTS.md` — единственный содержательный файл инструкций. `CLAUDE.md`, `QWEN.md` и т.п. — только редирект (`See [AGENTS.md](./AGENTS.md).`) |
| I.1.6 | MUST | `doc/invariants.md` — копия `wiki/cross-project/invariants.md` (обновляется при синхронизации) |

### I.2. CI/CD

| # | Уровень | Инвариант |
|---|---------|-----------|
| I.2.1 | MUST | GitHub Actions CI (PR validation) |
| I.2.2 | SHOULD | Docker-сборка через CI |
| I.2.3 | SHOULD | Deploy только по тегу, не автоматический на каждый push в main |
| I.2.4 | SHOULD | Docker smoke-test перед push'ем образа (30s health check) |
| I.2.5 | SHOULD | `concurrency: ci-${{ github.ref_name }}-${{ github.sha }}` — deduplicate runs |

### I.3. Observability

| # | Уровень | Инвариант |
|---|---------|-----------|
| I.3.1 | SHOULD | Логирование в yobalog (CLEF для .NET, HTTP для остальных) |
| I.3.2 | MAY | Трассировка в yobalog (OTLP) |
| I.3.3 | SHOULD | Health endpoint (`/health` → 200) |

### I.4. Конфигурация

| # | Уровень | Инвариант |
|---|---------|-----------|
| I.4.1 | MUST | Секреты не в git (`.env`, `appsettings.Production.json` в `.gitignore`) |
| I.4.2 | SHOULD | Конфигурация через yobaconf (для проектов с нетривиальной конфигурацией) |
| I.4.3 | MUST | `.env.example` или `appsettings.sample.json` с документированными ключами (без секретов) |

---

## II. .NET проекты

Применимо когда в репозитории есть `.csproj`.

### II.1. Сборка

| # | Уровень | Инвариант |
|---|---------|-----------|
| II.1.1 | MUST | `Directory.Build.props` — `TargetFramework=net10.0`, `LangVersion=latest`, `Nullable=enable`, `ImplicitUsings=enable`, `TreatWarningsAsErrors=true`, `AnalysisLevel=latest-recommended`, `AnalysisMode=All`, `EnforceCodeStyleInBuild=true`, `InvariantGlobalization=true` |
| II.1.2 | MUST | Central Package Management (`Directory.Packages.props`, `<ManagePackageVersionsCentrally>true`) |
| II.1.3 | MUST | `global.json` — pin SDK |
| II.1.4 | MUST | Cake + GitVersion (Clean→Restore→Version→Build→Test) |
| II.1.5 | MUST | `dotnet format --verify-no-changes` в CI |
| II.1.6 | MUST | `dotnet-tools.json` — GitVersion.Tool + dotnet-format |
| II.1.7 | SHOULD | Cake Docker task: Dockerfile + buildx + GHA layer cache |
| II.1.8 | SHOULD | Cake DockerPush зависит от всех test-таргетов явно (Test + E2ETest + DockerSmoke) |

### II.2. Стиль кода

| # | Уровень | Инвариант |
|---|---------|-----------|
| II.2.1 | SHOULD | Functional-immutable подход: `record`/`readonly record struct`, `init`-only, `IReadOnlyList<T>` |
| II.2.2 | SHOULD | Expression-bodied когда уместно |
| II.2.3 | SHOULD | Omit implicit access modifiers (`class Foo`, не `internal class Foo`) |
| II.2.4 | SHOULD | Maximum static typing — нет `object`, `dynamic` |

### II.3. Тестирование

| # | Уровень | Инвариант |
|---|---------|-----------|
| II.3.1 | MUST | `Directory.Build.targets` — NoWarn для тестовых проектов (`CA1707;CA1848;CA1861;CA1873;CA2007`) |
| II.3.2 | SHOULD | xunit + AwesomeAssertions |
| II.3.3 | SHOULD | E2E через Playwright (для web-проектов) |
| II.3.4 | SHOULD | `data-testid` для UI-тестов (не GetByText/GetByRole) |

### II.4. Документация

| # | Уровень | Инвариант |
|---|---------|-----------|
| II.4.1 | SHOULD | `doc/spec.md` + `doc/plan.md` + `doc/decision-log.md` |
| II.4.2 | SHOULD | Conventional Commits (`type(scope): description`) |

---

## III. TypeScript / bun проекты

Применимо когда в репозитории есть `package.json` с `bun` и нет `.csproj`.

### III.1. Сборка и версионирование

| # | Уровень | Инвариант |
|---|---------|-----------|
| III.1.1 | MUST | `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noEmit` |
| III.1.2 | MUST | `biome.json` — format + lint, `noExplicitAny: error`, `useConst: error`, `noUnusedVariables: error` |
| III.1.3 | MUST | `scripts/gitversion.ts` — версионирование из git-тегов (без .NET-зависимости) |
| III.1.4 | MUST | `build.sh` — `ci` target (check+typecheck+test) и `docker` target |
| III.1.5 | SHOULD | `bun test` — нативный test runner |
| III.1.6 | SHOULD | Docker multistage: `oven/bun:1` → distroless/node |

### III.2. Стиль кода

| # | Уровень | Инвариант |
|---|---------|-----------|
| III.2.1 | MUST | `const`, `readonly`, `ReadonlyArray<T>` — без мутаций |
| III.2.2 | MUST | `noExplicitAny` — `unknown` + type guards |
| III.2.3 | SHOULD | Arrow functions для колбеков и module-level helpers |
| III.2.4 | SHOULD | Omit `public` на class members |

### III.3. Документация

| # | Уровень | Инвариант |
|---|---------|-----------|
| III.3.1 | SHOULD | Conventional Commits |
| III.3.2 | SHOULD | `doc/decision-log.md` |

---

## IV. Python проекты

Применимо когда в репозитории есть `pyproject.toml` или `requirements*.txt`.

### IV.1. Сборка и версионирование

| # | Уровень | Инвариант |
|---|---------|-----------|
| IV.1.1 | MUST | `pyproject.toml` — PEP 621 (project metadata) |
| IV.1.2 | MUST | `ruff` — format + lint |
| IV.1.3 | MUST | `mypy` — strict mode |
| IV.1.4 | MUST | `pytest` — `--strict-markers` |
| IV.1.5 | MUST | `scripts/gitversion.py` — версионирование из git-тегов (без .NET-зависимости) |
| IV.1.6 | MUST | `build.sh` — `ci` target и `docker` target |
| IV.1.7 | SHOULD | Docker: `python:3.12-slim` → distroless |

### IV.2. Стиль кода

| # | Уровень | Инвариант |
|---|---------|-----------|
| IV.2.1 | MUST | Type hints на всех public функциях |
| IV.2.2 | SHOULD | `@dataclass` / `NamedTuple` над `dict` для structured data |
| IV.2.3 | SHOULD | Immutable-by-default |

### IV.3. Документация

| # | Уровень | Инвариант |
|---|---------|-----------|
| IV.3.1 | SHOULD | Conventional Commits |
| IV.3.2 | SHOULD | `doc/decision-log.md` |

---

## V. PoC-проекты

Проект считается PoC если: один разработчик, нет production-использования, явно помечен как PoC в `my/prj/<project>/description.md`.

PoC-проекты освобождаются от всех SHOULD. MUST-инварианты секции I (polyglot) сохраняются — `.gitignore`, `.gitattributes`, `.editorconfig`.

При повышении до production-статуса — полная проверка по применимой секции (II–IV).
