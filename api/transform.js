// api/transform.js (Vercel Edge Function, JS)

export const config = { runtime: 'edge' };

function cors(req) {
  const origin = req.headers.get('origin') || '*';
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allow = allowed.length ? (allowed.includes(origin) ? origin : allowed[0]) : '*';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gett-Client',
  };
}

function pickClientKey(req) {
  const h = new Headers(req.headers);
  const slug = (h.get('X-Gett-Client') || '').toLowerCase().trim();
  let map = {};
  try { map = JSON.parse(process.env.OPENAI_CLIENT_KEYS || '{}'); } catch {}
  let apiKey = slug && map[slug];
  if (!apiKey) {
    const ref = h.get('referer') || '';
    let host = '';
    try { host = new URL(ref).hostname; } catch {}
    const guess = host.replace(/^www\./,'').split('.')[0];
    apiKey = guess && map[guess];
  }
  return { apiKey, slug: slug || 'unknown' };
}

function buildSystemPrompt({ mode='feminine', instruction='', locale='fr-FR' }) {
  const base =
`Tu es un transformateur de texte pour le web.
- Conserve strictement la mise en forme HTML et les entités (&nbsp;…).
- Ne modifie jamais l’HTML (balises/attributs) ni les variables {{handlebars}}.
- Ne résume pas, transforme uniquement le genre grammatical selon la consigne.
- Langue de sortie: ${locale}.
- Retourne UNIQUEMENT le texte transformé, sans explication.`;
  const line =
    mode === 'feminine' ? 'Transforme tout au **féminin**.' :
    mode === 'masculine' ? 'Transforme tout au **masculin**.' :
    mode === 'neutral'   ? 'Rends le texte **neutre/inclusif**.' : '';
  const extra = instruction ? `\nConsigne additionnelle: ${instruction}` : '';
  return [base, line, extra].filter(Boolean).join('\n');
}

export default async function handler(req) {
  const method = req.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(req) });
  }
  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...cors(req), 'Allow': 'POST, OPTIONS' },
    });
  }

  try {
    const headers = cors(req);
    const { apiKey, slug } = pickClientKey(req);
    if (!apiKey) {
      return new Response(JSON.stringify({ error:'Unknown client or missing key', client: slug }), { status: 401, headers });
    }

    const body = await req.json().catch(() => ({}));
    const text = (body && body.text || '').trim();
    if (!text) {
      return new Response(JSON.stringify({ error:'Missing "text"' }), { status: 400, headers });
    }

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role:'system', content: buildSystemPrompt(body) },
          { role:'user',   content: text }
        ],
        temperature: 0.2
      })
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return new Response(JSON.stringify({ error:'OpenAI error', detail }), { status: 502, headers });
    }

    const data = await upstream.json();
    const usage = data.usage || data.output?.[0]?.usage || null;
    const outText = data.output_text
      ?? data.output?.[0]?.content?.[0]?.text
      ?? data.choices?.[0]?.message?.content
      ?? '';

    const extra = new Headers(headers);
    if (usage && usage.total_tokens != null) extra.set('X-Usage-Total', String(usage.total_tokens));
    extra.set('X-Gett-Client', slug);

    return new Response(JSON.stringify({ text: outText, usage, client: slug }), { headers: extra });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'Server error' }), {
      status: 500,
      headers: cors(req)
    });
  }
}
