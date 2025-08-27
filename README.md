# GETT client (widget + pipeline texte)

## Chargement (via GTM recommandé)
Dans un tag **Custom HTML** (All Pages), on colle :

<script>
(function(w,d){
  if(w.__gettInit){return} w.__gettInit = 1;

  w.gettCfg = {
    learnUrl: "https://gett.example",
    right: "18px",
    bottom: "18px",
    z: 99999,
    requireConsent: false,
    excludeSelectors: "script,style,noscript,code,pre,textarea,input,select,[contenteditable],[data-gett-exclude]",
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
  };

  function loadGett(){
    var s = d.createElement('script');
    s.async = true;
    s.src = "https://cdn.jsdelivr.net/gh/GetGETTmate/getGETTMate@main/dist/gett.js";
    d.head.appendChild(s);
  }

  if (d.readyState === "loading") {
    d.addEventListener("DOMContentLoaded", loadGett, { once:true });
  } else {
    loadGett();
  }
})(window,document);
</script>



On ajoute dans W-Gett-Client le slug qui convient
# redeploy
