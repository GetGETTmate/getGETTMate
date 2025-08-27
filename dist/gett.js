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
      endpoint: "https://api.example.com/transform",
      key: "",
      headers: {},
      timeoutMs: 8000,
      retries: 1,
      minChars: 12,
      maxChars: 1200,
      concurrency: 3
    },
    // ⚠️ protège aussi le widget
    excludeSelectors: "script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-gett-exclude],[data-gett-widget]",
    requireConsent: false,
    learnUrl: "https://gett.example"
  };
  const cfg = mergeDeep(defaults, w.gettCfg || {});

  // --- State --------------------------------------------------------------
  let currentMode = null;
  const originalMap = new WeakMap();
  const processing = new Set();
  const q
