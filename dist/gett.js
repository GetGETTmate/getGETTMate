// == GETT client (UI maquette exacte + compat Safari) =====================
(function(w,d){
  if(w.__gettClientLoaded){return} w.__gettClientLoaded = true;

  function withBody(cb){
    if (d.body) cb(); else d.addEventListener('DOMContentLoaded', function(){ cb(); }, {once:true});
  }

  var defaults = {
    right: "18px",
    bottom: "18px",
    z: 99999,
    api: {
      type: "simple",
      endpoint: "https://api.example.com/transform",
      key: "",
      headers: {},
      timeoutMs: 8000,
      retries: 1,
      minChars: 12,
      maxChars: 1200,
      concurrency: 3
    },
    excludeSelectors: "script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-gett-exclude]",
    requireConsent: false,
    learnUrl: "https://gett.example"
  };
  var cfg = mergeDeep(defaults, w.gettCfg || {});

  var ui = createUI();
  attachStyles();
  withBody(function(){ d.body.appendChild(ui.root); });

  var currentMode = null;
  var originalMap = new WeakMap();
  var processing = new Set();
  var queue = [];
  var running = 0;

  var mo = new MutationObserver(function(muts){
    if(!currentMode) return;
    for(var i=0;i<muts.length;i++){
      var m = muts[i];
      for(var j=0;j<m.addedNodes.length;j++){
        var n = m.addedNodes[j];
        if(n.nodeType === 1){
          enqueueTextNodes(n);
          pumpQueue();
        } else if(n.nodeType === 3){
          enqueueNode(n);
          pumpQueue();
        }
      }
    }
  });
  mo.observe(d.documentElement || d.body, { childList: true, subtree: true });

  ui.onSelectMode = function(mode){
    currentMode = mode;
    runPipeline();
  };
  ui.onReset = function(){
    currentMode = null;
    revertAll();
  };
  ui.onLearn = function(){
    var url = (cfg && cfg.learnUrl) ? cfg.learnUrl : '#';
    w.open(url, '_blank', 'noopener,noreferrer');
  };

  function runPipeline(){
    if(cfg.requireConsent && !hasConsent()){
      return;
    }
    enqueueTextNodes(d.body);
    pumpQueue();
  }

  function enqueueTextNodes(root){
    var walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node){
        if(!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
        if(!node.parentElement) return NodeFilter.FILTER_REJECT;
        if(shouldExclude(node.parentElement)) return NodeFilter.FILTER_REJECT;
        var t = normalize(node.nodeValue);
        if(t.length < cfg.api.minChars) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while((n = walker.nextNode())) enqueueNode(n);
  }

  function enqueueNode(node){
    if(processing.has(node)) return;
    queue.push(node);
  }

  function pumpQueue(){
    while(running < cfg.api.concurrency && queue.length){
      var node = queue.shift();
      if(!node || !node.parentElement) continue;
      processing.add(node);
      running++;
      transformNode(node, currentMode)
        .catch(function(err){ console.warn("[GETT] transform error:", err); })
        .finally(function(){
          running--;
          processing.delete(node);
          pumpQueue();
        });
    }
  }

  async function transformNode(node, mode){
    if(!mode){ return; }
    var raw = node.nodeValue || "";
    var text = normalize(raw).slice(0, cfg.api.maxChars);
    if(!originalMap.has(node)) originalMap.set(node, { text: raw });

    var out = await callAPI(text, mode);
    if(typeof out === "string" && out.trim()){
      node.nodeValue = out;
    }
  }

  function revertAll(){
    var walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT, null);
    var n;
    while((n = walker.nextNode())){
      var saved = originalMap.get(n);
      if(saved && typeof saved.text === "string"){
        n.nodeValue = saved.text;
      }
    }
  }

  async function callAPI(text, mode){
    var body = (cfg.api.type === "openai")
      ? openaiBody(text, mode)
      : { text: text, mode: mode };

    var headers = { "Content-Type": "application/json" };
    if (cfg.api && cfg.api.key) headers["Authorization"] = "Bearer " + cfg.api.key;
    if (cfg.api && cfg.api.headers){
      for (var k in cfg.api.headers){ headers[k] = cfg.api.headers[k]; }
    }

    var lastErr = null;
    for(var i=0;i<=cfg.api.retries;i++){
      try{
        var res = await fetchWithTimeout(cfg.api.endpoint, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(body)
        }, cfg.api.timeoutMs);

        if(!res.ok) throw new Error("HTTP " + res.status);
        var data = await res.json();

        if(cfg.api.type === "openai"){
          var out = "";
          if (data && data.choices && data.choices[0] && data.choices[0].message) {
            out = data.choices[0].message.content || "";
          }
          return cleanModelOutput(out);
        }else{
          var txt = data && typeof data.text === "string" ? data.text : "";
          return cleanModelOutput(txt);
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
    var system =
      "Tu es un post-processeur de texte. " +
      "Quand mode = 'feminine' ou 'masculine', réécris tout le texte au genre demandé sans ajouter ni retirer d'information. " +
      "Quand mode = 'inclusive', applique des formes de français inclusif de façon régulière (par ex. 'lecteur·rice·s'), sans changer le sens et en évitant les formulations lourdes.";
    var user = "Mode: " + mode + "\nTexte:\n" + text;
    return {
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role:"system", content: system },
        { role:"user", content: user }
      ]
    };
  }

  function shouldExclude(el){
    if(!el || el.nodeType !== 1) return true;
    try{ if(el.closest(cfg.excludeSelectors)) return true; }catch(_){}
    var role = (el && el.getAttribute) ? el.getAttribute('role') : null;
    if(role && /button|link|textbox|combobox|menu|navigation/i.test(role)) return true;
    var tag = el.tagName;
    if(/SCRIPT|STYLE|TEXTAREA|INPUT|SELECT/.test(tag)) return true;
    return false;
  }

  function normalize(s){ s = s || ""; return s.replace(/\s+/g, " ").trim(); }
  function cleanModelOutput(s){ s = s || ""; return s.replace(/\s+/g, " ").trim(); }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  async function fetchWithTimeout(url, options, timeoutMs){
    var controller = new AbortController();
    var id = setTimeout(function(){ controller.abort(); }, timeoutMs);
    try{
      var res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
      return res;
    } finally{ clearTimeout(id); }
  }

  function mergeDeep(target, source){
    var out = {};
    for (var tk in target){ out[tk] = target[tk]; }
    for (var sk in source){
      var sv = source[sk];
      if(sv && typeof sv === 'object' && !Array.isArray(sv)){
        out[sk] = mergeDeep(out[sk] || {}, sv);
      }else{ out[sk] = sv; }
    }
    return out;
  }

  function createUI(){
    var root = d.createElement('div');

    var launcher = d.createElement('button');
    launcher.id = 'gett-launcher';
    launcher.setAttribute('aria-expanded','false');
    launcher.setAttribute('aria-controls','gett-popin');
    launcher.setAttribute('aria-label','Ouvrir les préférences gett');
    launcher.innerHTML = '<span aria-hidden="true" style="font-weight:700; font-size:1.1rem; line-height:1">G</span>';
    root.appendChild(launcher);

    var popin = d.createElement('section');
    popin.id = 'gett-popin';
    popin.setAttribute('role','dialog');
    popin.setAttribute('aria-modal','false');
    popin.setAttribute('aria-labelledby','gett-title');
    popin.innerHTML = `
      <div class="popin-head">
        <div class="title" id="gett-title">gett · Typologie de lecture</div>
        <div class="popin-actions">
          <button class="icon-btn" id="btn-min" aria-label="Réduire">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 12h12" stroke="#111" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
      <div class="popin-body" id="popin-body">
        <div class="buttons-col">
          <button class="button" id="btn-inclusive">Lecture inclusive</button>
          <button class="button" id="btn-feminine">Lecture féminine</button>
          <button class="button" id="btn-masculine">Lecture masculine</button>
          <button class="button" id="btn-vanilla">Vanilla (aucun filtre)</button>
          <button class="button learn" id="btn-learn">En savoir + sur Gett</button>
        </div>
        <div class="subtitle">Sélectionnez une option pour adapter le contenu.</div>
      </div>`;
    root.appendChild(popin);

    function open(){ popin.classList.add('open'); launcher.setAttribute('aria-expanded','true'); }
    function close(){ popin.classList.remove('open'); launcher.setAttribute('aria-expanded','false'); popin.classList.remove('minimized'); }
    function toggle(){ if(popin.classList.contains('open')) close(); else open(); }

    launcher.addEventListener('click', toggle);
    popin.querySelector('#btn-min').addEventListener('click', close);
    d.addEventListener('click', function(e){
      if(!popin.classList.contains('open')) return;
      var within = popin.contains(e.target) || launcher.contains(e.target);
      if(!within) close();
    });
    d.addEventListener('keydown', function(e){ if(e.key==='Escape') close(); });

    var femBtn  = popin.querySelector('#btn-feminine');
    var mascBtn = popin.querySelector('#btn-masculine');
    var incBtn  = popin.querySelector('#btn-inclusive');
    var vanBtn  = popin.querySelector('#btn-vanilla');
    var learnBtn= popin.querySelector('#btn-learn');

    femBtn.addEventListener('click', function(){ close(); if(typeof ui.onSelectMode==='function') ui.onSelectMode("feminine"); });
    mascBtn.addEventListener('click', function(){ close(); if(typeof ui.onSelectMode==='function') ui.onSelectMode("masculine"); });
    incBtn.addEventListener('click', function(){ close(); if(typeof ui.onSelectMode==='function') ui.onSelectMode("inclusive"); });
    vanBtn.addEventListener('click', function(){ close(); if(typeof ui.onReset==='function') ui.onReset(); });
    learnBtn.addEventListener('click', function(){ if(typeof ui.onLearn==='function') ui.onLearn(); });

    return { root: root, onSelectMode: null, onReset: null, onLearn: null };
  }

  function attachStyles(){
    var css = `
    :root{
      --stroke:rgba(0,0,0,.12);
      --shadow:0 6px 18px rgba(0,0,0,.08);
      --bg:#ffffff;
      --text:#111;
      --muted:#666;
      --radius:14px;
    }
    *{ box-sizing:border-box; }
    body{ font-family:'Inter', sans-serif; background:#f5f6f8; padding:2rem; min-height:100dvh; color:var(--text);}
    #gett-launcher{ position:fixed; right:18px; bottom:18px; z-index:99998; width:52px; height:52px; border-radius:12px; background:var(--bg); color:var(--text); border:1px solid var(--stroke); display:grid; place-items:center; box-shadow:var(--shadow); cursor:pointer; transition:transform .12s ease, filter .12s ease;}
    #gett-launcher:hover{ transform: translateY(-1px);}
    #gett-launcher:active{ transform: translateY(0);}
    #gett-popin{ position:fixed; right:18px; bottom:78px; z-index:99999; width:clamp(320px, 32vw, 420px); background:var(--bg); border:1px solid var(--stroke); border-radius:var(--radius); box-shadow:var(--shadow); overflow:hidden; opacity:0; transform:translateY(8px) scale(.98); visibility:hidden; transition:opacity .16s ease, transform .16s ease, visibility .16s ease;}
    #gett-popin.open{ opacity:1; transform:translateY(0) scale(1); visibility:visible;}
    .popin-head{ display:flex; align-items:center; justify-content:space-between; gap:.5rem; padding:.75rem .9rem; border-bottom:1px solid var(--stroke); background:#fff;}
    .title{ font-weight:600; font-size:.95rem;}
    .popin-actions{ display:flex; gap:.4rem;}
    .icon-btn{ appearance:none; background:#f6f6f6; border:1px solid var(--stroke); border-radius:10px; height:32px; min-width:32px; display:grid; place-items:center; cursor:pointer;}
    .icon-btn:hover{ background:#efefef;}
    .popin-body{ padding:.9rem; display:flex; flex-direction:column; gap:.7rem; max-height:60dvh; overflow:auto;}
    .buttons-col{ display:flex; flex-direction:column; gap:.45rem;}
    .button{ width:100%; padding:.6rem .8rem; border-radius:10px; border:1px solid var(--stroke); background:#fafafa; cursor:pointer; transition:background .12s ease, transform .04s ease; font-size:.95rem; text-align:left;}
    .button:hover{ background:#f0f0f0;}
    .button:active{ transform: translateY(1px);}
    .subtitle{ font-size:.85rem; color:var(--muted); margin-top:.2rem;}
    .button.learn{ margin-top:.4rem; background:#fff; text-align:center;}
    #gett-popin.minimized .popin-body{ display:none;}
    `;
    var s = d.createElement('style'); s.textContent = css; d.head.appendChild(s);
  }

  function hasConsent(){ return true; }

})(window,document);
