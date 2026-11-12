/** Shared web/native presentation only. No bridge or network. */
export const ONBOARDING_TIMING=Object.freeze({edgeEnter:1000,sceneExit:180,sceneEnter:420,welcomeEnter:1500,readyTimeout:1800});
export function mountOnboardingMotion(host) {
  const ns="http://www.w3.org/2000/svg",id="onboarding-"+Math.random().toString(36).slice(2);
  const svg=document.createElementNS(ns,"svg");svg.setAttribute("aria-hidden","true");
  svg.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;color:#fff;opacity:0";
  svg.innerHTML='<defs><pattern id="'+id+'-dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.1" fill="currentColor"/></pattern><filter id="'+id+'-glow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="8"/></filter><mask id="'+id+'-mask" maskUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="white"/><path fill="black"/></mask></defs><path fill="none" stroke="none" data-onboarding-geometry="true"/><g data-onboarding-glow="true" filter="url(#'+id+'-glow)" opacity=".22"><g mask="url(#'+id+'-mask)"><rect width="100%" height="100%" fill="currentColor"/></g></g><g mask="url(#'+id+'-mask)"><rect width="100%" height="100%" fill="url(#'+id+'-dots)"/></g>';
  host.append(svg);host.dataset.onboardingEntrance="pending";
  const perimeter=svg.querySelectorAll("path")[1],wave=svg.querySelector("mask path"),pattern=svg.querySelector("pattern"),media=matchMedia("(prefers-reduced-motion: reduce)");
  let impulses=[],pulseSerial=0;
  let points=[],frame=0,elapsed=0,previous=0,width=0,height=0,waves=4,disposed=false,loaded=false,started=false,entrance=null,readyTimer=0,loadListener;
  function finishEntrance(){if(disposed)return;svg.style.opacity="1";svg.style.transform="none";host.dataset.onboardingEntrance="done";entrance?.cancel();entrance=null;}
  function reveal(){
    if(disposed||started||(!media.matches&&document.hidden))return;
    started=true;clearTimeout(readyTimer);if(loadListener)removeEventListener("load",loadListener);
    host.dataset.onboardingReady="true";host.dispatchEvent(new Event("metis:onboarding-ready"));
    svg.style.opacity="1";
    if(media.matches||typeof svg.animate!=="function"){finishEntrance();return;}
    host.dataset.onboardingEntrance="running";
    entrance=svg.animate([{opacity:0,transform:"scale(1.045)"},{opacity:1,transform:"scale(1)"}],{duration:ONBOARDING_TIMING.edgeEnter,easing:"cubic-bezier(.2,.8,.2,1)",fill:"both"});
    entrance.finished.then(finishEntrance).catch(()=>{});
  }
  function markLoaded(){if(disposed)return;loaded=true;sync();}
  function resize(){
    width=host.clientWidth;height=host.clientHeight;if(!width||!height)return;
    svg.setAttribute("viewBox","0 0 "+width+" "+height);
    const x=9,y=9,w=Math.max(1,width-18),h=Math.max(1,height-18),r=Math.min(22,w/2,h/2);
    perimeter.setAttribute("d","M "+(x+r)+" "+y+" H "+(x+w-r)+" Q "+(x+w)+" "+y+" "+(x+w)+" "+(y+r)+" V "+(y+h-r)+" Q "+(x+w)+" "+(y+h)+" "+(x+w-r)+" "+(y+h)+" H "+(x+r)+" Q "+x+" "+(y+h)+" "+x+" "+(y+h-r)+" V "+(y+r)+" Q "+x+" "+y+" "+(x+r)+" "+y+" Z");
    const length=perimeter.getTotalLength(),count=Math.max(48,Math.min(480,Math.ceil(length/14)));waves=Math.max(3,Math.round(length/540));
    points=Array.from({length:count},(_,i)=>{const p=perimeter.getPointAtLength(length*i/count),dx=width/2-p.x,dy=height/2-p.y,norm=Math.hypot(dx,dy)||1;return {x:p.x,y:p.y,nx:dx/norm,ny:dy/norm,t:i/count};});draw();
  }
  function draw(){
    if(!points.length)return;const phase=media.matches?0:elapsed/2100;
    impulses=media.matches?[]:impulses.filter(pulse=>elapsed-pulse.at<1800);
    host.dataset.onboardingPulse=impulses.length?"active":"idle";
    const path=points.map(p=>{
      const kick=impulses.reduce((sum,pulse)=>{const age=elapsed-pulse.at,distance=Math.hypot(p.x-pulse.x,p.y-pulse.y),front=distance-age*.8;return sum+3*Math.exp(-age/280)+15*Math.exp(-age/850)*Math.exp(-front*front/(2*100*100));},0);
      const d=7+2.5*Math.sin(2*Math.PI*waves*p.t-phase)+1.2*Math.sin(2*Math.PI*(waves+3)*p.t+phase*.7)+Math.min(19,kick);return (p.x+p.nx*d).toFixed(2)+" "+(p.y+p.ny*d).toFixed(2);});
    wave.setAttribute("d","M "+path.join(" L ")+" Z");pattern.setAttribute("patternTransform","translate("+((media.matches?0:elapsed/1300)%9).toFixed(2)+" "+((media.matches?0:elapsed/1800)%9).toFixed(2)+")");
  }
  function tick(now){frame=0;if(disposed||media.matches||document.hidden)return;elapsed+=previous?Math.min(50,now-previous):0;previous=now;draw();frame=requestAnimationFrame(tick);}
  function sync(){cancelAnimationFrame(frame);previous=0;draw();if(media.matches){loaded=true;reveal();if(started)finishEntrance();}else if(loaded)reveal();if(document.hidden&&entrance)finishEntrance();if(started&&!disposed&&!media.matches&&!document.hidden)frame=requestAnimationFrame(tick);}
  function pulse(event){
    if(disposed||!started||media.matches||document.hidden||event.button!==0||event.isPrimary===false)return;
    const rect=host.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
    if(x<0||y<0||x>width||y>height)return;
    impulses.push({x,y,at:elapsed});if(impulses.length>4)impulses.shift();
    host.dataset.onboardingPulseSerial=String(++pulseSerial);draw();
  }
  document.addEventListener("pointerdown",pulse,true);
  const observer=new ResizeObserver(resize);observer.observe(host);
  const pageReady=document.readyState==="complete"?Promise.resolve():new Promise(resolve=>{loadListener=resolve;addEventListener("load",loadListener,{once:true});});
  readyTimer=setTimeout(markLoaded,ONBOARDING_TIMING.readyTimeout);
  Promise.all([pageReady,document.fonts?.ready||Promise.resolve()]).then(markLoaded).catch(markLoaded);
  media.addEventListener("change",sync);document.addEventListener("visibilitychange",sync);resize();sync();
  return ()=>{disposed=true;clearTimeout(readyTimer);if(loadListener)removeEventListener("load",loadListener);entrance?.cancel();cancelAnimationFrame(frame);observer.disconnect();media.removeEventListener("change",sync);document.removeEventListener("visibilitychange",sync);document.removeEventListener("pointerdown",pulse,true);delete host.dataset.onboardingPulse;delete host.dataset.onboardingPulseSerial;delete host.dataset.onboardingReady;delete host.dataset.onboardingEntrance;svg.remove();};
}
