# Team Building Game — Операция: Тайна локализация

Това е първоначалната инфраструктурна версия на вътрешно корпоративно web приложение за екипно играене.  
Проектът е изграден като една Node.js TypeScript приложение със:

- Express
- EJS сървърни шаблони
- Vanilla JavaScript и CSS
- JSON файлове като flat-file база данни

Целта е да има стабилна основа преди да се имплементират пълната логика на викторината и Azure Entra интеграцията.

## Изисквания

- Node.js (поддържан LTS)
- npm

## Инсталация

```bash
npm install
```

## Настройка на `.env`

1. Копирайте примерния конфигурационен файл:
   ```bash
   cp .env.example .env
   ```
2. Попълнете променливите:
   - `PORT`
   - `NODE_ENV`
   - `DATA_DIR`
   - `DEV_AUTH_BYPASS`
   - `DEV_USER_ID`
   - `DEV_USER_EMAIL`
   - `DEV_USER_NAME`
   - `ADMIN_EMAILS`

## Локално пускане

```bash
npm run dev
```

## Build и production старт

```bash
npm run build
npm run start
```

## Проверка

```bash
npm run typecheck
npm run test
```

## Архитектурни акценти

- Централизирана конфигурация чрез `getAppConfig()`.
- Локална JSON абстракция с:
  - асинхронни read/write операции
  - автоматично създаване на липсващи файлове
  - сериализация с pretty print
  - атомарна за запис чрез временен файл
  - queue за безопасни конкуретни записи
- Временно локално удостоверяване през middleware, лесно подменяемо за бъдеща Microsoft Entra логика.
- Единичен Express сървър с базови защитни middlewares (helmet, compression, body limits).
- Български потребителски текст и dark theme за стартов интерфейс.

## Структура

```
src/
  app.ts
  server.ts
  routes/
  middleware/
  services/
  repositories/
  models/
  utils/
views/
  layouts/
  partials/
  pages/
public/
  css/
  js/
  images/
data/
tests/
```
