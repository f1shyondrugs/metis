/** Shared presentation asset for the web and sandboxed desktop onboarding. No bridge or network. */
export function mountOnboardingMotion(host) {
  const ns="http://www.w3.org/2000/svg", id="onboarding-"+Math.random().toString(36).slice(2);
  const svg=document.createElementNS(ns,"svg");svg.setAttribute("aria-hidden","true");
  svg.style.cssText="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;color:#fff;opacity:1";
  svg.innerHTML='<defs><pattern id="'+id+'-dots" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.1" fill="currentColor"/></pattern><mask id="'+id+'-mask" maskUnits="userSpaceOnUse"><rect width="100%" height="100%" fill="white"/><path fill="black"/></mask></defs><path fill="none" stroke="none" data-onboarding-geometry="true"/><g mask="url(#'+id+'-mask)"><rect width="100%" height="100%" fill="url(#'+id+'-dots)"/></g>';
  host.append(svg);
  const perimeter=svg.querySelectorAll("path")[1],wave=svg.querySelector("mask path"),pattern=svg.querySelector("pattern");
  const media=matchMedia("(prefers-reduced-motion: reduce)");
  let points=[],frame=0,elapsed=0,previous=0,width=0,height=0,waves=4,disposed=false;
  function resize(){
    width=host.clientWidth;height=host.clientHeight;if(!width||!height)return;
    svg.setAttribute("viewBox","0 0 "+width+" "+height);
    const x=9,y=9,w=Math.max(1,width-18),h=Math.max(1,height-18),r=Math.min(22,w/2,h/2);
    perimeter.setAttribute("d","M "+(x+r)+" "+y+" H "+(x+w-r)+" Q "+(x+w)+" "+y+" "+(x+w)+" "+(y+r)+" V "+(y+h-r)+" Q "+(x+w)+" "+(y+h)+" "+(x+w-r)+" "+(y+h)+" H "+(x+r)+" Q "+x+" "+(y+h)+" "+x+" "+(y+h-r)+" V "+(y+r)+" Q "+x+" "+y+" "+(x+r)+" "+y+" Z");
    const length=perimeter.getTotalLength(),count=Math.max(48,Math.min(480,Math.ceil(length/14)));waves=Math.max(3,Math.round(length/540));
    points=Array.from({length:count},(_,i)=>{const p=perimeter.getPointAtLength(length*i/count);const dx=width/2-p.x,dy=height/2-p.y;const norm=Math.hypot(dx,dy)||1;return {x:p.x,y:p.y,nx:dx/norm,ny:dy/norm,t:i/count};});
    draw();
  }
  function draw(){
    if(!points.length)return;
    const phase=media.matches?0:elapsed/2100;
    const path=points.map(p=>{const d=7+2.5*Math.sin(2*Math.PI*waves*p.t-phase)+1.2*Math.sin(2*Math.PI*(waves+3)*p.t+phase*.7);return (p.x+p.nx*d).toFixed(2)+" "+(p.y+p.ny*d).toFixed(2);});
    wave.setAttribute("d","M "+path.join(" L ")+" Z");
    pattern.setAttribute("patternTransform","translate("+((media.matches?0:elapsed/1300)%9).toFixed(2)+" "+((media.matches?0:elapsed/1800)%9).toFixed(2)+")");
  }
  function tick(now){frame=0;if(disposed||media.matches||document.hidden)return;elapsed+=previous?Math.min(50,now-previous):0;previous=now;draw();frame=requestAnimationFrame(tick);}
  function sync(){cancelAnimationFrame(frame);previous=0;draw();if(!disposed&&!media.matches&&!document.hidden)frame=requestAnimationFrame(tick);}
  const observer=new ResizeObserver(resize);observer.observe(host);
  media.addEventListener("change",sync);document.addEventListener("visibilitychange",sync);resize();sync();
  return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();media.removeEventListener("change",sync);document.removeEventListener("visibilitychange",sync);svg.remove();};
}
