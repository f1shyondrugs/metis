import assert from "node:assert/strict";
import test from "node:test";
import { imageFramingStyle, parseImageFraming, validImageCrop, withImageFraming, bannerStyle, bannerFadeStyle, withBannerStyle } from "../lib/image-framing";

test("display modes retain the original image and replace only recognized framing metadata", () => {
  for (const original of ["/api/profile/avatar/" + "a".repeat(48), "/api/notes/note/attachments/file", "data:image/png;base64,AAA="]) {
    const crop = { mode: "crop" as const, area: { x: 15, y: 20, width: 30, height: 60 } };
    const value = withImageFraming(original, crop);
    assert.deepEqual(parseImageFraming(value), { source: original, framing: crop, valid: true });
    assert.equal(withImageFraming(value, { mode: "fit" }), original + "#metis-image=fit");
    assert.equal(withImageFraming(value, null), original);
  }
  assert.deepEqual(parseImageFraming("/image.png#ordinary"), { source: "/image.png#ordinary", framing: null, valid: true });
});

test("banner style is independent of crop and whole image, and retains the original source", () => {
  const original = "/api/profile/banner/" + "b".repeat(48);
  const crop = {mode:"crop" as const,area:{x:10,y:20,width:50,height:25}};
  for (const framing of [crop,{mode:"fit" as const}]) {
    const value=withImageFraming(original,framing),fade=withBannerStyle(value,"fade");
    assert.equal(parseImageFraming(fade).source,original);
    assert.deepEqual(parseImageFraming(fade).framing,{...framing,bannerStyle:"fade"});
    assert.equal(bannerStyle(fade),"fade");
    assert.equal(withBannerStyle(fade,"standard"),value);
    assert.equal(withBannerStyle(fade,"fade"),fade);
  }
  assert.equal(bannerStyle(null),"standard");
  assert.equal(bannerStyle(original),"standard");
  assert.equal(parseImageFraming(withBannerStyle(original,"fade")).valid,true);
  assert.equal(bannerFadeStyle("standard"),undefined);
  assert.deepEqual(bannerFadeStyle("fade"),{maskImage:"linear-gradient(to bottom, #000 0%, transparent 100%)",WebkitMaskImage:"linear-gradient(to bottom, #000 0%, transparent 100%)"});
  for(const suffix of ["fit;banner=unknown","fit;banner=fade;banner=fade","fit;banner=fade;opacity:0"])
    assert.equal(parseImageFraming(original+"#metis-image="+suffix).valid,false);
});

test("invalid, repeated and unbounded crop values cannot become a framing instruction", () => {
  for (const suffix of ["crop,NaN,0,100,100", "crop,-1,0,100,100", "crop,0,0,0,100", "crop,80,0,50,100", "crop,0,0,Infinity,100", "crop,1..2,0,10,10", "fit#metis-image=fit", "fit;opacity:0"]) {
    assert.equal(parseImageFraming("/image.png#metis-image=" + suffix).valid, false, suffix);
  }
  assert.equal(validImageCrop({ x: 0, y: 0, width: NaN, height: 10 }), false);
});

test("saved percentage crops reproduce their position and scale at the target aspect", () => {
  // Independently derive the rendered pixel bounds from CSS cover, position, scale and transform origin.
  for (const [imageWidth, imageHeight, containerWidth, containerHeight, zoom, anchorX, anchorY] of [
    [1200,800,400,100,1,0.2,0.8], [800,1200,200,200,2.5,0.8,0.25], [1600,400,400,100,3,0.4,0.6],
  ]) {
    const scale = Math.max(containerWidth/imageWidth, containerHeight/imageHeight);
    const displayedWidth=imageWidth*scale*zoom, displayedHeight=imageHeight*scale*zoom;
    const width=100*containerWidth/displayedWidth, height=100*containerHeight/displayedHeight;
    const x=(100-width)*anchorX, y=(100-height)*anchorY;
    const style=imageFramingStyle({mode:"crop",area:{x,y,width,height}});
    const positions=String(style.objectPosition).split(" ").map(parseFloat);
    const actualZoom=Number(String(style.transform).slice(6,-1));
    const left=(containerWidth-imageWidth*scale)*positions[0]/100;
    const top=(containerHeight-imageHeight*scale)*positions[1]/100;
    const actualLeft=left*actualZoom+(1-actualZoom)*containerWidth*positions[0]/100;
    const actualTop=top*actualZoom+(1-actualZoom)*containerHeight*positions[1]/100;
    assert.ok(Math.abs(actualLeft + x/100*displayedWidth)<0.001);
    assert.ok(Math.abs(actualTop + y/100*displayedHeight)<0.001);
    assert.ok(Math.abs(actualZoom-zoom)<0.0001);
  }
});

test("whole-image mode inscribes every corner in a round avatar, including portrait and wide originals", () => {
  for (const aspect of [0.05,0.5,1,2,20]) {
    const style=imageFramingStyle({mode:"fit"},true,aspect);
    const scale=Number(String(style.transform).slice(6,-1));
    const w=aspect>=1?scale:scale*aspect,h=aspect>=1?scale/aspect:scale;
    assert.ok(Math.hypot(w/2,h/2)<=0.500001);
    assert.equal(style.objectFit,"contain");
    assert.equal(style.borderRadius,0);
  }
  assert.equal(imageFramingStyle({mode:"fit"}).transform,"scale(1)");
});
