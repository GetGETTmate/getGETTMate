# GETT client (widget + pipeline texte)

## Chargement (via GTM recommandé)
Dans un tag **Custom HTML** (All Pages), colle :

```html
<script>
(function(w,d){
  if(w.__gettInit){return} w.__gettInit = 1;

  // 1) Config runtime — à adapter
  w.gettCfg = {
    learnUrl: "https://gett.example",
    right: "18px",
    bottom: "18px",
    z: 99999,
    requireConsent: false,
    excludeSelectors: "script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-gett-exclude]",
    api: {
      type: "simple", // "simple" ou "openai"
      endpoint: "https://api.example.com/transform", // <-- A REMPLACER
      key: "", // si besoin (Bearer)
      headers: { },
      timeoutMs: 8000,
      retries: 1,
      minChars: 12,
      maxChars: 1200,
      concurrency: 3
    }
  };

  // 2) Charger le client depuis GitHub (via jsDelivr)
  var s=d.createElement('script');
  s.async = true;
  s.src = "https://cdn.jsdelivr.net/gh/TON-USER-GH/ton-repo-gett@main/dist/gett.js";
  d.head.appendChild(s);
})(window,document);
</script>
```

> Remplace `TON-USER-GH/ton-repo-gett` par ton couple `utilisateur / repo`.

## Contrat d'API attendu

### Mode `simple`
- **POST** `endpoint`
- **Body**: `{ "text": "…", "mode": "feminine" | "masculine" }`
- **Réponse**: `{ "text": "…transformé…" }`

### Mode `openai`
- **POST** `https://api.openai.com/v1/chat/completions`
- **Headers**: `Authorization: Bearer <clé_openai>`
- **Body**: modèle `gpt-4o-mini` (voir `gett.js`)
- **Réponse**: `choices[0].message.content`

## Exclusions & restauration
- Exclusions par défaut : `script, style, noscript, code, pre, textarea, input, select, [contenteditable], [data-gett-exclude]`.
- Bouton **Annuler (original)** : restaure les nœuds modifiés.
