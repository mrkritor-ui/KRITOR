(function () {
  const grid=document.getElementById("grid"),glassIntro=document.getElementById("glass-intro"),glassLogo=document.querySelector(".glass-logo"),zoomControl=document.getElementById("zoom-control");
  const levels=["zoom","normal","overview"],isTouchDevice=window.matchMedia("(hover:none) and (pointer:coarse)").matches;let level=isTouchDevice?0:2,pinchStart=null,gestureStartScale=null,gestureHandled=false;
  function applyLevel(n){level=(n+levels.length)%levels.length;grid.classList.remove("view-normal","view-zoom","view-overview");grid.classList.add(`view-${levels[level]}`);if(zoomControl){zoomControl.textContent=level===2?"−":"+";zoomControl.setAttribute("aria-label",level===2?"Return to larger catalogue view":"Reduce artwork size")}}
  function workNumber(w){const m=String(w.id||"").match(/work-(\d+)/i);return m?Number(m[1]):-1}
  function makeTile(w){const a=document.createElement("a"),i=document.createElement("img");a.className="tile";a.href=`work.html?id=${encodeURIComponent(w.id)}`;a.setAttribute("aria-label",w.title?`${w.title}, ${w.year}`:`Artwork ${w.id}`);i.src=w.thumbnail||w.image;i.alt=w.title||"";i.loading="lazy";i.decoding="async";i.onerror=function(){if(w.thumbnail&&i.src.indexOf(w.thumbnail)!==-1)i.src=w.image};a.appendChild(i);return a}
  function render(){grid.innerHTML="";if(!Array.isArray(ARTWORKS)||!ARTWORKS.length)return;ARTWORKS.slice().sort((a,b)=>workNumber(b)-workNumber(a)).forEach(w=>grid.appendChild(makeTile(w)));applyLevel(level)}
  function pd(t){const a=t[0],b=t[1];return Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)}render();if(zoomControl)zoomControl.addEventListener("click",()=>applyLevel(level+1));
  grid.addEventListener("gesturestart",e=>{gestureStartScale=e.scale||1;gestureHandled=false;e.preventDefault()},{passive:false});grid.addEventListener("gesturechange",e=>{e.preventDefault();if(gestureHandled||gestureStartScale===null)return;const s=e.scale||1;if(Math.abs(s-gestureStartScale)>.12){applyLevel(level+(s>gestureStartScale?-1:1));gestureHandled=true}},{passive:false});grid.addEventListener("gestureend",e=>{e.preventDefault();gestureStartScale=null;gestureHandled=false},{passive:false});grid.addEventListener("touchstart",e=>{if(e.touches.length===2)pinchStart=pd(e.touches)},{passive:true});grid.addEventListener("touchmove",e=>{if(e.touches.length!==2||pinchStart===null)return;const d=pd(e.touches)-pinchStart;if(Math.abs(d)>80){applyLevel(level+(d>0?-1:1));pinchStart=pd(e.touches)}},{passive:true});grid.addEventListener("touchend",()=>pinchStart=null,{passive:true});

  // Any explicit catalogue return is a silent return: never show the glass intro.
  const returnToCatalogue=new URLSearchParams(location.search).get("return");
  if(returnToCatalogue==="catalogue"&&glassIntro){glassIntro.classList.add("clear");glassIntro.setAttribute("aria-hidden","true");return}

  // Only a fresh/direct catalogue visit gets the glass intro.
  if(glassIntro){function dismiss(e){e.preventDefault();e.stopPropagation();glassIntro.classList.add("clear");glassIntro.setAttribute("aria-hidden","true")}glassIntro.addEventListener("click",dismiss,{capture:true});glassIntro.addEventListener("touchend",dismiss,{capture:true,passive:false});if(glassLogo)glassLogo.addEventListener("click",dismiss,{capture:true})}
})();
