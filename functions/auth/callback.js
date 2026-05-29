// GET /auth/callback?code=...&state=clientName
// Google redireciona aqui após o cliente autorizar.
// Troca o code por refresh_token, detecta o channel_id e salva no D1.

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const code       = url.searchParams.get('code');
  const clientName = url.searchParams.get('state');
  const error      = url.searchParams.get('error');

  if (error) {
    return htmlResponse(`❌ Autorização negada: ${error}`, 400);
  }
  if (!code || !clientName) {
    return htmlResponse('❌ Parâmetros inválidos no callback.', 400);
  }

  // 1. Trocar code por tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  env.OAUTH_REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const body = await tokenResp.text();
    return htmlResponse(`❌ Erro ao trocar token: ${body}`, 500);
  }

  const tokenData    = await tokenResp.json();
  const refreshToken = tokenData.refresh_token;
  const accessToken  = tokenData.access_token;
  const tokenExpiry  = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600) - 60;

  if (!refreshToken) {
    return htmlResponse('❌ Nenhum refresh_token retornado. Tente revogar o acesso em myaccount.google.com e authorize novamente.', 400);
  }

  // 2. Detectar channel_id do canal autenticado
  const channelResp = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!channelResp.ok) {
    return htmlResponse(`❌ Erro ao buscar channel_id: ${await channelResp.text()}`, 500);
  }

  const channelData = await channelResp.json();
  const item        = channelData.items?.[0];
  if (!item) {
    return htmlResponse('❌ Nenhum canal YouTube encontrado nesta conta Google.', 400);
  }

  const channelId = item.id;
  const handle    = item.snippet?.customUrl || item.snippet?.title || clientName;

  // 3. Salvar no D1 — upsert por channel_id
  await env.DB.prepare(`
    INSERT INTO channels (client_name, channel_id, handle, refresh_token, access_token, token_expiry, connected_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(channel_id) DO UPDATE SET
      client_name   = excluded.client_name,
      handle        = excluded.handle,
      refresh_token = excluded.refresh_token,
      access_token  = excluded.access_token,
      token_expiry  = excluded.token_expiry,
      connected_at  = unixepoch()
  `).bind(clientName, channelId, handle, refreshToken, accessToken, tokenExpiry).run();

  // 4. Remover o placeholder "pending_*" se existia
  await env.DB.prepare(
    `DELETE FROM channels WHERE channel_id LIKE 'pending_%' AND client_name = ?`
  ).bind(clientName).run().catch(() => {});

  return htmlResponse(
    `✅ Canal <strong>${handle}</strong> (${clientName}) conectado com sucesso!<br><br>
     Você pode fechar esta aba. O dashboard já mostrará o canal.`,
    200,
    true
  );
}

function htmlResponse(message, status = 200, withLink = false) {
  const link = withLink ? `<p><a href="/" style="color:#4ade80">← Voltar ao dashboard</a></p>` : '';
  return new Response(`<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>YouTube Tracker — OAuth</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; border-radius: 12px; padding: 2rem 2.5rem; max-width: 480px;
            text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.4); }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <div class="card">
    <p style="font-size:1.1rem">${message}</p>
    ${link}
  </div>
</body>
</html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
