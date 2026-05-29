// GET /auth/connect?key=DASH_KEY&client=nome
// Protegido por DASH_KEY. Redireciona para OAuth Google solicitando acesso ao canal.

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const key = url.searchParams.get('key');
  if (!env.DASH_KEY || key !== env.DASH_KEY) {
    return new Response('Unauthorized', { status: 401 });
  }

  const clientName = url.searchParams.get('client');
  if (!clientName) {
    return new Response('Missing ?client=nome', { status: 400 });
  }

  if (!env.GOOGLE_CLIENT_ID || !env.OAUTH_REDIRECT_URI) {
    return new Response('OAuth not configured (missing GOOGLE_CLIENT_ID or OAUTH_REDIRECT_URI)', { status: 500 });
  }

  // Garantir que o cliente existe na tabela channels antes de conectar
  await env.DB.prepare(`
    INSERT INTO channels (client_name, channel_id, handle)
    VALUES (?, ?, ?)
    ON CONFLICT(channel_id) DO NOTHING
  `).bind(clientName, `pending_${clientName.toLowerCase().replace(/\s+/g, '_')}`, clientName).run().catch(() => {});

  const params = new URLSearchParams({
    client_id:     env.GOOGLE_CLIENT_ID,
    redirect_uri:  env.OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ].join(' '),
    access_type:   'offline',
    prompt:        'consent',          // força refresh_token mesmo que já autorizado antes
    state:         clientName,
  });

  return Response.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    302
  );
}
