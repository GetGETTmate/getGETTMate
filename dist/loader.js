<script>
(function (w, d) {
  if (w.__gettInit) return;
  w.__gettInit = 1;

  // ⚙️ Config: merge sans écraser une config éventuelle déjà posée ailleurs
  w.gettCfg = Object.assign({}, w.gettCfg || {}, {
    learnUrl: "https://gett.example",
    right: "18px",
    bottom: "18px",
    z: 99999,
    requireConsent: false,
    excludeSelectors: "script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-gett-exclude],[data-gett-widget],[aria-hidden='true']",
    api: {
      type: "simple",
      endpoint: "https://get-gett-mate.vercel.app/api/transform",
      key: "",
      headers: { "X-Gett-Client": "leschineries" },
      timeoutMs: 8000,
      retries: 1,
      minChars: 12,
      maxChars: 1200,
      concurrency: 3
    }
  });

  function load() {
    var s = d.createElement("script");
    s.async = true;
    // ✅ Ajoute un cache-buster; incrémente quand tu publies une nouvelle version
    s.src = "https://cdn.jsdelivr.net/gh/GetGETTmate/getGETTMate@main/dist/gett.js?v=20250827";
    s.crossOrigin = "anonymous";
    s.onerror = function (e) {
      console.error("[GETT] Échec de chargement du client gett.js", e, s.src);
    };
    d.head.appendChild(s);
  }

  if (d.readyState === "loading") {
    d.addEventListener("DOMContentLoaded", load, { once: true });
  } else {
    load();
  }
})(window, document);
</script>
