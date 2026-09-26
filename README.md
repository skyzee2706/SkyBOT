# 🎟️ SkyBOT Raffle

A Discord raffle bot with a web dashboard. Community managers create a raffle on the web, the bot
posts it to Discord, members enter with one click, requirements are checked automatically, and
winners are drawn the moment the raffle ends.

**Live:** https://skybot-raffle.vercel.app

---

## Features

**Raffles**
- Create raffles from a web dashboard after signing in with Discord
- Allocations: **GTD**, **FCFS** or both, each with its own number of spots. GTD is drawn first,
  then FCFS from the remaining entrants, so nobody can win twice
- Chain selection (Ethereum, Base, Robinhood, Ink, Arc, Unichain, Solana, or any custom chain)
- "Hosted by" line with the creator's Discord name and avatar
- Mention `@everyone` and/or selected roles when the raffle is posted
- End early, cancel, or disqualify individual entrants

**Entry requirements**
- Required roles (members need at least one of them)
- Minimum Discord account age
- Wallet submission (EVM or Solana), one wallet per entrant and matched to the raffle's chain
- **X (Twitter) tasks**: follow, like, retweet and quote. Entrants connect their X account first
  (one X account per Discord account). Each task button turns green once opened, and
  **Done, enter me** unlocks only after every task has been opened
- Discord requirements are checked again at draw time. Entrants who left the server or lost a role
  are disqualified and replaced automatically

**Results**
- Winner announcement in Discord, split into GTD and FCFS sections
- Optional winner role assigned automatically
- Winners export to Excel (`.xlsx`), with separate GTD and FCFS tables

**Administration**
- Raffle manager roles: let a role (e.g. `@CM`) manage raffles without the Manage Server permission
- Hidden `/admin` statistics page protected by a PIN: raffles created, communities using the bot,
  users who have logged in, and recent raffles

---

## Tech stack

| Part | Service |
|---|---|
| Web dashboard, API and bot (HTTP interactions) | [Vercel](https://vercel.com) |
| Database (PostgreSQL) | [Neon](https://neon.tech) |
| Draw scheduling | [Upstash QStash](https://upstash.com) |
| X login (OAuth 1.0a, no paid API needed) | [X Developer Platform](https://developer.x.com) |

Frontend: React, Vite and Tailwind CSS. Backend: Express, Prisma and discord.js (REST only, no
gateway connection).

---

## Deployment

### 1. Database (Neon)
1. Create a project at https://neon.tech (region: *AWS Asia Pacific (Singapore)* recommended).
2. Click **Connect**, turn **off** *Connection pooling*, and copy the connection string into `DATABASE_URL`.

### 2. Discord application
1. Create an application at https://discord.com/developers/applications.
2. **General Information**: *Application ID* → `DISCORD_CLIENT_ID`, *Public Key* → `DISCORD_PUBLIC_KEY`.
3. **Bot** → *Reset Token* → `DISCORD_BOT_TOKEN` (no privileged intents needed).
4. **OAuth2** → *Reset Secret* → `DISCORD_CLIENT_SECRET`.

### 3. Vercel
1. Run `npx vercel` in the project folder and follow the prompts (the first deploy may fail, that is fine).
2. Note the project domain: `PUBLIC_URL` = `https://<project>.vercel.app`.

### 4. Upstash QStash
Open **QStash** at https://console.upstash.com and copy `QSTASH_URL`, `QSTASH_TOKEN`,
`QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY`.

### 5. X Developer app (optional, for X tasks)
1. Create an app at https://developer.x.com.
2. **User authentication settings → Set up**
   - App permissions: **Read**
   - Type of App: **Web App**
   - Callback URI: `https://<project>.vercel.app/api/x/callback`
   - Website URL: `https://<project>.vercel.app`
3. **Keys and tokens → Consumer Keys** → `X_API_KEY` and `X_API_SECRET`.

### 6. Environment variables
In Vercel → **Settings → Environment Variables**, add every variable from [`.env.example`](.env.example),
including:
- `NODEJS_HELPERS` = `0` (required for Discord signature verification)
- `CRON_SECRET` = a long random string
- `ADMIN_PIN` = a 6–12 digit PIN for the `/admin` page (leave empty to disable it)

Then deploy with `npx vercel --prod`. Database tables are created automatically during the build.

### 7. Connect Discord to the app
In the Discord Developer Portal:
1. **OAuth2 → Redirects**: `https://<project>.vercel.app/api/auth/callback`
2. **General Information → Interactions Endpoint URL**: `https://<project>.vercel.app/api/interactions`

### 8. Invite the bot
Sign in on the web dashboard, pick a server and use the invite button. The bot needs these permissions:
View Channel, Send Messages, Embed Links, Read Message History, Mention Everyone and Manage Roles.

---

## Local development

```bash
cp .env.example .env   # fill in the values, with PUBLIC_URL=http://localhost:5173
npm install
npm run db:push
npm run dev
```

Discord buttons and X login only work on a public URL, so test those on a Vercel deployment.

| Command | Description |
|---|---|
| `npm run dev` | Start the API server and the Vite dev server |
| `npm run build` | Generate the Prisma client, sync the database schema and build the web app |
| `npm run typecheck` | Type-check the whole project |
| `npm run db:studio` | Open Prisma Studio |

---

## Project structure

```
api/index.ts             Vercel Function entry point
src/server/app.ts        Express app (all /api routes)
src/server/api/          auth, dashboard, admin, interactions (Discord buttons), xauth (X login), cron
src/server/raffle/       raffle logic, requirements, embeds, X tasks, QStash scheduling
src/server/xlsx.ts       Excel export writer
src/shared/              code shared by server and web (chains, allocations)
src/web/                 React frontend
prisma/schema.prisma     Database schema
```

## Notes
- The bot shows as **offline** in the member list. This is expected for HTTP-interaction bots.
- Without QStash, raffles are still drawn by the daily cron or on the next interaction, but may end late.
- X tasks cannot be verified through the free X API. The bot records that each task link was opened,
  not that the action was completed, so verify winners manually for high-value raffles.

## License

Proprietary. All rights reserved. See [LICENSE](LICENSE). The source is available for reference only.
Copying, deploying or redistributing it requires written permission from
[@SkyzeeReal](https://x.com/SkyzeeReal).
