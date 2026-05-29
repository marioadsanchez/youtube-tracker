# YouTube Tracker — Log do Projeto

---

## v0.3.0 — 2026-05-29 — Dashboard estilo YouTube Studio

### O que foi feito

**Redesign completo do dashboard:**
- Layout com sidebar de canais + área principal
- Seletor de datas: presets (7d / 28d / 90d / 1 ano) + date picker personalizado from/to
- Aba **Canal**: 6 KPI cards + 4 gráficos de linha com dados **diários incrementais** (views/dia, watch time/dia, inscritos ganhos/dia, impressões/dia)
- Aba **Vídeos**: lista com thumbnail + clique num vídeo abre detalhe com gráficos diários de views e watch time do vídeo específico

**Novas tabelas D1 (migration 0004):**
- `channel_daily` — dados diários incrementais por canal (views, watch time, inscritos +/−, impressões, CTR)
- `video_daily` — dados diários incrementais por vídeo (views, watch time, duração média)

**Novas APIs:**
- `GET /api/channel-daily?channel_id=&from=&to=` — retorna dados diários do canal com totais do período
- `GET /api/video-daily?video_id=&from=&to=` — retorna dados diários de um vídeo específico

**Sync reescrito (`_sync.js`):**
- `dimensions=day` na Analytics API para obter dados diários (não agregados)
- Query separada para impressões/CTR (a API rejeita se combinada com outros metrics)
- `dimensions=video,day` para dados diários por vídeo
- Fallback silencioso se impressões falhar (canais sem YPP não têm acesso)

**Botões no header:**
- ↻ Sync hoje — coleta só o dia atual
- ⬇ Histórico completo — coleta desde a criação do canal (até 3650 dias)

---

## v0.2.0 — 2026-05-28 — Vídeos, OAuth auto-sync, métricas corrigidas

### O que foi feito

**Novas tabelas D1:**
- `videos` (migration 0002) — metadados dos vídeos públicos: título, thumbnail, duração, data de publicação
- `video_stats` (migration 0002) — snapshot cumulativo por vídeo: views, likes, comentários, watch time, duração média
- `channel_stats.subscribers_gained/lost` (migration 0003) — inscritos ganhos e perdidos por dia

**OAuth melhorado:**
- Ao conectar um canal, o callback dispara automaticamente coleta histórica completa em background (`waitUntil`)
- A data de início da coleta é a data de criação do canal no YouTube

**Filtro de vídeos públicos:**
- Apenas vídeos com `privacyStatus === 'public'` são coletados e exibidos

**Diagnóstico de métricas:**
- Confirmado via endpoint `/api/debug-analytics` que impressões/CTR requerem YouTube Partner Program (YPP)
- Impressões e CTR removidos das métricas de vídeo (exibem "N/D" para canais sem YPP)
- Watch time, duração média, views, likes, comentários funcionam para qualquer canal

**Botão de remover canal:**
- Cada card de canal tem um ✕ que remove o canal e todos os snapshots do D1

**Botão sincronizar:**
- Endpoint `POST /api/sync?days=N` para coleta manual com controle de período

---

## v0.1.0 — 2026-05-28 — Setup completo

### Infraestrutura provisionada

| Recurso | Nome | ID / URL |
|---------|------|---------|
| Cloudflare D1 | `youtube-tracker-db` | `fa0db19f-a523-4c52-984d-682e527820c9` |
| Cloudflare Pages | `youtube-tracker` | https://youtube-tracker-26i.pages.dev |
| Cloudflare Worker (cron) | `youtube-tracker-cron` | https://youtube-tracker-cron.marioadsanchez.workers.dev |
| GitHub | `marioadsanchez/youtube-tracker` | https://github.com/marioadsanchez/youtube-tracker |

### Secrets configurados

| Secret | Status |
|--------|--------|
| `DASH_KEY` | ✅ `youtube-tracker-key-2026` (trocar por senha mais segura) |
| `GOOGLE_CLIENT_ID` | ✅ Configurado |
| `GOOGLE_CLIENT_SECRET` | ✅ Configurado |
| `OAUTH_REDIRECT_URI` | ✅ `https://youtube-tracker-26i.pages.dev/auth/callback` |
| `GOOGLE_CLIENT_ID` (cron worker) | ✅ Configurado |
| `GOOGLE_CLIENT_SECRET` (cron worker) | ✅ Configurado |

### Arquitetura

```
Browser
  │
  ├── https://youtube-tracker-26i.pages.dev?key=...   → index.html (Chart.js)
  ├── GET  /api/channels?key=...                       → D1 channels
  ├── GET  /api/channel-daily?key=...                  → D1 channel_daily
  ├── GET  /api/videos?key=...                         → D1 videos + video_stats
  ├── GET  /api/video-daily?key=...                    → D1 video_daily
  ├── POST /api/sync?key=...&days=N                    → coleta manual
  ├── DEL  /api/delete-channel?key=...                 → remove canal + dados
  ├── GET  /auth/connect?key=...&client=nome           → redirect OAuth Google
  └── GET  /auth/callback                              → salva token + sync histórico

Cron (06:00 UTC diário)
  └── youtube-tracker-cron Worker
        ├── YouTube Data API v3    → subscribers, views, videos, comments (cumulativo)
        ├── YouTube Analytics API  → views/dia, watch time/dia, inscritos +/−/dia (incremental)
        └── YouTube Analytics API  → impressões/CTR/dia (só canais com YPP)
```

### Schema D1 completo

```
channels         — canal + OAuth tokens (refresh_token, access_token, token_expiry)
channel_stats    — snapshot cumulativo diário do canal
channel_daily    — dados diários incrementais do canal (Analytics API)
videos           — metadados dos vídeos públicos
video_stats      — snapshot cumulativo do vídeo (total de views/likes/comentários)
video_daily      — dados diários incrementais por vídeo (Analytics API)
```

---

## Limitações conhecidas

| Métrica | Status | Motivo |
|---------|--------|--------|
| Impressões | Só canais com YPP | YouTube restringe na Analytics API |
| CTR (Taxa de cliques) | Só canais com YPP | Idem |
| Views por vídeo (histórico diário) | ✅ Funciona | `dimensions=video,day` |
| Watch time por vídeo | ✅ Funciona | `estimatedMinutesWatched` |
| Inscritos ganhos/perdidos | ✅ Funciona | `subscribersGained/Lost` |

---

## Próximos passos sugeridos

- [ ] Trocar `DASH_KEY` para senha mais forte
- [ ] Conectar canais dos clientes via `/auth/connect`
- [ ] Clicar "⬇ Histórico completo" após conectar cada canal
- [ ] Avaliar se adicionar comparação entre períodos (ex: esta semana vs semana anterior)
- [ ] Avaliar se adicionar alerta de queda de views (notificação por email/WhatsApp)
