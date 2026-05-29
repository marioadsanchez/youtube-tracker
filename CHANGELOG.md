# YouTube Tracker — Log do Projeto

## v0.1.0 — 2026-05-28 — Setup completo

### Infraestrutura provisionada

| Recurso | Nome | ID / URL |
|---------|------|---------|
| Cloudflare D1 | `youtube-tracker-db` | `fa0db19f-a523-4c52-984d-682e527820c9` |
| Cloudflare Pages | `youtube-tracker` | https://youtube-tracker-26i.pages.dev |
| Cloudflare Worker (cron) | `youtube-tracker-cron` | https://youtube-tracker-cron.marioadsanchez.workers.dev |
| GitHub | `marioadsanchez/youtube-tracker` | https://github.com/marioadsanchez/youtube-tracker |

### O que foi feito

- **D1 criado** com `wrangler d1 create youtube-tracker-db`
- **Migration aplicada** — tabelas `channels` e `channel_stats` criadas
- **Pages project criado** e D1 vinculado via Cloudflare API
- **DASH_KEY configurado** no Pages (valor: `youtube-tracker-key-2026` — mude pelo painel)
- **Cron worker deployado** com schedule `0 6 * * *` (06:00 UTC diário)
- **GitHub repo criado** em https://github.com/marioadsanchez/youtube-tracker

### Secrets configurados

| Secret | Status | Onde configurar se faltar |
|--------|--------|--------------------------|
| `DASH_KEY` | ✅ Configurado (`youtube-tracker-key-2026`) | Pages → Settings → Variables |
| `GOOGLE_CLIENT_ID` | ⚠️ Pendente | Pages → Settings → Variables |
| `GOOGLE_CLIENT_SECRET` | ⚠️ Pendente | Pages → Settings → Variables |
| `OAUTH_REDIRECT_URI` | ⚠️ Pendente | Pages → Settings → Variables |

### Pendente para funcionar completamente

1. **Criar credenciais OAuth Google:**
   - Acesse https://console.cloud.google.com
   - Crie/selecione um projeto
   - Habilite: **YouTube Data API v3** e **YouTube Analytics API**
   - Credenciais → Create Credentials → OAuth 2.0 Client ID → Web application
   - Authorized redirect URI: `https://youtube-tracker-26i.pages.dev/auth/callback`
   - Anote Client ID e Client Secret

2. **Configurar os 3 secrets restantes** no Cloudflare Pages Dashboard:
   - `GOOGLE_CLIENT_ID` = seu Client ID
   - `GOOGLE_CLIENT_SECRET` = seu Client Secret
   - `OAUTH_REDIRECT_URI` = `https://youtube-tracker-26i.pages.dev/auth/callback`

3. **Também no Cron Worker** (Workers → youtube-tracker-cron → Settings → Variables):
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

4. **Conectar o primeiro canal:**
   - Abra: `https://youtube-tracker-26i.pages.dev/auth/connect?key=youtube-tracker-key-2026&client=Anthony`
   - Faça login com a conta Google do canal
   - Pronto — aparece no dashboard

5. **Trocar a DASH_KEY** para uma senha mais segura em:
   - Pages → Settings → Environment Variables → DASH_KEY

### Arquitetura final

```
Browser
  │
  ├── GET https://youtube-tracker-26i.pages.dev?key=...
  │     └── index.html → dashboard com Chart.js
  │
  ├── GET /api/channels?key=...   → functions/api/channels.js → D1
  ├── GET /api/stats?key=...      → functions/api/stats.js    → D1
  ├── GET /auth/connect?key=...   → functions/auth/connect.js → Google OAuth
  └── GET /auth/callback          → functions/auth/callback.js → D1 (salva token)

Cron (06:00 UTC)
  └── youtube-tracker-cron Worker
        └── channels com refresh_token → YouTube Data API + Analytics API → D1
```

---

## Próximas versões planejadas

### v0.2.0
- Conectar Google Cloud Console + configurar OAuth
- Primeiro canal conectado e coletando dados
- Validar dashboard com dados reais

### v1.0.0
- Múltiplos clientes ativos
- 7+ dias de histórico coletado
- Todos os 6 gráficos funcionando (incluindo CTR e impressões)
