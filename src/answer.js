// The served desk grows a calm progress line. public/research.html stays as it is.

import { PROGRESS_LINES, PROGRESS_POLL_MS } from "./progress.js";

const PROGRESS_STYLE = [
  "#progress{box-sizing:border-box;display:block;width:min(100%,40rem);max-width:100%;margin:12px auto 0;text-align:center;overflow-wrap:anywhere}",
  "#progress[hidden]{display:none}",
  "#progress-line{display:block;font:13px/1.4 var(--om-font-mono,ui-monospace,monospace);letter-spacing:.08em;text-transform:uppercase;color:color-mix(in srgb, var(--ice,#B8E8FF) 82%, var(--ink,#E6EDF3))}",
  "#progress-mark{display:block;height:2px;width:min(9rem,42%);margin:10px auto 0;border-radius:999px;background:color-mix(in srgb, var(--ice,#B8E8FF) 70%, transparent)}",
  "@media (prefers-reduced-motion: no-preference){html[data-motion=\"full\"] #progress-mark{animation:progress-calm 2.8s ease-in-out infinite}}",
  "@keyframes progress-calm{0%,100%{opacity:.4}50%{opacity:1}}",
  "@media (prefers-reduced-motion: reduce){#progress-mark{animation:none;opacity:1}}",
  "html[data-motion=\"reduce\"] #progress-mark{animation:none;opacity:1}",
  "body[data-ui=\"minimal\"] #progress{margin:0}",
].join("");

const PROGRESS_NODE =
  '<p id="progress" role="status" aria-live="polite" aria-atomic="true" hidden><span id="progress-line"></span><span id="progress-mark" aria-hidden="true"></span></p>';

function progressScript() {
  const lines = JSON.stringify({
    planning: PROGRESS_LINES.planning,
    reading: PROGRESS_LINES.reading,
    direct: PROGRESS_LINES.direct,
    synthesis: PROGRESS_LINES.synthesis,
    helperOne: PROGRESS_LINES.helperOne,
    helpers: PROGRESS_LINES.helpers,
  });
  return `<script>
(function(){
  var LINES=${lines};
  var POLL_MS=${PROGRESS_POLL_MS};
  var nativeFetch=window.fetch.bind(window);
  var flights=0;
  var timer=null;
  function lineFor(j){
    var phase=j&&typeof j.phase==="string"?j.phase:"";
    var n=j&&Array.isArray(j.helpers)?j.helpers.length:0;
    if(phase==="planning") return LINES.planning;
    if(phase==="reading") return LINES.reading;
    if(phase==="direct") return LINES.direct;
    if(phase==="synthesis") return LINES.synthesis;
    if(phase==="helpers") return n===1?LINES.helperOne:(n>1?n+" helpers.":LINES.helpers);
    return "";
  }
  function showProgress(line){
    var el=document.getElementById("progress");
    var text=document.getElementById("progress-line");
    if(!el||!text) return;
    text.textContent=line||LINES.reading;
    el.hidden=false;
    el.setAttribute("aria-busy","true");
  }
  function hideProgress(){
    var el=document.getElementById("progress");
    if(!el) return;
    el.hidden=true;
    el.removeAttribute("aria-busy");
  }
  function readProgress(){
    nativeFetch("/research/progress",{cache:"no-store"}).then(function(r){return r.ok?r.json():null;}).then(function(j){
      if(flights===0) return;
      var line=lineFor(j);
      if(line) showProgress(line);
    }).catch(function(){});
  }
  function startProgress(){
    flights+=1;
    showProgress(LINES.reading);
    if(timer) return;
    readProgress();
    timer=setInterval(readProgress, POLL_MS);
  }
  function stopProgress(){
    flights=Math.max(0,flights-1);
    if(flights>0) return;
    if(timer){ clearInterval(timer); timer=null; }
    hideProgress();
  }
  window.fetch=function(input, init){
    var url=typeof input==="string"?input:(input&&input.url)||"";
    var asking=url.split("?")[0].endsWith("/research/ask");
    if(asking) startProgress();
    return nativeFetch(input, init).then(function(res){
      if(asking) stopProgress();
      return res;
    }, function(err){
      if(asking) stopProgress();
      throw err;
    });
  };
})();
</script>`;
}

export function withAnswerSurface(html) {
  let text = Buffer.isBuffer(html) ? html.toString("utf8") : String(html);
  if (text.includes('id="progress"')) return text;
  if (text.includes("</style>")) text = text.replace("</style>", `${PROGRESS_STYLE}</style>`);
  const loadingAt = text.indexOf('id="loading"');
  const loadingEnd = loadingAt >= 0 ? text.indexOf("</p>", loadingAt) : -1;
  if (loadingEnd >= 0) text = `${text.slice(0, loadingEnd + 4)}\n  ${PROGRESS_NODE}${text.slice(loadingEnd + 4)}`;
  const scriptAt = text.indexOf("<script>");
  if (scriptAt >= 0) text = `${text.slice(0, scriptAt)}${progressScript()}\n${text.slice(scriptAt)}`;
  return text;
}
