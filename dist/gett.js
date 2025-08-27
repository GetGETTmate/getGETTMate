// == GETT client (UI + pipeline) — version allégée =========================
(function(w,d){
  if(w.__gettClientLoaded){return} w.__gettClientLoaded = true;

  // --- Utils --------------------------------------------------------------
  function withBody(cb){ d.body ? cb() : d.addEventListener('DOMContentLoaded', cb, {once:true}); }
  function normalize(s){ return (s||"").replace(/\s+/g," ").trim(); }
  function cleanModelOutput(s){ return (s||"").replace(/\s+/g," ").trim(); }
  function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
  async function fetchWithTimeout(url, options, timeoutMs){
    const controller = new AbortController();
    const id = setTimeout(()=>controller.abort(), timeoutMs);
    try{ return await fetch(url, { ...options, signal: controller.signal }); }
    finally{ clearTimeout(id); }
  }
  function mergeDeep(a,b){
    const out = {...a};
    for(const k in b){
      const v = b[k];
      out[k] = (v && typeof v==='object' && !Array.isArray(v)) ? mergeDeep(out[k]||{}, v) : v;
    }
    return out;
  }

  // --- Config -------------------------------------------------------------
  const defaults = {
    right: "18px",
    bottom: "18px",
    z: 99999,
    api: {
      type: "simple",                 // 'simple' (ton /api/transform) ou 'openai'
      endpoint: "https://get-gett-mate.vercel.app/api/transform",
      key: "",
      headers: {}, // <-- plus de X-Gett-Client ici (injecté runtime via GTM)
      timeoutMs: 8000,
      retries: 1,
      minChars: 12,
      maxChars: 1200,
      concurrency: 3
    },
    // ⚠️ protège aussi le widget
    excludeSelectors: "script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-gett-exclude],[data-gett-widget],[aria-hidden='true']",
    requireConsent: false,
    learnUrl: "https://gett.example"
  };
  const cfg = mergeDeep(defaults, w.gettCfg || {});

  // --- (Optionnel) fallback pour X-Gett-Client via <meta> -----------------
  (function ensureClientSlug(){
    const hasHeader = cfg?.api?.headers && Object.keys(cfg.api.headers).some(k => k.toLowerCase() === "x-gett-client");
    if (!hasHeader){
      const meta = d.querySelector('meta[name="x-gett-client"]');
      const slug = meta?.getAttribute('content');
      if (slug){
        cfg.api.headers = cfg.api.headers || {};
        cfg.api.headers["X-Gett-Client"] = slug;
      }
    }
  })();

  // --- State --------------------------------------------------------------
  let currentMode = null;
  const originalMap = new WeakMap();
  const processing = new Set();
  const enqueued = new WeakSet();
  const queue = [];
  let running = 0;
  const initialHtmlLang = d.documentElement.getAttribute('lang') || '';

  // --- UI -----------------------------------------------------------------
  const ui = createUI();
  attachStyles();
  withBody(()=> d.body.appendChild(ui.root));

  function createUI(){
    const root = d.createElement('div');
    root.setAttribute('data-gett-widget',''); // exclure le widget

    const launcher = d.createElement('button');
    launcher.id = 'gett-launcher';
    launcher.setAttribute('aria-expanded','false');
    launcher.setAttribute('aria-controls','gett-popin');
    launcher.setAttribute('aria-label','Ouvrir les préférences gett');
    launcher.innerHTML = '<span aria-hidden="true" style="font-weight:700; font-size:1.1rem; line-height:1">G</span>';
    root.appendChild(launcher);

    const popin = d.createElement('section');
    popin.id = 'gett-popin';
    popin.setAttribute('role','dialog');
    popin.setAttribute('aria-modal','false');
    popin.setAttribute('aria-labelledby','gett-title');
    popin.innerHTML = `
      <div class="popin-head">
        <div class="title" id="gett-title">Gett - Typologie de lecture</div>
      </div>
      <div class="popin-body" id="popin-body">
        <div class="buttons-col">
          <button class="button" id="btn-feminine">Féminin</button>
          <button class="button" id="btn-masculine">Masculin</button>
          <button class="button" id="btn-translate-en">🇬🇧 Anglais</button>
          <button class="button" id="btn-vanilla">Annuler (Vanilla)</button>
          <button class="button learn" id="btn-learn">En savoir + sur Gett</button>
        </div>
        <div class="subtitle">gendertexttransform.com</div>
      </div>`;
    root.appendChild(popin);

    function open(){ popin.classList.add('open'); launcher.setAttribute('aria-expanded','true'); }
    function close(){ popin.classList.remove('open'); launcher.setAttribute('aria-expanded','false'); }
    function toggle(){ popin.classList.contains('open') ? close() : open(); }

    launcher.addEventListener('click', toggle);
    d.addEventListener('click', (e)=>{
      if(!popin.classList.contains('open')) return;
      const within = popin.contains(e.target) || launcher.contains(e.target);
      if(!within) close();
    });
    d.addEventListener('keydown', (e)=>{ if(e.key==='Escape') close(); });

    // Actions
    popin.querySelector('#btn-feminine').addEventListener('click', ()=>{ close(); onSelectMode("feminine"); });
    popin.querySelector('#btn-masculine').addEventListener('click', ()=>{ close(); onSelectMode("masculine"); });
    popin.querySelector('#btn-translate-en').addEventListener('click', ()=>{ close(); onSelectMode("translate-en"); });
    popin.querySelector('#btn-vanilla' ).addEventListener('click', ()=>{ close(); onReset(); });
    popin.querySelector('#btn-learn'   ).addEventListener('click', ()=>{ onLearn(); });

    function onSelectMode(mode){
      currentMode = mode;
      if(mode === 'translate-en'){ d.documentElement.setAttribute('lang','en'); }
      runPipeline();
    }
    function onReset(){
      currentMode = null;
      d.documentElement.setAttribute('lang', initialHtmlLang || '');
      revertAll();
    }
    function onLearn(){ const url = cfg.learnUrl || '#'; w.open(url, '_blank', 'noopener,noreferrer'); }

    return { root, onSelectMode, onReset, onLearn };
  }

  function attachStyles(){
    const css = `
    :root{ --stroke:rgba(0,0,0,.12); --shadow:0 6px 18px rgba(0,0,0,.08); --bg:#fff; --text:#111; --muted:#666; --radius:14px; }
    #gett-launcher{
      position:fixed; right:${cfg.right}; bottom:${cfg.bottom}; z-index:${cfg.z};
      width:52px; height:52px; border-radius:12px; background:var(--bg); color:var(--text);
      border:1px solid var(--stroke); display:grid; place-items:center; box-shadow:var(--shadow);
      cursor:pointer; transition:transform .12s ease;
    }
    #gett-launcher:hover{ transform: translateY(-1px); }
    #gett-popin{
      position:fixed; right:${cfg.right}; bottom:calc(${cfg.bottom} + 60px); z-index:${cfg.z + 1};
      width:clamp(320px, 32vw, 420px); background:var(--bg); border:1px solid var(--stroke);
      border-radius:var(--radius); box-shadow:var(--shadow); overflow:hidden;
      opacity:0; transform:translateY(8px) scale(.98); visibility:hidden;
      transition:opacity .16s ease, transform .16s ease, visibility .16s ease;
    }
    #gett-popin.open{ opacity:1; transform:translateY(0) scale(1); visibility:visible; }
    .popin-head{ display:flex; align-items:center; justify-content:space-between; padding:.75rem .9rem; border-bottom:1px solid var(--stroke); background:#fff; }
    .title{ font-weight:600; font-size:.95rem; color:var(--text); }
    .popin-body{ padding:.9rem; display:flex; flex-direction:column; gap:.7rem; max-height:60dvh; overflow:auto; }
    .buttons-col{ display:flex; flex-direction:column; gap:.45rem; }
    .button{ width:100%; padding:.6rem .8rem; border-radius:10px; border:1px solid var(--stroke); background:#fafafa; cursor:pointer; transition:background .12s ease, transform .04s ease; font-size:.95rem; text-align:left; color:var(--text); }
    .button:hover{ background:#f0f0f0; } .button:active{ transform: translateY(1px); }
    .button.learn{ margin-top:.4rem; background:#fff; text-align:center; }
    .subtitle{ font-size:.85rem; color:var(--muted); margin-top:.2rem; }
    `;
    const s = d.createElement('style'); s.textContent = css; d.head.appendChild(s);
  }

  // --- Pipeline -----------------------------------------------------------
  const mo = new MutationObserver(muts=>{
    if(!currentMode) return;
    for(const m of muts){
      for(const n of m.addedNodes){
        if(n.nodeType===1){ enqueueTextNodes(n); pumpQueue(); }
        else if(n.nodeType===3){ enqueueNode(n); pumpQueue(); }
      }
    }
  });
  mo.observe(d.documentElement, { childList:true, subtree:true });

  function runPipeline(){
    if(cfg.requireConsent && !hasConsent()) return;
    enqueueTextNodes(d.body);
    pumpQueue();
  }

  function enqueueTextNodes(root){
    const walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node){
        if(!node || !node.nodeValue || !node.parentElement) return NodeFilter.FILTER_REJECT;
        if(shouldExclude(node.parentElement)) return NodeFilter.FILTER_REJECT;
        const t = normalize(node.nodeValue);
        if(!t) return NodeFilter.FILTER_REJECT;
        if(t.length < cfg.api.minChars) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n; while((n = walker.nextNode())) enqueueNode(n);
  }

  function enqueueNode(node){
    if(!node || !node.parentElement) return;
    if(processing.has(node) || enqueued.has(node)) return;
    enqueued.add(node);
    queue.push(node);
  }

  function pumpQueue(){
    while(running < cfg.api.concurrency && queue.length){
      const node = queue.shift();
      if(!node || !node.parentElement || !node.isConnected){
        enqueued.delete(node);
        continue;
      }
      processing.add(node); running++;
      transformNode(node, currentMode)
        .catch(err=>console.warn("[GETT] transform error:", err))
        .finally(()=>{
          running--;
          processing.delete(node);
          enqueued.delete(node);
          pumpQueue();
        });
    }
  }

  async function transformNode(node, mode){
    if(!mode) return;
    const raw = node.nodeValue || "";
    const text = normalize(raw).slice(0, cfg.api.maxChars);
    if(!text) return;
    if(!originalMap.has(node)) originalMap.set(node, { text: raw });

    const out = await callAPI(text, mode);
    if(typeof out === "string" && out.trim() && node.isConnected){
      node.nodeValue = out;
    }
  }

  function revertAll(){
    const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT, null);
    let n; while((n = walker.nextNode())){
      const saved = originalMap.get(n);
      if(saved && typeof saved.text === "string") n.nodeValue = saved.text;
    }
  }

  async function callAPI(text, mode){
    const body = (cfg.api.type === "openai")
      ? openaiBody(text, mode)
      : { text, mode };

    const headers = { "Content-Type": "application/json" };
    if (cfg.api.key) headers["Authorization"] = "Bearer " + cfg.api.key;
    if (cfg.api.headers){
      for (const k in cfg.api.headers) headers[k] = cfg.api.headers[k];
    }

    let lastErr = null;
    for(let i=0;i<=cfg.api.retries;i++){
      try{
        const res = await fetchWithTimeout(cfg.api.endpoint, {
          method: "POST", headers, body: JSON.stringify(body)
        }, cfg.api.timeoutMs);
        if(!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();

        if(cfg.api.type === "openai"){
          const out = data?.choices?.[0]?.message?.content || "";
          return cleanModelOutput(out);
        }else{
          const txt = (typeof data?.text === "string") ? data.text : "";
          return cleanModelOutput(txt);
        }
      }catch(e){
        lastErr = e; if(i === cfg.api.retries) throw e;
        await sleep(250*(i+1));
      }
    }
    throw lastErr;
  }

  function openaiBody(text, mode){
    const system =
      "Tu es un post-processeur de texte pour le web. " +
      "Quand mode = 'feminine' ou 'masculine', réécris le texte au genre demandé sans ajouter ni retirer d'information. " +
      "Quand mode = 'inclusive', applique un français inclusif de façon régulière (ex: lecteur·rice·s). " +
      "Quand mode = 'translate-en', traduis du français vers l'anglais naturel en conservant strictement la mise en forme HTML si présente et sans ajouter d'explication.";
    const user = "Mode: " + mode + "\nTexte:\n" + text;
    return {
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [{ role:"system", content: system }, { role:"user", content: user }]
    };
  }

  function shouldExclude(el){
    if(!el || el.nodeType !== 1) return true;
    try{ if(el.closest(cfg.excludeSelectors)) return true; }catch(_){}
    const role = el.getAttribute?.('role');
    if(role && /button|link|textbox|combobox|menu|navigation/i.test(role)) return true;
    const tag = el.tagName;
    if(/SCRIPT|STYLE|TEXTAREA|INPUT|SELECT/.test(tag)) return true;
    return false;
  }

  function hasConsent(){ return true; }

})(window,document);
