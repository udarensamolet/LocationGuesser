# Team Building Game — Location Guessing

This is the initial full-stack implementation of an internal, team-based location guessing web game.
The project is built as a TypeScript Node.js application with:

- Express
- EJS templates
- Vanilla JavaScript and CSS
- JSON files as a flat-file data store

The goal is to provide a stable base to implement full location-based game flow and Azure Entra authentication integration.

## Requirements

- Node.js (LTS)
- npm

## Installation

```bash
npm install
```

## Configure `.env`

1. Copy the example configuration file:
   ```bash
   cp .env.example .env
   ```
2. Fill in the required values:
   - `PORT`
   - `NODE_ENV`
   - `DATA_DIR`
   - `DEV_AUTH_BYPASS`
   - `DEV_USER_ID`
   - `DEV_USER_EMAIL`
   - `DEV_USER_NAME`
   - `ADMIN_EMAILS`

## Run locally

```bash
npm run dev
```

## Build and run for production

```bash
npm run build
npm run start
```

## Validation

```bash
npm run typecheck
npm run test
```

## Architectural notes

- Centralized configuration is handled through `getAppConfig()`.
- Local JSON storage is designed with:
  - async read/write operations
  - automatic creation of missing directories/files
  - pretty-print serialization
  - automatic timestamped file logging
  - queue for non-blocking queue writes
- Middleware-driven architecture for future extension, with dedicated place for Entra authentication logic.
- Single Express server with baseline middleware stack (`helmet`, `compression`, request body limits).
- Built-in Bulgarian challenge text and dark theme starter interface.

## Deploy to Azure

### Option 1: Azure App Service (CLI)

This app can be deployed to Azure App Service (Linux + Node.js 20). Replace placeholders with your own resource names.

1. Install and authenticate with Azure CLI.
2. Create resource group and App Service plan:
   ```bash
   az login
   az group create --name rg-locationguesser --location westus
   az appservice plan create --name asp-locationguesser --resource-group rg-locationguesser --sku B1 --is-linux
   ```
3. Create the web app:
   ```bash
   az webapp create \
     --resource-group rg-locationguesser \
     --plan asp-locationguesser \
     --name your-location-guesser \
     --runtime "NODE|20-lts" \
     --startup-file "npm start"
   ```
4. Configure environment variables:
   ```bash
   az webapp config appsettings set \
     --resource-group rg-locationguesser \
     --name your-location-guesser \
     --settings NODE_ENV=production PORT=3000 DATA_DIR=./data
   ```
   Add additional settings such as `DEV_AUTH_BYPASS`, `DEV_USER_ID`, `DEV_USER_EMAIL`, `DEV_USER_NAME`, and `ADMIN_EMAILS`.
5. Enable Git deployment and push code:
   ```bash
   az webapp deployment source config-local-git \
     --name your-location-guesser \
     --resource-group rg-locationguesser
   ```
   Then use the remote returned by the previous command:
   ```bash
   git add .
   git commit -m "Deploy to Azure"
   git push <azure-git-remote> main
   ```
6. (Optional) Run one production build if needed in deploy pipeline before start:
   ```bash
   npm run build
   ```

### Azure notes

- This project currently uses local JSON file storage, which is not durable across App Service restarts/scale operations by default. For production reliability, move persistence to a durable store.
- Keep `PORT` aligned with the web app's listen port (default is `3000`).
- Store secrets and provider credentials in Azure App Service settings, not in committed files.

### Option 2: Deploy from GitHub Actions (alternative)

Push this repository to GitHub and configure an Azure App Service deployment workflow. Use `npm install`, `npm run build`, and `npm run start` in the build step.

## Authentication setup

### Step 1 (Azure): use Microsoft Entra Easy Auth on App Service

Use this when running behind Azure App Service:

1. In Azure Portal, open your App Service.
2. Go to **Authentication** and enable Microsoft Entra ID as provider.
3. Turn on **App Service Authentication** and require authentication for incoming requests.
4. Set your app settings:
   - `NODE_ENV=production`
   - `DEV_AUTH_BYPASS=false`
   - `ADMIN_EMAILS=you@company.com`
5. Make sure your app is using the middleware headers from Easy Auth (already supported):
   - `x-ms-client-principal-email`
   - `x-ms-client-principal-id`
   - `x-ms-client-principal-object-id`
   - `x-ms-client-principal` (JSON claims fallback)

### Step 2 (Vercel): use trusted identity headers from your own auth layer

Vercel does not inject Azure App Service identity headers by default.

1. Keep Easy Auth off in Vercel frontend and add an identity layer in front of this server (for example OAuth/OIDC proxy).
2. Configure that layer to send these headers on each request:
   - `x-vercel-user-email`
   - `x-vercel-user-id`
   - `x-vercel-user-name`
3. In Vercel env vars, set:
   - `TRUST_PROXY_IDENTITY_HEADERS=true`
4. Set `DEV_AUTH_BYPASS=false`.

This app trusts these headers only when `TRUST_PROXY_IDENTITY_HEADERS=true`.

## Project structure

```bash
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
