(function(){
  const file = "images/kritor-project-2026-08-20.text-animator";
  const fadeDuration = 1400;
  let dismissed = false;

  function addIntro(){
    if(document.getElementById("kritor-intro")) return;
    const img = document.createElement("img");
    img.id = "kritor-intro";
    img.alt = "KRITOR";
    img.setAttribute("aria-hidden", "true");
    img.draggable = false;
    document.body.appendChild(img);
    return img;
  }

  function dismiss(){
    if(dismissed) return;
    dismissed = true;
    const img = document.getElementById("kritor-intro");
    if(!img) return;
    img.classList.add("is-fading");
    window.setTimeout(()=>img.classList.add("is-gone"), fadeDuration + 50);
  }

  function play(data, img){
    const frames = data?.layers?.[0]?.face?.texture?.file?.frames || [];
    if(!frames.length) throw new Error("No animation frames found");

    const duration = Number(data?.animation?.loopDuration) > 0
      ? Number(data.animation.loopDuration) * 1000
      : 2200;
    const frameTime = duration / frames.length;
    let index = 0;
    let timer = null;

    const show = () => {
      if(dismissed) return;
      const frame = frames[index];
      if(frame?.content) img.src = frame.content;
      index = (index + 1) % frames.length;
      timer = window.setTimeout(show, frameTime);
    };

    show();
    window.addEventListener("pagehide", ()=>window.clearTimeout(timer), {once:true});
  }

  const img = addIntro();
  if(!img) return;

  fetch(file, {cache:"force-cache"})
    .then(r=>r.json())
    .then(data=>play(data, img))
    .catch(err=>{
      console.error("KRITOR intro animation failed:", err);
      img.remove();
    });

  document.addEventListener("pointerdown", dismiss, {once:true, passive:true});
})();
