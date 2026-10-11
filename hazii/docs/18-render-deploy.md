# Размещение на Render

`render.yaml` в корне репозитория описывает всё окружение (Blueprint):

- веб-сервис `sino` (Node 24): `npm run build` собирает приложение, затем
  `node scripts/migrate.mjs` применяет `infra/postgres/init/*.sql` и
  `node api/server.mjs` отдаёт и `dist/`, и `/api` с одного HTTPS-адреса;
- база `sino-db` (PostgreSQL 16). `DATABASE_URL` Render подставляет сам.

Все SQL-файлы повторяемые, поэтому миграции безопасно запускаются при каждом старте.
Redis в облаке не нужен: без `REDIS_URL` словарь отвечает напрямую из PostgreSQL.

Переменные окружения сервера:

| Переменная | Назначение |
| --- | --- |
| `DATABASE_URL` | строка подключения к PostgreSQL |
| `PORT`, `HOST` | порт и интерфейс (Render задаёт `PORT`, `HOST=0.0.0.0`) |
| `SERVE_STATIC=1` | отдавать собранный `dist/` этим же процессом |
| `TRUST_PROXY` | число прокси перед сервером (на Render `1`) |
| `REDIS_URL` | необязательный кеш словаря |

Словарь БКРС в базу не попадает автоматически: его загружают отдельно командой
`npm run dictionary:import -- <путь к dabkrs_dabruks.html>` с `DATABASE_URL`
внешней строки подключения Render (временно добавив свой IP в доступ к базе).
Полный словарь занимает около 2 ГБ, бесплатная база Render — 1 ГБ.

## Без банковской карты: Render Web Service + Neon

Blueprint на Render просит карту. Вместо него базу можно взять в Neon
(бесплатно, без карты, 0,5 ГБ, не удаляется), а на Render создать только
Web Service вручную с теми же командами и переменными, что в `render.yaml`,
плюс `DATABASE_URL` из Neon и `DB_CONNECT_TIMEOUT_MS=10000`.
