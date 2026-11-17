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

const SOURCE_STYLE = [
  "#sources .piles{display:none}",
  "#source-links{list-style:none;margin:0;padding:0;display:grid;gap:16px}",
  "#source-links li{min-width:0}",
  ".source-title{margin:0;font:16px/1.45 var(--om-font-sans,system-ui,sans-serif);color:var(--ink,#E6EDF3);overflow-wrap:anywhere}",
  ".source-domain{margin:4px 0 0;font:12px/1.4 var(--om-font-mono,ui-monospace,monospace);letter-spacing:.04em;color:var(--quiet,#A7B6C4)}",
  ".source-link{display:flex;align-items:center;min-height:44px;max-width:100%;font:14px/1.4 var(--om-font-sans,system-ui,sans-serif);color:var(--ice,#B8E8FF);overflow-wrap:anywhere;text-decoration:underline;text-underline-offset:3px}",
  "#source-links-empty{margin:0;font:15px/1.45 var(--om-font-sans,system-ui,sans-serif);color:var(--quiet,#A7B6C4)}",
  "#citation-list a{color:var(--ice,#B8E8FF);overflow-wrap:anywhere}",
].join("");

const SOURCE_NODE =
  '<ol id="source-links"></ol>\n      <p id="source-links-empty">No source yet.</p>';

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
  function safeHref(value){
    if(typeof value!=="string"||!value.trim()) return "";
    try {
      var url=new URL(value.trim());
      if(url.protocol!=="http:"&&url.protocol!=="https:") return "";
      if(url.username||url.password||!url.hostname) return "";
      return url.href;
    } catch(e) { return ""; }
  }
  function hostOf(href){
    try { return new URL(href).hostname.replace(/^www\\./i,"").toLowerCase(); }
    catch(e) { return ""; }
  }
  function viewOf(text){
    var raw=String(text||"").replace(/\\s+/g," ").trim();
    var match=raw.match(/https?:\\/\\/[^\\s<>\"')\\]]+/i);
    var href="";
    var title=raw;
    if(match){
      href=safeHref(match[0].replace(/[.,;:]+$/,""));
      title=raw.replace(match[0]," ").replace(/[\\[\\]()]/g," ").replace(/\\s+/g," ").trim();
      title=title.replace(/^[\\-\\u2013\\u2014:|]+|[\\-\\u2013\\u2014:|]+$/g,"").trim();
    }
    if(!title) title=href?hostOf(href):"";
    return {title:title, domain:href?hostOf(href):"", href:href};
  }
  function clearNode(node){ while(node.firstChild) node.removeChild(node.firstChild); }
  function paintSourceList(sources){
    var list=document.getElementById("source-links");
    var empty=document.getElementById("source-links-empty");
    if(!list) return;
    clearNode(list);
    var count=0;
    (sources||[]).forEach(function(source){
      if(!source) return;
      var view=viewOf(source.text||source.title||"");
      var href=safeHref(source.href)||view.href;
      var domain=href?hostOf(href):"";
      var title=source.title||view.title||source.text||"";
      if(!title) return;
      var li=document.createElement("li");
      var name=document.createElement("p");
      name.className="source-title";
      name.textContent=title;
      li.appendChild(name);
      if(domain){
        var host=document.createElement("p");
        host.className="source-domain";
        host.textContent=domain;
        li.appendChild(host);
      }
      if(href){
        var link=document.createElement("a");
        link.className="source-link";
        link.href=href;
        link.rel="noreferrer noopener";
        link.textContent=href;
        li.appendChild(link);
      }
      list.appendChild(li);
      count+=1;
    });
    if(empty) empty.hidden=count>0;
  }
  function paintCitations(cites){
    var list=document.getElementById("citation-list");
    var empty=document.getElementById("citation-empty");
    if(!list||!Array.isArray(cites)) return;
    clearNode(list);
    var count=0;
    cites.forEach(function(cite){
      if(!cite||!cite.text) return;
      var view=viewOf(cite.text);
      var href=safeHref(cite.href)||view.href;
      var li=document.createElement("li");
      var mark=document.createElement("span");
      mark.className="mark";
      mark.textContent="["+(cite.n||"")+"] ";
      li.appendChild(mark);
      var title=document.createElement("span");
      title.className="source-title";
      title.textContent=view.title||cite.text;
      li.appendChild(title);
      if(href){
        li.appendChild(document.createTextNode(" "));
        var link=document.createElement("a");
        link.href=href;
        link.rel="noreferrer noopener";
        link.textContent=href;
        li.appendChild(link);
      }
      list.appendChild(li);
      count+=1;
    });
    if(empty) empty.hidden=count>0;
  }
  function watch(res, requestUrl){
    var path=String(requestUrl||res.url||"").split("?")[0];
    if(!path.endsWith("/research/ask")&&!path.endsWith("/research/history")&&!path.endsWith("/research/sources")) return;
    res.clone().json().then(function(j){
      if(!j) return;
      setTimeout(function(){
        if(Array.isArray(j.sources)) paintSourceList(j.sources);
        if(Array.isArray(j.citations)) paintCitations(j.citations);
      },0);
    }).catch(function(){});
  }
  window.fetch=function(input, init){
    var url=typeof input==="string"?input:(input&&input.url)||"";
    var asking=url.split("?")[0].endsWith("/research/ask");
    if(asking) startProgress();
    return nativeFetch(input, init).then(function(res){
      if(asking) stopProgress();
      watch(res, url);
      return res;
    }, function(err){
      if(asking) stopProgress();
      throw err;
    });
  };
})();
</script>`;
}

function insertStyle(text, marker, css) {
  if (text.includes(marker) || !text.includes("</style>")) return text;
  return text.replace("</style>", `${css}</style>`);
}

export function withAnswerSurface(html) {
  let text = Buffer.isBuffer(html) ? html.toString("utf8") : String(html);
  text = insertStyle(text, "#progress{", PROGRESS_STYLE);
  text = insertStyle(text, "#source-links{", SOURCE_STYLE);
  if (!text.includes('id="progress"')) {
    const loadingAt = text.indexOf('id="loading"');
    const loadingEnd = loadingAt >= 0 ? text.indexOf("</p>", loadingAt) : -1;
    if (loadingEnd >= 0) text = `${text.slice(0, loadingEnd + 4)}\n  ${PROGRESS_NODE}${text.slice(loadingEnd + 4)}`;
  }
  if (!text.includes('id="source-links"')) {
    const labelAt = text.indexOf('id="sources-label"');
    const labelEnd = labelAt >= 0 ? text.indexOf("</h2>", labelAt) : -1;
    if (labelEnd >= 0) text = `${text.slice(0, labelEnd + 5)}\n      ${SOURCE_NODE}${text.slice(labelEnd + 5)}`;
  }
  if (!text.includes("function paintSourceList")) {
    const scriptAt = text.indexOf("<script>");
    if (scriptAt >= 0) text = `${text.slice(0, scriptAt)}${progressScript()}\n${text.slice(scriptAt)}`;
  }
  return text;
}
