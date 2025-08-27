// api/transform.js (Vercel Edge Function, JS)

export const config = { runtime: 'edge' };

function cors(req) {
  const origin = req.headers.get('origin') || '*';
  const allowedList = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Si ALLOWED_ORIGINS est vide => autoriser tout (utile en dev)
  // Sinon, renvoyer l'origin si match exact, sinon le premier autorisé (pour éviter blocage dur)
  const allow =
    allowedList.length === 0
      ? '*'
      : (allowedList.includes(origin) ? origin : allowedList[0]);

  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Gett-Client, X-Requested-With',
    'Access-Control-Expose-Headers': 'X-Usage-Total, X-Gett-Client',
    'Cache-Control': 'no-store'
  };
}

function pickClientKey(req) {
  const h = new Headers(req.headers);
  const slug = (h.get('X-Gett-Client') || '').toLowerCase().trim();

  let map = {};
  try { map = JSON.parse(process.env.OPENAI_CLIENT_KEYS || '{}'); } catch {}

  // 1) priorité au slug explicite
  let apiKey = slug && map[slug];

  // 2) sinon, tenter via le referer (domaine complet, domaine sans www, premier label)
  if (!apiKey) {
    const ref = h.get('referer') || '';
    let host = '';
    try { host = new URL(ref).hostname.toLowerCase(); } catch {}
    if (host) {
      const noWww = host.replace(/^www\./,'');
      const firstLabel = noWww.split('.')[0];
      apiKey = map[host] || map[noWww] || map[firstLabel] || null;
    }
  }

  // 3) sinon, clé par défaut optionnelle
  if (!apiKey && process.env.OPENAI_API_KEY_DEFAULT) {
    apiKey = process.env.OPENAI_API_KEY_DEFAULT;
  }

  return { apiKey, slug: slug || 'unknown' };
}

// Prompt builder (ajout translate-en, garde HTML, pas d'explication)
function buildSystemPrompt({ mode='feminine', instruction='', locale='fr-FR' }) {
  const base =
`Tu es un transformateur de texte pour le web.
- Conserve strictement la mise en forme HTML et les entités (&nbsp;…).
- Ne modifie jamais l’HTML (balises/attributs) ni les variables {{handlebars}}.
- N’ajoute pas d’explications, ne résume pas.
- Langue de sortie: ${locale}.
- Retourne UNIQUEMENT le texte transformé.`;

  const line =
    mode === 'feminine'     ? 'Transforme tout au **féminin**.' :
    mode === 'masculine'    ? 'Transforme tout au **masculin**.' :
    mode === 'neutral'      ? 'Rends le texte **neutre/inclusif**.' :
    mode === 'translate-en' ? [
      'Traduis le texte du **français vers l’anglais** (anglais naturel et idiomatique).',
      'Si une portion est déjà en anglais, laisse-la **inchangée**.'
    ].join(' ') :
    '';

  const extra = instruction ? `\nConsigne additionnelle: ${instruction}` : '';
  return [base, line, extra].filter(Boolean).join('\n');
}

export default async function handler(req) {
  const method = req.method?.toUpperCase?.() || 'GET';

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors(req) });
  }
  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...cors(req), 'Allow': 'POST, OPTIONS', 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  try {
    const baseHeaders = cors(req);
    const { apiKey, slug } = pickClientKey(req);
    if (!apiKey) {
      return new Response(JSON.stringify({ error:'Unknown client or missing key', client: slug }), {
        status: 401,
        headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const body = await req.json().catch(() => ({}));
    const rawText = (body && body.text || '').toString();
    const text = rawText.trim();
    if (!text) {
      return new Response(JSON.stringify({ error:'Missing "text"' }), {
        status: 400,
        headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // Normalisation locale
    const normalizedBody = { ...body };
    if (normalizedBody.mode === 'translate-en') {
      normalizedBody.locale = normalizedBody.locale || 'en-US';
    } else {
      normalizedBody.locale = normalizedBody.locale || 'fr-FR';
    }

    // Optionnel: couper si texte gigantesque (sécurité)
    const maxChars = Number(process.env.MAX_CHARS || 4000);
    const inputText = text.length > maxChars ? text.slice(0, maxChars) : text;

    const upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role:'system', content: buildSystemPrompt(normalizedBody) },
          { role:'user',   content: inputText }
        ],
        response_format: { type: 'text' },
        temperature: 0.2
      })
    });

    // Gestion erreurs HTTP
    if (!upstream.ok) {
      let detail = '';
      try { detail = await upstream.text(); } catch {}
      return new Response(JSON.stringify({ error:'OpenAI error', detail }), {
        status: 502,
        headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const data = await upstream.json();

    // Gestion d'erreur OpenAI au format JSON
    if (data?.error) {
      return new Response(JSON.stringify({ error:'OpenAI error', detail: data.error }), {
        status: 502,
        headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // Extraction robuste de la sortie
    const usage = data.usage || data.output?.[0]?.usage || null;
    const outText =
      data.output_text
      ?? data.output?.[0]?.content?.[0]?.text
      ?? data.choices?.[0]?.message?.content
      ?? '';

    const extra = new Headers(baseHeaders);
    if (usage && usage.total_tokens != null) extra.set('X-Usage-Total', String(usage.total_tokens));
    extra.set('X-Gett-Client', slug);

    return new Response(JSON.stringify({ text: String(outText || ''), usage, client: slug }), {
      headers: { ...Object.fromEntries(extra), 'Content-Type': 'application/json; charset=utf-8' }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || 'Server error' }), {
      status: 500,
      headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' }
    });
  }
}
