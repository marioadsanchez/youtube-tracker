# YouTube Tracker

Painel para acompanhar o crescimento diário de canais YouTube de múltiplos clientes.
Stack: Cloudflare Pages + D1 + Cron Worker.

## Funcionalidades

- Coleta automática diária (subscribers, views, vídeos, comentários, CTR, impressões)
- OAuth Google por cliente — token salvo no D1, funciona em qualquer navegador
- 6 gráficos individuais por canal + filtro 7d / 30d / 90d
- Protegido por `DASH_KEY`

---

## Setup completo

### 1. Criar repositório no GitHub

```bash
git init
git remote add origin https://github.com/SEU_USUARIO/youtube-tracker.git
```

### 2. Criar banco D1

```bash
npx wrangler d1 create youtube-tracker-db
```

Copie o `database_id` retornado e substitua `REPLACE_WITH_YOUR_DATABASE_ID` em:
- `wrangler.toml`
- `wrangler-cron.toml`

### 3. Aplicar migration

```bash
npx wrangler d1 execute youtube-tracker-db --file=migrations/0001_create_tables.sql --remote
```

### 4. Criar projeto Google OAuth

1. Acesse [console.cloud.google.com](https://console.cloud.google.com)
2. Crie um projeto → habilite **YouTube Data API v3** e **YouTube Analytics API**
3. Credenciais → OAuth 2.0 Client ID → tipo: **Web application**
4. URI de redirecionamento autorizado: `https://youtube-tracker.pages.dev/auth/callback`
5. Anote `Client ID` e `Client Secret`

### 5. Criar Pages project no Cloudflare

```bash
npx wrangler pages project create youtube-tracker
```

Conectar ao GitHub pelo painel Cloudflare → Settings → Git Integration.

### 6. Configurar secrets (Cloudflare Pages Dashboard → Settings → Variables)

| Variável              | Valor                                         |
|-----------------------|-----------------------------------------------|
| `DASH_KEY`            | Uma senha forte para proteger o painel        |
| `GOOGLE_CLIENT_ID`    | Client ID do OAuth Google                     |
| `GOOGLE_CLIENT_SECRET`| Client Secret do OAuth Google                 |
| `OAUTH_REDIRECT_URI`  | `https://youtube-tracker.pages.dev/auth/callback` |

### 7. Deploy do Pages

```bash
git add . && git commit -m "initial commit"
git push origin main
```

O Cloudflare fará o deploy automaticamente.

### 8. Deploy do Cron Worker

```bash
npx wrangler deploy --config wrangler-cron.toml
```

Configure também as variáveis de ambiente do worker pelo painel Cloudflare → Workers → youtube-tracker-cron → Settings → Variables:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

---

## Adicionar novos clientes

1. Edite `config/clients.js` e adicione o cliente
2. Faça push → deploy automático
3. Acesse `https://youtube-tracker.pages.dev/auth/connect?key=DASH_KEY&client=NomeCliente`
4. Faça login com a conta Google do canal do cliente
5. Pronto — o canal aparecerá no dashboard conectado

---

## Testar cron manualmente

```bash
npx wrangler dev cron-worker.js --config wrangler-cron.toml --test-scheduled
```

---

## Estrutura do projeto

```
youtube-tracker/
├── index.html                     # Dashboard
├── wrangler.toml                  # Config Pages + D1
├── wrangler-cron.toml             # Config cron worker
├── cron-worker.js                 # Worker de coleta diária
├── migrations/
│   └── 0001_create_tables.sql
├── config/
│   └── clients.js                 # Lista de clientes
└── functions/
    ├── api/
    │   ├── _helpers.js
    │   ├── channels.js            # GET /api/channels
    │   └── stats.js               # GET /api/stats
    └── auth/
        ├── connect.js             # GET /auth/connect
        └── callback.js            # GET /auth/callback
```
