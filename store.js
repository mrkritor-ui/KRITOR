(function(){
  const grid=document.getElementById("grid");
  if(!grid)return;
  const zoomControl=document.getElementById("zoom-control");
  const levels=["zoom","normal","overview"];
  const isTouchDevice=window.matchMedia("(hover:none) and (pointer:coarse)").matches;
  const STATE_KEY="kritor-store-state";

  const savedState=(()=>{try{return JSON.parse(sessionStorage.getItem(STATE_KEY)||"null")}catch(e){return null}})();
  let level=savedState&&Number.isInteger(savedState.level)?Math.max(0,Math.min(levels.length-1,savedState.level)):(isTouchDevice?0:2);
  let pinchStart=null,gestureStartScale=null,gestureHandled=false;

  function saveState(){
    try{sessionStorage.setItem(STATE_KEY,JSON.stringify({level,scrollY:window.scrollY}))}catch(e){}
  }

  function applyLevel(n){
    level=(n+levels.length)%levels.length;
    grid.classList.remove("view-normal","view-zoom","view-overview");
    grid.classList.add(`view-${levels[level]}`);
    if(zoomControl){
      zoomControl.textContent=level===2?"−":"+";
      zoomControl.setAttribute("aria-label",level===2?"Return to larger store view":"Reduce artwork size");
    }
    saveState();
  }

  /* The store lives at /store/, so catalogue-relative asset paths need rooting. */
  function assetPath(path){return path?(path.startsWith("/")?path:"/"+path):""}

  function makeTile(w){
    const a=document.createElement("a"),i=document.createElement("img");
    const full=assetPath(w.image),thumb=assetPath(w.thumbnail);
    a.className="tile";
    a.dataset.workId=w.id;
    a.href=`/${encodeURIComponent(w.id)}/`;
    a.setAttribute("aria-label",w.title?`${w.title}, ${w.year}`:`Artwork ${w.id}`);
    i.src=thumb||full;
    i.alt=w.title||"";
    i.loading="lazy";
    i.decoding="async";
    i.onerror=function(){if(thumb&&i.src.indexOf(thumb)!==-1)i.src=full};
    a.appendChild(i);
    return a;
  }

  function storeWorks(){
    if(typeof PRODUCTS==="undefined"||!Array.isArray(PRODUCTS))return[];
    if(typeof ARTWORKS==="undefined"||!Array.isArray(ARTWORKS))return[];
    const byId=new Map(ARTWORKS.map(w=>[w.id,w]));
    return PRODUCTS.filter(p=>p.available!==false).map(p=>byId.get(p.id)).filter(Boolean);
  }

  function render(){
    grid.innerHTML="";
    storeWorks().forEach(w=>grid.appendChild(makeTile(w)));
    applyLevel(level);
    if(savedState&&Number.isFinite(savedState.scrollY))requestAnimationFrame(()=>window.scrollTo(0,savedState.scrollY));
  }

  render();

  grid.addEventListener("click",e=>{if(e.target.closest("a.tile"))saveState()});
  if(zoomControl)zoomControl.addEventListener("click",()=>applyLevel(level+1));

  function pd(t){const a=t[0],b=t[1];return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)}
  grid.addEventListener("gesturestart",e=>{gestureStartScale=e.scale||1;gestureHandled=false;e.preventDefault()},{passive:false});
  grid.addEventListener("gesturechange",e=>{
    e.preventDefault();
    if(gestureHandled||gestureStartScale===null)return;
    const s=e.scale||1;
    if(Math.abs(s-gestureStartScale)>.12){applyLevel(level+(s>gestureStartScale?-1:1));gestureHandled=true}
  },{passive:false});
  grid.addEventListener("gestureend",e=>{e.preventDefault();gestureStartScale=null;gestureHandled=false},{passive:false});
  grid.addEventListener("touchstart",e=>{if(e.touches.length===2)pinchStart=pd(e.touches)},{passive:true});
  grid.addEventListener("touchmove",e=>{
    if(e.touches.length!==2||pinchStart===null)return;
    const d=pd(e.touches)-pinchStart;
    if(Math.abs(d)>80){applyLevel(level+(d>0?-1:1));pinchStart=pd(e.touches)}
  },{passive:true});
  grid.addEventListener("touchend",()=>pinchStart=null,{passive:true});
})();
