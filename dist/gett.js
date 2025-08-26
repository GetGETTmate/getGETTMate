// == GETT client ============================================================
(function(w,d){
  if(w.__gettClientLoaded){return} w.__gettClientLoaded = true;

  // --- 1) Config (fusionne defaults + w.gettCfg éventuel) ------------------
  const defaults = {
    right: "18px",
    bottom: "18px",
    z: 99999,
    // API "simple" par défaut : POST { text, mode } -> { text }
    api: {
      type: "simple", // "simple" | "openai"
      endpoint: "https://api.example.com/transform", // A REMPLACER
      key: "", // facultatif si ton endpoint n'en a pas besoin
      headers: {},
      timeoutMs: 8000,
      retries: 1,
      minChars: 12,
      maxChars: 1200,
      concurrency: 3
    },
    excludeSelectors: "script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-gett-exclude]",
    requireConsent: false, // passe à true si tu dépends d’un signal cookie
    learnUrl: "https://gett.example" // lien “En savoir +”
  };
  const cfg = mergeDeep(defaults, w.gettCfg || {});

  // --- 2) UI minimaliste ---------------------------------------------------
  const ui = createUI();
  attachStyles();
  d.body.appendChild(ui.root);

  // --- 3) Etat & file d’attente -------------------------------------------
  let currentMode = null; // "feminine" | "masculine" | null
  const originalMap = new WeakMap(); // Node -> {text}
  const processing = new Set();
  const queue = [];
  let running = 0;

  // --- 4) Actions UI -------------------------------------------------------
  ui.btnToggle.addEventListener('click', () => {
    ui.panel.classList.toggle('gett-open');
  });

  ui.actionFem.addEventListener('click', () => {
    currentMode = "feminine";
    ui.panel.classList.remove('gett-open');
    runPipeline();
  });

  ui.actionMasc.addEventListener('click', () => {
    currentMode = "masculine";
    ui.panel.classList.remove('gett-open');
    runPipeline();
  });

  ui.actionReset.addEventListener('click', () => {
    currentMode = null;
    ui.panel.classList.remove('gett-open');
    revertAll();
  });

  ui.actionLearn.addEventListener('click', () => {
    d.defaultView.open(cfg.learnUrl, '_blank', 'noopener,noreferrer');
  });

  // Fermer le panneau si on clique sur le - dans la bulle
  ui.btnMinus.addEventListener('click', () => {
    ui.panel.classList.remove('gett-open');
  });

  // --- 5) MutationObserver pour (ré)appliquer sur contenus dynamiques -----
  const mo = new MutationObserver(muts => {
    if(!currentMode) return; // si pas de mode actif, on ne fait rien
    for(const m of muts){
      for(const n of m.addedNodes){
        if(n.nodeType === 1){ // Element
          enqueueTextNodes(n);
          pumpQueue();
        } else if(n.nodeType === 3){ // Text
          enqueueNode(n);
          pumpQueue();
        }
      }
    }
  });
  mo.observe(d.documentElement || d.body, { childList: true, subtree: true });

  // --- 6) Pipeline principal ----------------------------------------------
  function runPipeline(){
    // (Optionnel) gestion du consentement si nécessaire
    if(cfg.requireConsent && !hasConsent()){
      console.warn("[GETT] Consentement requis non satisfait.");
      return;
    }
    // balayer la page
    enqueueTextNodes(d.body);
    pumpQueue();
  }

  function enqueueTextNodes(root){
    const walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if(!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
        if(!node.parentElement) return NodeFilter.FILTER_REJECT;
        if(shouldExclude(node.parentElement)) return NodeFilter.FILTER_REJECT;
        const t = normalize(node.nodeValue);
        if(t.length < cfg.api.minChars) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while((n = walker.nextNode())) enqueueNode(n);
  }

  function enqueueNode(node){
    if(processing.has(node)) return;
    queue.push(node);
  }

  function pumpQueue(){
    while(running < cfg.api.concurrency && queue.length){
      const node = queue.shift();
      if(!node || !node.parentElement) continue;
      processing.add(node);
      running++;
      transformNode(node, currentMode)
        .catch(err => console.warn("[GETT] transform error:", err))
        .finally(() => {
          running--;
          processing.delete(node);
          pumpQueue();
        });
    }
  }

  async function transformNode(node, mode){
    if(!mode){ return; }
    const raw = node.nodeValue || "";
    const text = normalize(raw).slice(0, cfg.api.maxChars);
    if(!originalMap.has(node)) originalMap.set(node, { text: raw });

    const out = await callAPI(text, mode);
    if(typeof out === "string" && out.trim()){
      node.nodeValue = out;
    }
  }

  function revertAll(){
    // Revenir à l’original pour tout ce qu’on a touché
    const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT, null);
    let n;
    while((n = walker.nextNode())){
      const saved = originalMap.get(n);
      if(saved && typeof saved.text === "string"){
        n.nodeValue = saved.text;
      }
    }
  }

  // --- 7) Appels API -------------------------------------------------------
  async function callAPI(text, mode){
    const body = (cfg.api.type === "openai")
      ? openaiBody(text, mode)
      : { text, mode };

    const headers = Object.assign(
      { "Content-Type":"application/json" },
      cfg.api.key ? { "Authorization": `Bearer ${cfg.api.key}` } : {},
      cfg.api.headers || {}
    );

    let lastErr;
    for(let i=0;i<=cfg.api.retries;i++){
      try{
        const res = await fetchWithTimeout(cfg.api.endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body)
        }, cfg.api.timeoutMs);

        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if(cfg.api.type === "openai"){
          const out = data?.choices?.[0]?.message?.content || "";
          return cleanModelOutput(out);
        }else{
          return cleanModelOutput(data?.text || "");
        }
      }catch(e){
        lastErr = e;
        if(i === cfg.api.retries) throw e;
        await sleep(250 * (i+1));
      }
    }
    throw lastErr;
  }

  function openaiBody(text, mode){
    const system = "Tu es un script de post-traitement côté client. Lorsque l'utilisateur demande 'feminine' ou 'masculine', tu réécris le texte fourni pour le genrer entièrement selon le genre cible, sans ajouter ni retirer d'information.";
    const user = `Mode: ${mode}\nTexte:\n${text}`;
    return {
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role:"system", content: system },
        { role:"user", content: user }
      ]
    };
  }

  // --- 8) Utilitaires ------------------------------------------------------
  function shouldExclude(el){
    if(!el || el.nodeType !== 1) return true;
    try{
      if(el.closest(cfg.excludeSelectors)) return true;
    }catch(_){}
    const role = el.getAttribute?.('role');
    if(role && /button|link|textbox|combobox|menu|navigation/i.test(role)) return true;
    const tag = el.tagName;
    if(/SCRIPT|STYLE|TEXTAREA|INPUT|SELECT/.test(tag)) return true;
    return false;
  }

  function normalize(s){ return (s||"").replace(/\s+/g, " ").trim(); }
  function cleanModelOutput(s){ return (s||"").replace(/\s+/g, " ").trim(); }
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

  async function fetchWithTimeout(url, options, timeoutMs){
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try{
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally{
      clearTimeout(id);
    }
  }

  function mergeDeep(target, source){
    const out = { ...target };
    for(const k in source){
      if(source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])){
        out[k] = mergeDeep(target[k] || {}, source[k]);
      }else{
        out[k] = source[k];
      }
    }
    return out;
  }

  // --- 9) DOM UI -----------------------------------------------------------
  function createUI(){
    const root = d.createElement('div');
    root.className = 'gett-root';
    root.style.zIndex = String(cfg.z || 99999);
    root.style.position = 'fixed';
    root.style.right = cfg.right;
    root.style.bottom = cfg.bottom;

    const btn = d.createElement('button');
    btn.className = 'gett-btn';
    btn.setAttribute('aria-label','Gett');
    btn.innerHTML = `<span class="gett-g">G</span><span class="gett-minus" aria-hidden="true">−</span>`;
    root.appendChild(btn);

    const panel = d.createElement('div');
    panel.className = 'gett-panel';
    panel.innerHTML = `
      <div class="gett-head">gett · typologie de lecture</div>
      <div class="gett-actions">
        <button class="gett-act gett-fem">Tout au féminin</button>
        <button class="gett-act gett-masc">Tout au masculin</button>
        <button class="gett-act gett-reset">Annuler (original)</button>
        <button class="gett-act gett-learn">En savoir + sur Gett</button>
      </div>
      <div class="gett-foot">Traitement local + API texte, côté client.</div>
    `;
    root.appendChild(panel);

    return {
      root,
      btnToggle: btn,
      btnMinus: btn.querySelector('.gett-minus'),
      panel,
      actionFem: panel.querySelector('.gett-fem'),
      actionMasc: panel.querySelector('.gett-masc'),
      actionReset: panel.querySelector('.gett-reset'),
      actionLearn: panel.querySelector('.gett-learn')
    };
  }

  function attachStyles(){
    const css = `
    .gett-root{ font-family: Inter,system-ui,Arial,sans-serif; }
    .gett-btn{
      display:flex; align-items:center; gap:8px;
      padding:10px 14px; border-radius:14px; border:1px solid rgba(0,0,0,.1);
      background:#fff; box-shadow:0 6px 18px rgba(0,0,0,.08); cursor:pointer;
    }
    .gett-g{
      display:inline-grid; place-items:center; width:26px; height:26px;
      border-radius:8px; border:1px solid rgba(0,0,0,.6); font-weight:700;
      line-height:1; user-select:none;
    }
    .gett-minus{ opacity:.5; font-weight:700; }
    .gett-panel{
      position:absolute; right:0; bottom:58px; width:280px; border-radius:14px;
      border:1px solid rgba(0,0,0,.12); background:#fff; box-shadow:0 12px 28px rgba(0,0,0,.12);
      padding:12px; display:none;
    }
    .gett-open{ display:block !important; }
    .gett-head{ font-weight:600; font-size:14px; margin-bottom:8px; }
    .gett-actions{ display:grid; gap:8px; }
    .gett-act{
      width:100%; padding:10px 12px; border-radius:10px; border:1px solid rgba(0,0,0,.12);
      background:#fafafa; cursor:pointer;
    }
    .gett-act:hover{ background:#f3f3f3; }
    .gett-foot{ color:#666; font-size:12px; margin-top:10px; }
    `;
    const s = d.createElement('style');
    s.textContent = css;
    d.head.appendChild(s);
  }

  function hasConsent(){
    // branche ici ton signal consent (par ex. window.dataLayer/x)
    // retourne true si ok, false sinon
    return true;
  }

})(window,document);
// ==========================================================================
// Fin GETT client
