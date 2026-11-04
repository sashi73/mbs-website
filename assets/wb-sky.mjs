// Wonder Bird (v105): a realistic sky, drawn once per level on the graphics card (WebGL fragment shader, the same kind of
// technique game engines use): sky colour that deepens with height, sun or moon with glow and bloom, fluffy clouds made from
// layered noise and lit from the sun's side (silver edges, darker bellies), stars at night, and distant mountain ranges that
// fade into the haze (aerial perspective), with snow on the peaks where it belongs. Falls back to the canvas sky without WebGL.

const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
const FS = `
precision highp float;
uniform vec2 uRes; uniform vec2 uSun; uniform float uSunR; uniform float uGlow; uniform float uMoon;
uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uSunCol; uniform vec3 uCloud; uniform vec3 uShade; uniform vec3 uMount; uniform vec3 uMount2;
uniform float uCover; uniform float uStars; uniform float uSeed; uniform float uAmp; uniform float uSnow;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<6;i++){v+=a*noise(p);p=m*p;a*=.5;}return v;}
float ridge(float x,float s){float v=0.,a=.5,f=1.;for(int i=0;i<5;i++){float n=noise(vec2(x*f+s,s*.37));n=1.-abs(n*2.-1.);v+=a*n*n;f*=2.1;a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; float asp=uRes.x/uRes.y;
  float h=uv.y;
  vec3 sky=mix(uHor,uZen,pow(clamp(h,0.,1.),.62));
  vec2 d=(uv-uSun)*vec2(asp,1.); float r=length(d);
  sky+=uSunCol*(.55*exp(-r*7.)+.22*exp(-r*1.8))*uGlow;                 // glow around the sun (Mie scattering look)
  float hz=exp(-h*7.); sky=mix(sky,uHor*1.05,hz*.35);                  // brighter haze at the horizon
  if(uStars>0.){vec2 g=floor(gl_FragCoord.xy/1.6);float s=hash(g+uSeed);
    sky+=vec3(step(.9975,s)*uStars*(.4+.6*hash(g*1.31))*smoothstep(.25,.75,h));}
  float disc=1.-smoothstep(uSunR*.86,uSunR,r);
  vec3 discCol=uMoon>.5?vec3(.93,.92,.88)-vec3(.12)*smoothstep(.3,.7,noise(d*40.+uSeed)):uSunCol*1.15+.15;
  sky=mix(sky,discCol,disc);
  // clouds: warped layered noise, thicker in the middle of the sky, lit from the sun's side
  vec2 p=vec2(uv.x*asp*2.2,uv.y*5.5)+uSeed;
  vec2 q=vec2(fbm(p),fbm(p+vec2(5.2,1.3)));
  float n=fbm(p+1.4*q);
  float band=smoothstep(.32,.62,h)*(1.-smoothstep(.9,1.,h));
  float c=smoothstep(1.-uCover,1.-uCover+.28,n)*band;
  vec2 toSun=normalize((uSun-uv)*vec2(asp,1.)+1e-4)*.06;
  float n2=fbm(p+1.4*q+toSun*6.);
  float lit=clamp(.55+(n-n2)*4.5,0.,1.);
  vec3 cc=mix(uShade,uCloud,lit);
  cc+=uSunCol*.45*exp(-r*3.2)*(1.-c*.5);                                // silver lining near the sun
  sky=mix(sky,cc,c*.92);
  // distant mountain ranges, fading into the haze
  float r1=ridge(uv.x*1.3,uSeed*.13), r1b=ridge(uv.x*1.3+.02,uSeed*.13);
  float m1=.13+uAmp*1.5*pow(r1,1.6);
  float m2=.08+uAmp*.9*pow(ridge(uv.x*2.1+3.,uSeed*.29+7.),1.4);
  if(h<m1){
    float t=clamp((m1-h)/.25,0.,1.);
    vec3 mc=mix(uHor,uMount,.45+.3*t);                                   // haze thins lower down the slope
    mc*=1.+.08*(r1b-r1>0.?1.:-1.)*(uSun.x>.5?1.:-1.)*smoothstep(.0,.02,abs(r1b-r1));   // the sunny side of a slope is a touch lighter
    float snow=uSnow*smoothstep(.05,.0,m1-h)*smoothstep(.2,.34,m1);
    mc=mix(mc,mix(vec3(.96),uHor,.3),snow);
    sky=mix(sky,mc,smoothstep(0.,.003,m1-h));
  }
  if(h<m2){
    float t2=clamp((m2-h)/.2,0.,1.);
    vec3 mc2=mix(uHor,uMount2,.62+.25*t2);
    sky=mix(sky,mc2,smoothstep(0.,.003,m2-h));
  }
  sky=mix(sky,uHor,exp(-h*14.)*.25);                                    // ground mist
  gl_FragColor=vec4(sky,1.);
}`;

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const c3 = (a) => a.map((v) => Math.max(0, Math.min(1, v / 255)));
let GL = null;
function gl() {
  if (GL !== null) return GL;
  try {
    const c = document.createElement('canvas'), g = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
    if (!g) return (GL = false);
    const sh = (t, s) => { const o = g.createShader(t); g.shaderSource(o, s); g.compileShader(o); if (!g.getShaderParameter(o, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(o)); return o; };
    const pr = g.createProgram(); g.attachShader(pr, sh(g.VERTEX_SHADER, VS)); g.attachShader(pr, sh(g.FRAGMENT_SHADER, FS)); g.linkProgram(pr);
    if (!g.getProgramParameter(pr, g.LINK_STATUS)) throw new Error('link');
    g.useProgram(pr);
    const b = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, b); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const loc = g.getAttribLocation(pr, 'p'); g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
    GL = { c, g, pr };
  } catch (e) { GL = false; }
  return GL;
}

// L: the time-of-day light (sky colours, sun), opts: { seed, cover, amp, snow, mount, mount2 }; returns a canvas or null
export function shaderSky(L, W, H, scale, opts) {
  const G = gl(); if (!G) return null;
  const { c, g, pr } = G, w = Math.round(W * scale), h = Math.round(H * scale);
  c.width = w; c.height = h; g.viewport(0, 0, w, h);
  const u = (n) => g.getUniformLocation(pr, n);
  const sunCol = L.sun.moon ? [0.75, 0.8, 0.95] : hex(L.sun.c.length === 7 ? L.sun.c : '#ffd59a');
  g.uniform2f(u('uRes'), w, h);
  g.uniform2f(u('uSun'), L.sun.x / W, 1 - L.sun.y / H);
  g.uniform1f(u('uSunR'), L.sun.r / H * 0.9);
  g.uniform1f(u('uGlow'), L.sun.moon ? 0.35 : L.stars ? 0.6 : 1);
  g.uniform1f(u('uMoon'), L.sun.moon ? 1 : 0);
  g.uniform3fv(u('uZen'), hex(L.sky[0])); g.uniform3fv(u('uHor'), hex(L.sky[2]));
  g.uniform3fv(u('uSunCol'), sunCol);
  g.uniform3fv(u('uCloud'), c3(L.cloud)); g.uniform3fv(u('uShade'), c3(L.cloud.map((v, i) => v * 0.55 + [40, 45, 70][i] * 0.2)));
  g.uniform3fv(u('uMount'), c3(opts.mount)); g.uniform3fv(u('uMount2'), c3(opts.mount2));
  g.uniform1f(u('uCover'), opts.cover); g.uniform1f(u('uStars'), L.stars || 0); g.uniform1f(u('uSeed'), opts.seed % 97);
  g.uniform1f(u('uAmp'), opts.amp); g.uniform1f(u('uSnow'), opts.snow);
  g.drawArrays(g.TRIANGLES, 0, 3);
  const out = document.createElement('canvas'); out.width = w; out.height = h; out.getContext('2d').drawImage(c, 0, 0);
  return out;
}
