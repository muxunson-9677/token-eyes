import{c as xe,r as _,j as p,ap as ge,I as ve,J as be,a9 as we,L as Tt,B as Y,ab as ye}from"./main-DoX28NZi.js";import{u as ke}from"./useCurrency-CYsPDzJi.js";import{H as Me}from"./HeaderGithubStar-CJid5icL.js";import{useLeaderboardProfileData as _e,ProfileSkeleton as Ce,ProfileContent as Se}from"./LeaderboardProfileModal-GIYhb5Un.js";import{D as Te}from"./download-DreqyXQU.js";import"./format-Bq2V1279.js";import"./LeaderboardAvatar-1t56OnfI.js";import"./terminal-DNIZPDP5.js";import"./info-C6JWQvVt.js";import"./arrow-up-right-DJnZcjzu.js";import"./link-2-BHaLaau0.js";import"./useScrollLock-_tyKdU6F.js";import"./DialogTitle-Brc9tPOx.js";import"./store-DX36s3MH.js";const $e=[["path",{d:"M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978",key:"1n3hpd"}],["path",{d:"M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978",key:"rfe1zi"}],["path",{d:"M18 9h1.5a1 1 0 0 0 0-5H18",key:"7xy6bh"}],["path",{d:"M4 22h16",key:"57wxv0"}],["path",{d:"M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z",key:"1mhfuq"}],["path",{d:"M6 9H4.5a1 1 0 0 1 0-5H6",key:"tex48p"}]],Re=xe("trophy",$e);function Ie(t){let e=t.replace("#","");return e.length===3&&(e=e[0]+e[0]+e[1]+e[1]+e[2]+e[2]),[parseInt(e.slice(0,2),16)/255,parseInt(e.slice(2,4),16)/255,parseInt(e.slice(4,6),16)/255]}function Fe(t,e,a){t/=255,e/=255,a/=255;const r=Math.max(t,e,a),o=Math.min(t,e,a),n=r-o;let i=0;const h=r===0?0:n/r;return n!==0&&(r===t?i=((e-a)/n+6)%6:r===e?i=(a-t)/n+2:i=(t-e)/n+4,i/=6),[i,h,r]}function Oe(t,e,a){const r=Math.floor(t*6),o=t*6-r,n=a*(1-e),i=a*(1-o*e),h=a*(1-(1-o)*e);let l=0,c=0,u=0;switch(r%6){case 0:l=a,c=h,u=n;break;case 1:l=i,c=a,u=n;break;case 2:l=n,c=a,u=h;break;case 3:l=n,c=i,u=a;break;case 4:l=h,c=n,u=a;break;case 5:l=a,c=n,u=i;break}return[Math.round(l*255),Math.round(c*255),Math.round(u*255)]}const Pe=66,Ae=66,je=1500,Ee=1,$t=16,Le=16,Ne=8,We=96,Be=2,He={name:"chromatic",modes:{dark:{colors:["#000000","#aae8ff","#c5fe9e","#f7888d","#0d0d0d","#fffdc3","#007cff"],alphas:[1,1,1,1,1,1,1],direction:80,speed:1.2,intensity:2,scale:1.6,softness:.18,distortion:.3,complexity:.68,shape:1,blur:1,vignette:.26,vigOpacity:.6,shaderOpacity:1},light:{colors:["#ffffff","#ffffff","#ffffff","#ffb3b3","#adadad","#f5ff70","#007cff"],alphas:[1,1,1,1,1,1,1],direction:80,speed:1.2,intensity:2,scale:2.5,softness:.18,distortion:.3,complexity:.68,shape:1,blur:1,vignette:.24,vigOpacity:.16,shaderOpacity:1}}},ze={name:"silver",modes:{dark:{colors:["#000000","#dedede","#747270","#e5e5e5","#0d0d0d","#ffffff","#e6e6e6"],alphas:[1,1,1,1,1,1,1],direction:80,speed:1.2,intensity:2,scale:2.5,softness:.18,distortion:.3,complexity:.68,shape:1,blur:1,vignette:.26,vigOpacity:.6,shaderOpacity:.88},light:{colors:["#f6f6f6","#ffffff","#ffffff","#f7f7f7","#c9c9c9","#d0d0d0","#d1d1d1"],alphas:[1,1,1,1,1,1,1],direction:80,speed:1.2,intensity:2,scale:2.5,softness:.18,distortion:.3,complexity:.68,shape:1,blur:1,vignette:.2,vigOpacity:.26,shaderOpacity:1}}},Ge={name:"gold",modes:{dark:{colors:["#000000","#ffffff","#ffffff","#f7d488","#0d0d0d","#fffdc3","#ffffff"],alphas:[1,1,1,1,1,1,1],direction:80,speed:1,intensity:2,scale:2.5,softness:.18,distortion:.3,complexity:.68,shape:1,blur:1,vignette:.26,vigOpacity:.6,shaderOpacity:.92},light:{colors:["#fff8e1","#fffbe0","#ffffff","#fff6d6","#d2c7a7","#dcd2bc","#f9f7e5"],alphas:[1,1,1,1,1,1,1],direction:80,speed:1.2,intensity:2,scale:2.5,softness:.18,distortion:.3,complexity:.68,shape:1,blur:1,vignette:.22,vigOpacity:.24,shaderOpacity:1}}},Xt={chromatic:He,silver:ze,gold:Ge},De=`
  attribute vec2 a_position;
  void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`,Ue=`
  precision highp float;

  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec3 u_color1, u_color2, u_color3, u_color4, u_color5, u_color6, u_color7;
  uniform float u_alpha1, u_alpha2, u_alpha3, u_alpha4, u_alpha5, u_alpha6, u_alpha7;
  uniform float u_intensity, u_scale, u_direction;
  uniform float u_softness, u_distortion, u_complexity, u_shape;
  uniform float u_vignette, u_vigOpacity, u_blur, u_shaderOpacity;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289((x * 34.0 + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289v2(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x_) - 0.5;
    vec3 ox = floor(x_ + 0.5);
    vec3 a0 = x_ - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float fbm(vec2 p, float oct) {
    float val = 0.0, amp = 0.5;
    int n = int(oct);
    for (int i = 0; i < 7; i++) {
      if (i >= n) break;
      val += amp * snoise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return val;
  }

  float nfbm(vec2 p) { return fbm(p, 3.0 + u_complexity * 4.0); }

  /* 5-stop palette used by effect 1 (Plasma) — direct port of \`palette\` from
   * the canonical engine. Stops at t = 0, 0.25, 0.5, 0.75, 1.0. */
  vec3 palette(float t) {
    t = clamp(t, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    float k = 64.0;
    float w1 = u_alpha1 * exp(-k * t * t);
    float w2 = u_alpha2 * exp(-k * (t - 0.25) * (t - 0.25));
    float w3 = u_alpha3 * exp(-k * (t - 0.5)  * (t - 0.5));
    float w4 = u_alpha4 * exp(-k * (t - 0.75) * (t - 0.75));
    float w5 = u_alpha5 * exp(-k * (t - 1.0)  * (t - 1.0));
    float total = w1 + w2 + w3 + w4 + w5 + 0.0001;
    return (u_color1 * w1 + u_color2 * w2 + u_color3 * w3 +
            u_color4 * w4 + u_color5 * w5) / total;
  }

  /* Per-pixel alpha that re-introduces transparency when the user dials any
   * palette stop's alpha below 1. Same \`paletteAlpha\` from the canonical
   * engine. With every preset shipping all-1 alphas, this returns ~1 for every
   * pixel — but mirroring it keeps custom-preset behaviour identical. */
  float paletteAlpha(float t) {
    t = clamp(t, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    float k = 64.0;
    float w1 = u_alpha1 * exp(-k * t * t);
    float w2 = u_alpha2 * exp(-k * (t - 0.25) * (t - 0.25));
    float w3 = u_alpha3 * exp(-k * (t - 0.5)  * (t - 0.5));
    float w4 = u_alpha4 * exp(-k * (t - 0.75) * (t - 0.75));
    float w5 = u_alpha5 * exp(-k * (t - 1.0)  * (t - 1.0));
    float totalW = w1 + w2 + w3 + w4 + w5 + 0.0001;
    float rawW = exp(-k * t * t)
               + exp(-k * (t - 0.25) * (t - 0.25))
               + exp(-k * (t - 0.5)  * (t - 0.5))
               + exp(-k * (t - 0.75) * (t - 0.75))
               + exp(-k * (t - 1.0)  * (t - 1.0))
               + 0.0001;
    return totalW / rawW;
  }

  vec2 warp(vec2 p, float t) {
    float str = u_distortion * 2.0;
    return vec2(
      nfbm(p + vec2(t * 0.1, 0.0)),
      nfbm(p + vec2(0.0, t * 0.12) + 5.0)
    ) * str;
  }

  /* Plasma: four sine bands warped by an FBM field, mapped through the
   * 5-stop palette. Identical to effect 1 in the canonical engine. */
  vec3 computeEffect(vec2 uv, float aspect, float t, float dist, float cpx) {
    vec2 p = (uv - 0.5) * u_scale;
    p.x *= aspect;
    p += vec2(cos(u_direction), sin(u_direction)) * t * 0.15;

    float freq = 3.0 + cpx * 8.0;
    float val = 0.0;
    val += sin(p.x * freq + t);
    val += sin(p.y * freq + t * 1.3);
    val += sin((p.x + p.y) * freq * 0.7 + t * 0.7);
    val += sin(length(p) * freq * 0.8 - t * 1.5);
    vec2 w = warp(p, t);
    val += (w.x + w.y) * dist;
    val = val * 0.2 * u_intensity + 0.5;

    return palette(clamp(val, 0.0, 1.0));
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    float aspect = u_resolution.x / u_resolution.y;
    float t = u_time;          // JS already multiplied u_time by preset.speed.
    float dist = u_distortion;
    float cpx = u_complexity;

    /* 5-tap cross blur (center + cardinal offsets). The chromatic/silver/gold
     * presets all ship with blur=1 so this path is always active. 5 taps
     * instead of the canonical engine's 9 saves ~44% fragment work; the
     * perceptual difference is nil because the output is already soft from
     * the plasma's low spatial frequency and CSS blur on reflections. */
    vec3 col;
    if (u_blur < 0.01) {
      col = computeEffect(uv, aspect, t, dist, cpx);
    } else {
      float r = u_blur * 0.02;
      col  = computeEffect(uv,                  aspect, t, dist, cpx) * 0.4;
      col += computeEffect(uv + vec2( r, 0.0),  aspect, t, dist, cpx) * 0.15;
      col += computeEffect(uv + vec2(-r, 0.0),  aspect, t, dist, cpx) * 0.15;
      col += computeEffect(uv + vec2(0.0,  r),  aspect, t, dist, cpx) * 0.15;
      col += computeEffect(uv + vec2(0.0, -r),  aspect, t, dist, cpx) * 0.15;
    }

    /* Gamma punch — adds the contrast pop that defines the chromatic
     * highlights. From the canonical engine: \`col = pow(col, vec3(1.3))\`. */
    col = pow(col, vec3(1.3));

    /* Vignette — soft edge darkening so corners read as recessed. The 40-px
     * scale at the bottom of the formula is hard-coded in the canonical
     * engine; we keep it for visual parity. */
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float vigPx = 40.0 / min(u_resolution.x, u_resolution.y);
    float vigRange = vigPx * (1.0 + u_vignette * 3.0);
    float vig = edgeDist * edgeDist / (vigRange * vigRange);
    vig = smoothstep(0.0, 1.0, vig);
    col *= mix(1.0, vig, u_vignette * u_vigOpacity);

    /* Per-pixel alpha. With all-1 alphas the formula collapses to ~1 but the
     * computation matches the canonical engine so custom presets behave the
     * same. */
    float colorAlpha = (u_alpha1 + u_alpha2 + u_alpha3 + u_alpha4 + u_alpha5) / 5.0;
    if (colorAlpha < 0.999) {
      vec3 c1d = col - u_color1, c2d = col - u_color2, c3d = col - u_color3,
           c4d = col - u_color4, c5d = col - u_color5;
      float prox1 = exp(-8.0 * dot(c1d, c1d));
      float prox2 = exp(-8.0 * dot(c2d, c2d));
      float prox3 = exp(-8.0 * dot(c3d, c3d));
      float prox4 = exp(-8.0 * dot(c4d, c4d));
      float prox5 = exp(-8.0 * dot(c5d, c5d));
      float pTotal = prox1 + prox2 + prox3 + prox4 + prox5 + 0.0001;
      colorAlpha = (prox1 * u_alpha1 + prox2 * u_alpha2 + prox3 * u_alpha3 +
                    prox4 * u_alpha4 + prox5 * u_alpha5) / pTotal;
    }
    float alpha = colorAlpha;

    /* Touch the unused-at-effect-1 uniforms so GL drivers that complain about
     * declared-but-unread uniforms (some Mali / Adreno builds do) keep them
     * live. The contribution is provably zero. */
    alpha += 0.0 * (u_softness + u_shape +
                    u_alpha6 + u_alpha7 +
                    u_color6.x + u_color7.x);

    gl_FragColor = vec4(col, alpha * u_shaderOpacity);
  }
`;function Rt(t,e,a){const r=t.createShader(e);if(!r)throw new Error("metal-fx: gl.createShader returned null");if(t.shaderSource(r,a),t.compileShader(r),!t.getShaderParameter(r,t.COMPILE_STATUS)){const o=t.getShaderInfoLog(r);throw t.deleteShader(r),new Error(`metal-fx: shader compile failed: ${o??"(no info log)"}`)}return r}function qe(t,e,a){const r=t.createProgram();if(!r)throw new Error("metal-fx: gl.createProgram returned null");if(t.attachShader(r,e),t.attachShader(r,a),t.linkProgram(r),!t.getProgramParameter(r,t.LINK_STATUS)){const o=t.getProgramInfoLog(r);throw t.deleteProgram(r),new Error(`metal-fx: program link failed: ${o??"(no info log)"}`)}return r}const Yt=140,Jt=40,Kt=1.6,Zt=1.3;let s=null,bt=null;function Ve(t){bt=t}const Qe=["u_resolution","u_time","u_color1","u_color2","u_color3","u_color4","u_color5","u_color6","u_color7","u_alpha1","u_alpha2","u_alpha3","u_alpha4","u_alpha5","u_alpha6","u_alpha7","u_intensity","u_scale","u_direction","u_softness","u_distortion","u_complexity","u_shape","u_vignette","u_vigOpacity","u_blur","u_shaderOpacity"];function It(t){t.enable(t.BLEND),t.blendFunc(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA);const e=Rt(t,t.VERTEX_SHADER,De),a=Rt(t,t.FRAGMENT_SHADER,Ue),r=qe(t,e,a);t.useProgram(r);const o=t.createBuffer();if(!o)throw new Error("metal-fx: gl.createBuffer returned null");t.bindBuffer(t.ARRAY_BUFFER,o),t.bufferData(t.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),t.STATIC_DRAW);const n=t.getAttribLocation(r,"a_position");t.enableVertexAttribArray(n),t.vertexAttribPointer(n,2,t.FLOAT,!1,0,0);const i={};for(const h of Qe)i[h]=t.getUniformLocation(r,h);return{program:r,buffer:o,uniforms:i}}function te(){if(s)return s;const t=Math.min(Be,typeof window<"u"&&window.devicePixelRatio||1),e=Math.round(We*t),a=typeof OffscreenCanvas<"u";let r,o;if(a)r=new OffscreenCanvas(e,e),o=r.getContext("webgl",{alpha:!0,premultipliedAlpha:!1,antialias:!1});else{const u=document.createElement("canvas");u.width=e,u.height=e,o=u.getContext("webgl",{alpha:!0,premultipliedAlpha:!1,antialias:!1,preserveDrawingBuffer:!0})??u.getContext("experimental-webgl"),r=u}if(!o)throw new Error("metal-fx: WebGL not supported");const{program:n,buffer:i,uniforms:h}=It(o),l=u=>{u.preventDefault(),s&&(s.contextLost=!0)},c=()=>{if(!s)return;const u=It(s.gl);s.program=u.program,s.buffer=u.buffer,s.uniforms=u.uniforms,s.presetDirty=!0,s.contextLost=!1,bt?.()};return r.addEventListener("webglcontextlost",l,!1),r.addEventListener("webglcontextrestored",c,!1),s={glCanvas:r,gl:o,program:n,buffer:i,uniforms:h,preset:Xt.chromatic.modes.dark,presetDirty:!0,contextLost:!1,useOffscreen:a,frameBitmap:null,startMs:performance.now(),pausedMs:0,pausedAtMs:null,rafId:0,dpr:t,instances:new Set,frameCount:0,glowQueue:[],glowIdx:0,glowSkip:0,glowPixels:new Uint8Array(e*e*4),glowPixelsW:e,glowPixelsH:e},s}function Xe(){var t;if(!s)return;const{gl:e,program:a,buffer:r,frameBitmap:o}=s;try{o?.close(),e.deleteBuffer(r),e.deleteProgram(a),(t=e.getExtension("WEBGL_lose_context"))==null||t.loseContext()}catch{}s=null}let Ft=0;function dt(){if(!s)return;const t=performance.now();if(t-Ft<je)return;Ft=t;const{gl:e,glCanvas:a}=s,r=a.width,o=a.height;(s.glowPixelsW!==r||s.glowPixelsH!==o)&&(s.glowPixelsW=r,s.glowPixelsH=o,s.glowPixels=new Uint8Array(r*o*4)),e.readPixels(0,0,r,o,e.RGBA,e.UNSIGNED_BYTE,s.glowPixels)}const J={bx:0,by:0};function kt(t,e,a){if(!s)return J.bx=0,J.by=0,J;const{glCanvas:r}=s,o=r.width,n=r.height,i=t.dpr,h=t.cssWidth*i,l=t.cssHeight*i,c=Yt*i,u=Jt*i;let f=h*(o/c)/t.shaderScale,d=l*(n/u)/t.shaderScale;f>o&&(f=o),d>n&&(d=n);const g=(o-f)/2,x=(n-d)/2,m=g+e/t.cssWidth*f,I=x+a/t.cssHeight*d;return J.bx=Math.round(m),J.by=Math.round(n-1-I),J}const G={r:0,g:0,b:0,lum:0,count:0};function ee(t,e,a,r,o,n){const i=Math.max(1,n|0),h=Math.max(0,r-i),l=Math.min(e,r+i+1),c=Math.max(0,o-i),u=Math.min(a,o+i+1);G.r=0,G.g=0,G.b=0,G.lum=0,G.count=0;for(let f=c;f<u;f++){const d=f*e;for(let g=h;g<l;g++){const x=(d+g)*4;G.r+=t[x],G.g+=t[x+1],G.b+=t[x+2],G.lum+=(.2126*t[x]+.7152*t[x+1]+.0722*t[x+2])/255,G.count++}}return G}const R={r:255,g:255,b:255};function Ot(t,e,a,r){if(!s)return 0;dt();const o=kt(t,e,a),n=ee(s.glowPixels,s.glowPixelsW,s.glowPixelsH,o.bx,o.by,r);return n.count>0?n.lum/n.count:0}function Ye(t,e,a,r){if(!s)return R.r=255,R.g=255,R.b=255,R;dt();const o=kt(t,e,a),n=ee(s.glowPixels,s.glowPixelsW,s.glowPixelsH,o.bx,o.by,r);return n.count===0?(R.r=255,R.g=255,R.b=255,R):(R.r=n.r/n.count,R.g=n.g/n.count,R.b=n.b/n.count,R)}function Je(t,e,a,r){if(!s)return R.r=255,R.g=255,R.b=255,R;dt();const o=kt(t,e,a),{glowPixels:n,glowPixelsW:i,glowPixelsH:h}=s,l=Math.max(1,r|0),c=Math.max(0,o.bx-l),u=Math.min(i,o.bx+l+1),f=Math.max(0,o.by-l),d=Math.min(h,o.by+l+1);let g=-1;R.r=255,R.g=255,R.b=255;for(let x=f;x<d;x++){const m=x*i;for(let I=c;I<u;I++){const b=(m+I)*4,P=n[b],j=n[b+1],L=n[b+2],C=Math.max(P,j,L),E=Math.min(P,j,L),H=(C>0?(C-E)/C:0)*(.35+.65*(C/255));H>g&&(g=H,R.r=P,R.g=j,R.b=L)}}return R}Ve(()=>{s&&s.instances.size>0&&s.pausedAtMs===null&&nt()});typeof document<"u"&&document.addEventListener("visibilitychange",()=>{!s||s.pausedAtMs!==null||s.contextLost||(document.hidden?oe():s.instances.size>0&&nt())});function Ke(t){const e=te(),a=t.hostCanvas.getContext("2d",{alpha:!0});if(!a)throw new Error("metal-fx: canvas 2D context unavailable");const r=t.scale??1,o={canvas:t.hostCanvas,ctx:a,cssWidth:t.cssWidth,cssHeight:t.cssHeight,cornerRadius:t.cornerRadius,kind:t.kind,ringCssPx:t.ringCssPx??(t.kind==="circle"?2:1)*r,shaderScale:t.shaderScale??(t.kind==="circle"?Zt:Kt)*r,opacityMul:t.opacityMul??1,visible:!0,paused:t.paused??!1,everCopied:!1,dpr:typeof window<"u"&&window.devicePixelRatio||1,scale:r,onAfterFrame:t.onAfterFrame,onFirstCopy:t.onFirstCopy};return ae(o),e.instances.add(o),e.rafId===0&&e.pausedAtMs===null&&nt(),o}function Ze(t){if(!s)return;s.instances.delete(t);const e=s.glowQueue.indexOf(t);e!==-1&&s.glowQueue.splice(e,1),s.instances.size===0&&(oe(),Xe())}function ta(t){s&&(s.glowQueue.includes(t)||s.glowQueue.push(t))}function ea(t){if(!s)return;const e=s.glowQueue.indexOf(t);e!==-1&&s.glowQueue.splice(e,1)}function rt(t,e){let a=!1;e.cssWidth!==void 0&&e.cssWidth!==t.cssWidth&&(t.cssWidth=e.cssWidth,a=!0),e.cssHeight!==void 0&&e.cssHeight!==t.cssHeight&&(t.cssHeight=e.cssHeight,a=!0),e.cornerRadius!==void 0&&(t.cornerRadius=e.cornerRadius),e.scale!==void 0&&(t.scale=e.scale),e.kind!==void 0&&e.kind!==t.kind&&(t.kind=e.kind,e.shaderScale===void 0&&(t.shaderScale=(e.kind==="circle"?Zt:Kt)*t.scale),e.ringCssPx===void 0&&(t.ringCssPx=(e.kind==="circle"?2:1)*t.scale)),e.shaderScale!==void 0&&(t.shaderScale=e.shaderScale),e.ringCssPx!==void 0&&(t.ringCssPx=e.ringCssPx),e.opacityMul!==void 0&&(t.opacityMul=e.opacityMul),e.paused!==void 0&&e.paused!==t.paused&&(t.paused=e.paused,!e.paused&&s&&s.rafId===0&&s.pausedAtMs===null&&!s.contextLost&&nt()),a&&ae(t)}function aa(t,e){t.visible=e,e&&s&&s.rafId===0&&s.pausedAtMs===null&&!s.contextLost&&nt()}function ra(t,e){const a=te();a.preset=Xt[t].modes[e],a.presetDirty=!0}let wt=null;function oa(t){wt=t}function ae(t){t.dpr=typeof window<"u"&&window.devicePixelRatio||1;const e=Math.max(1,Math.round(t.cssWidth*t.dpr)),a=Math.max(1,Math.round(t.cssHeight*t.dpr));t.canvas.width!==e&&(t.canvas.width=e),t.canvas.height!==a&&(t.canvas.height=a)}function na(t){const{ctx:e,dpr:a,canvas:r}=t,o=t.ringCssPx*a,n=r.width,i=r.height,h=Math.max(0,(t.cornerRadius-t.ringCssPx)*a);e.save(),e.globalCompositeOperation="destination-out",e.fillStyle="#000",e.beginPath(),e.roundRect(o,o,n-2*o,i-2*o,h),e.fill(),e.restore()}function ia(t){var e;if(!s)return;const a=s.frameBitmap??s.glCanvas,r=t.dpr,o=t.canvas.width,n=t.canvas.height;if(o<1||n<1)return;const i=s.glCanvas.width,h=s.glCanvas.height,l=Yt*r,c=Jt*r;let u=o*(i/l)/t.shaderScale,f=n*(h/c)/t.shaderScale;u>i&&(u=i),f>h&&(f=h);const d=Math.max(0,(i-u)/2),g=Math.max(0,(h-f)/2);if(t.ctx.clearRect(0,0,o,n),t.opacityMul<1&&(t.ctx.globalAlpha=t.opacityMul),t.ctx.drawImage(a,d,g,u,f,0,0,o,n),t.opacityMul<1&&(t.ctx.globalAlpha=1),na(t),t.onFirstCopy){const x=t.onFirstCopy;t.onFirstCopy=void 0,x()}(e=t.onAfterFrame)==null||e.call(t)}function sa(){if(!s)return;const{gl:t,uniforms:e,preset:a,glCanvas:r}=s;e.u_resolution&&t.uniform2f(e.u_resolution,r.width,r.height);for(let o=0;o<7;o++){const n=e[`u_color${o+1}`];if(n){const[h,l,c]=Ie(a.colors[o]);t.uniform3f(n,h,l,c)}const i=e[`u_alpha${o+1}`];i&&t.uniform1f(i,a.alphas[o])}e.u_intensity&&t.uniform1f(e.u_intensity,a.intensity),e.u_scale&&t.uniform1f(e.u_scale,a.scale),e.u_direction&&t.uniform1f(e.u_direction,a.direction*Math.PI/180),e.u_softness&&t.uniform1f(e.u_softness,a.softness),e.u_distortion&&t.uniform1f(e.u_distortion,a.distortion),e.u_complexity&&t.uniform1f(e.u_complexity,a.complexity),e.u_shape&&t.uniform1f(e.u_shape,a.shape),e.u_vignette&&t.uniform1f(e.u_vignette,a.vignette),e.u_vigOpacity&&t.uniform1f(e.u_vigOpacity,a.vigOpacity),e.u_blur&&t.uniform1f(e.u_blur,a.blur),e.u_shaderOpacity&&t.uniform1f(e.u_shaderOpacity,a.shaderOpacity),s.presetDirty=!1}function la(t){if(!s)return;const{gl:e,uniforms:a,preset:r,glCanvas:o}=s,n=(t-s.startMs-s.pausedMs)/1e3*r.speed;e.viewport(0,0,o.width,o.height),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),s.presetDirty&&sa(),a.u_time&&e.uniform1f(a.u_time,n),e.drawArrays(e.TRIANGLES,0,6),s.frameCount++}let Pt=0;function re(t){var e;if(!s)return;if(s.contextLost){s.rafId=0;return}let a=!1;for(const r of s.instances)if(r.visible&&(!r.paused||!r.everCopied)){a=!0;break}if(!a){s.rafId=0;return}if(s.rafId=requestAnimationFrame(re),!(t-Pt<Pe)){Pt=t,la(t),s.useOffscreen&&(s.glowQueue.length>0&&dt(),(e=s.frameBitmap)==null||e.close(),s.frameBitmap=s.glCanvas.transferToImageBitmap());for(const r of s.instances)r.visible&&(r.paused&&r.everCopied||(ia(r),r.everCopied=!0));if(wt&&s.glowQueue.length>0&&++s.glowSkip%Ee===0){const r=s.glowQueue;s.glowIdx>=r.length&&(s.glowIdx=0);const o=r[s.glowIdx];o.visible&&!o.paused&&wt(o,t),s.glowIdx++}}}function nt(){!s||s.rafId!==0||(s.rafId=requestAnimationFrame(re))}function oe(){s&&(s.rafId!==0&&cancelAnimationFrame(s.rafId),s.rafId=0)}const lt={linear:t=>t,smoothstep:t=>t*t*(3-2*t)};function K(t,e,a,r=lt.linear){return{from:t,to:e,dur:a,ease:r,startMs:-1,val:t,done:!1}}function Z(t,e){t.startMs=e,t.val=t.from,t.done=!1}function At(t,e){if(t.done||t.startMs<0)return t.val;const a=Math.min(1,(e-t.startMs)/t.dur);return t.val=t.from+(t.to-t.from)*t.ease(a),a>=1&&(t.done=!0),t.val}const ca=1.5,it=1/3,da=4*it,ha=2*it,ua=2*it,fa=1.35*it,pa=13*it;function Mt(t,e,a){const r=Math.max(0,Math.min(a,Math.min(t,e)/2));return 2*Math.max(0,t-2*r)+2*Math.max(0,e-2*r)+2*Math.PI*r}function _t(t,e,a,r){return r==="circle"?2*Math.PI*Math.max(0,Math.min(a,Math.min(t,e)/2)):Mt(t,e,a)}function ot(t,e,a,r,o,n,i,h){const l=h||{x:0,y:0},c=Math.max(0,Math.min(r,Math.min(e,a)/2));if(i==="circle"){const b=2*Math.PI*c;if(b<=1e-4)return l.x=e*.5,l.y=a*.5,l;t=(t%b+b)%b;const P=-Math.PI/2+t/b*Math.PI*2,j=Math.max(0,c-o+n);return l.x=e*.5+j*Math.cos(P),l.y=a*.5+j*Math.sin(P),l}const u=Math.max(0,e-2*c),f=Math.max(0,a-2*c),d=Math.PI*c/2,g=2*(u+f)+4*d;t=(t%g+g)%g;const x=Math.max(0,c-o+n);let m=t;if(m<u)return l.x=c+m,l.y=o-n,l;if(m-=u,m<d){const b=-Math.PI/2+(d>0?m/d:0)*(Math.PI/2);return l.x=e-c+x*Math.cos(b),l.y=c+x*Math.sin(b),l}if(m-=d,m<f)return l.x=e-o+n,l.y=c+m,l;if(m-=f,m<d){const b=(d>0?m/d:0)*(Math.PI/2);return l.x=e-c+x*Math.cos(b),l.y=a-c+x*Math.sin(b),l}if(m-=d,m<u)return l.x=e-c-m,l.y=a-o+n,l;if(m-=u,m<d){const b=Math.PI/2+(d>0?m/d:0)*(Math.PI/2);return l.x=c+x*Math.cos(b),l.y=a-c+x*Math.sin(b),l}if(m-=d,m<f)return l.x=o-n,l.y=a-c-m,l;m-=f;const I=Math.PI+(d>0?m/d:0)*(Math.PI/2);return l.x=c+x*Math.cos(I),l.y=c+x*Math.sin(I),l}function jt(t,e){const a=t*2/e;let r="";for(let o=0;o<=e;o++){const n=-t+o*a;r+=(o===0?"M ":"L ")+n.toFixed(3)+" 0 "}return r}const ft={x:0,y:0},pt={x:0,y:0};function ma(t,e,a,r,o,n){return ot(t-.1,e,a,r,o,0,n,ft),ot(t+.1,e,a,r,o,0,n,pt),Math.atan2(pt.y-ft.y,pt.x-ft.x)}function Et(t,e,a){const r=Math.max(0,Math.min(1,(a-t)/(e-t)));return r*r*(3-2*r)}function xa(t){const e=_t(t.width,t.height,t.cornerRadius,t.kind),a=ca*(t.scale??1),r=[];for(let o=0;o<$t;o++){const n=o/$t*e,i=ot(n,t.width,t.height,t.cornerRadius,a,0,t.kind);r.push({x:i.x,y:i.y,arc:n})}return r}function ga(t,e){const{width:a,height:r,cornerRadius:o}=t,n=t.scale??1,i=t.kind==="circle"?2:1,h=Math.max(0,o-i),l=(-200*n).toFixed(0),c=l,u=(540*n).toFixed(0),f=(440*n).toFixed(0),d=`x="${l}" y="${c}" width="${u}" height="${f}"`,g=`${d} filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"`,x=I=>(I*n).toFixed(3),m=I=>(I*n).toFixed(3);return["<defs>",`<filter id="${e}_bXl" ${g}><feGaussianBlur stdDeviation="${m(8.4)}"/></filter>`,`<filter id="${e}_bLg" ${g}><feGaussianBlur stdDeviation="${m(4.8)}"/></filter>`,`<filter id="${e}_bMd" ${g}><feGaussianBlur stdDeviation="${m(2.1)}"/></filter>`,`<filter id="${e}_bSm" ${g}><feGaussianBlur stdDeviation="${m(.9)}"/></filter>`,`<filter id="${e}_ebO" ${g}><feGaussianBlur stdDeviation="${m(ua)}"/></filter>`,`<filter id="${e}_ebC" ${g}><feGaussianBlur stdDeviation="${m(fa)}"/></filter>`,`<radialGradient id="${e}_fg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="white"/><stop offset="0.30" stop-color="white"/><stop offset="0.65" stop-color="#404040"/><stop offset="1" stop-color="black"/></radialGradient>`,`<mask id="${e}_fm" maskUnits="userSpaceOnUse" ${d}><rect ${d} fill="black"/><circle id="${e}_fc" cx="0" cy="0" r="${(pa*n).toFixed(3)}" fill="url(#${e}_fg)"/></mask>`,`<mask id="${e}_rm" maskUnits="userSpaceOnUse" ${d}><rect ${d} fill="#808080"/><rect x="0" y="0" width="${a}" height="${r}" rx="${o}" ry="${o}" fill="white"/><rect x="${i}" y="${i}" width="${a-i*2}" height="${r-i*2}" rx="${h}" ry="${h}" fill="black"/></mask>`,"</defs>",`<g id="${e}_h" mask="url(#${e}_rm)" opacity="0">`,`<rect ${d} fill="none" pointer-events="none"/>`,`<g id="${e}_hI" stroke="white">`,`<path id="${e}_pXl" stroke-width="${x(26.4)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.385" filter="url(#${e}_bXl)"/>`,`<path id="${e}_pLg" stroke-width="${x(15.6)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.595" filter="url(#${e}_bLg)"/>`,`<path id="${e}_pMd" stroke-width="${x(7.2)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.70" filter="url(#${e}_bMd)"/>`,`<path id="${e}_pSm" stroke-width="${x(3)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.70" filter="url(#${e}_bSm)"/>`,"</g></g>",`<g id="${e}_e" mask="url(#${e}_rm)" opacity="0">`,`<rect ${d} fill="none" pointer-events="none"/>`,`<g mask="url(#${e}_fm)">`,`<g id="${e}_eI" stroke="white">`,`<path id="${e}_eO" stroke-width="${x(da)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="0.85" filter="url(#${e}_ebO)"/>`,`<path id="${e}_eC" stroke-width="${x(ha)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="1.0" filter="url(#${e}_ebC)"/>`,"</g></g></g>"].join("")}const va=.00875,Lt=.08,Nt=.32,ba=.05,wa=3e3,Wt=.85,st=.34,mt=1500,ya=15,ka=.0075,Ma=120,_a=1.5,Ca=7.8,Sa=9.13952,Ta=1,$a=1/3,Ra=.8,Ia=3.51,Bt=2e3,xt=400,Fa=2.625,Oa=1.008,Pa=.31,ne=140,ie=40,se=20;let Aa=0;const q={x:0,y:0};function Ht(t,e){const a=`mfxg_${++Aa}`,r=document.createElementNS("http://www.w3.org/2000/svg","svg");r.setAttribute("class","metal-fx-glow-svg"),r.setAttribute("preserveAspectRatio","none"),r.setAttribute("viewBox",`0 0 ${e.width} ${e.height}`),r.innerHTML=ga(e,a),t.appendChild(r);const o=b=>r.querySelector(`#${a}_${b}`),n=o("h"),i=o("hI"),h=o("e"),l=o("eI"),c=o("fc"),u=_t(e.width,e.height,e.cornerRadius,e.kind)/Mt(ne,ie,se),f=Math.max(1,Ca*u),d=Math.max(.6,Sa*$a*u),g=jt(f,Le),x=jt(d,Ne),m=[o("pXl"),o("pLg"),o("pMd"),o("pSm")],I=[o("eO"),o("eC")];for(const b of m)b.setAttribute("d",g);for(const b of I)b.setAttribute("d",x);return i.style.transformOrigin="0 0",l.style.transformOrigin="0 0",i.style.willChange="transform",l.style.willChange="transform",i.style.transition="transform 100ms linear",l.style.transition="transform 100ms linear",n.style.willChange="opacity",h.style.willChange="opacity",n.style.transition="opacity 100ms linear",h.style.transition="opacity 100ms linear",c.style.willChange="transform",{svg:r,haloGroup:n,haloInner:i,extraGroup:h,extraInner:l,fadeCircle:c,width:e.width,height:e.height,cornerRadius:e.cornerRadius,kind:e.kind,scale:e.scale??1,perim:xa(e),currentIdx:0,appearedAt:0,glowOpacity:0,relocTween:null,relocNextIdx:-1,wanderS:0,wanderTargetS:0,wanderFrames:0,tintFrom:{r:255,g:255,b:255},tintTarget:{r:255,g:255,b:255},tintTween:null,tintHoldUntil:0,lastHaloStroke:"",lastExtraStroke:""}}function ja(t,e,a,r,o="dark"){var n;const{width:i,height:h,cornerRadius:l,perim:c}=t;if(c.length===0)return;const u=2;let f=-1,d=t.currentIdx,g=0;for(let v=0;v<c.length;v++){const M=c[v],S=Ot(e,M.x,M.y,u);S>f&&(f=S,d=v),v===t.currentIdx&&(g=S)}const x=t.appearedAt>0&&a-t.appearedAt<wa,m=st+(Wt-st)*Et(Lt,Nt,g),I=!x&&f-g>ba;if(!t.relocTween||t.relocTween.done)if(t.appearedAt===0)t.currentIdx=d,t.appearedAt=a,t.wanderS=0,t.wanderTargetS=0,t.wanderFrames=0,t.relocTween=K(0,m,mt,lt.smoothstep),Z(t.relocTween,a);else if((n=t.relocTween)!=null&&n.done&&t.relocTween.to===0){t.currentIdx=t.relocNextIdx,t.appearedAt=a,t.wanderS=0,t.wanderTargetS=0,t.wanderFrames=0;const v=c[t.currentIdx],M=Ot(e,v.x,v.y,u),S=st+(Wt-st)*Et(Lt,Nt,M);t.relocTween=K(0,S,mt,lt.smoothstep),Z(t.relocTween,a)}else I?(t.relocNextIdx=d,t.relocTween=K(t.glowOpacity,0,mt,lt.smoothstep),Z(t.relocTween,a)):t.glowOpacity+=(m-t.glowOpacity)*va;t.relocTween&&(t.glowOpacity=At(t.relocTween,a)),t.glowOpacity=Math.max(0,Math.min(1,t.glowOpacity));const b=_t(i,h,l,t.kind)/Mt(ne,ie,se),P=ya*b;t.wanderFrames++>=Ma&&(t.wanderTargetS=(Math.random()*2-1)*P,t.wanderFrames=0),t.wanderS+=(t.wanderTargetS-t.wanderS)*ka;const j=c[t.currentIdx].arc+t.wanderS,L=_a*t.scale;ot(j,i,h,l,L,0,t.kind,q);const C=q.x,E=q.y,H=ma(j,i,h,l,L,t.kind),X=`translate(${C.toFixed(3)}px,${E.toFixed(3)}px) rotate(${H.toFixed(4)}rad)`;t.haloInner.style.transform=X;const N=Ta*b*t.scale;ot(j,i,h,l,L,N,t.kind,q),t.extraInner.style.transform=`translate(${q.x.toFixed(3)}px,${q.y.toFixed(3)}px) rotate(${H.toFixed(4)}rad)`,t.fadeCircle.style.transform=`translate(${q.x.toFixed(3)}px,${q.y.toFixed(3)}px)`;const $=o==="light",k=$?Je(e,C,E,u):Ye(e,C,E,u);t.tintTween?t.tintTween.done&&($?(t.tintFrom={r:t.tintFrom.r+(t.tintTarget.r-t.tintFrom.r)*t.tintTween.val,g:t.tintFrom.g+(t.tintTarget.g-t.tintFrom.g)*t.tintTween.val,b:t.tintFrom.b+(t.tintTarget.b-t.tintFrom.b)*t.tintTween.val},t.tintTarget={...k},t.tintTween=K(0,1,xt),Z(t.tintTween,a)):a>=t.tintHoldUntil&&(t.tintFrom={...t.tintTarget},t.tintTarget={...k},t.tintTween=K(0,1,xt),Z(t.tintTween,a),t.tintHoldUntil=a+Bt)):(t.tintFrom={...k},t.tintTarget={...k},t.tintTween=K(0,1,xt),Z(t.tintTween,a),t.tintHoldUntil=$?0:a+Bt),At(t.tintTween,a);const F=t.tintTween.val;let W,B,z;if($)W=Math.round(t.tintFrom.r+(t.tintTarget.r-t.tintFrom.r)*F),B=Math.round(t.tintFrom.g+(t.tintTarget.g-t.tintFrom.g)*F),z=Math.round(t.tintFrom.b+(t.tintTarget.b-t.tintFrom.b)*F);else{const v=t.tintFrom.r+(t.tintTarget.r-t.tintFrom.r)*F,M=t.tintFrom.g+(t.tintTarget.g-t.tintFrom.g)*F,S=t.tintFrom.b+(t.tintTarget.b-t.tintFrom.b)*F,O=Math.max(v,M,S)||1;W=Math.round(255*(v/O)),B=Math.round(255*(M/O)),z=Math.round(255*(S/O))}const y=`rgb(${W},${B},${z})`;if(y!==t.lastHaloStroke&&(t.lastHaloStroke=y,t.haloInner.style.stroke=y),$){const v=Fe(W,B,z),[M,S,O]=Oe(v[0],Math.min(1,v[1]*Fa),Math.max(Pa,v[2]*Oa)),D=`rgb(${M},${S},${O})`;D!==t.lastExtraStroke&&(t.lastExtraStroke=D,t.extraInner.style.stroke=D)}else t.lastExtraStroke!=="#ffffff"&&(t.lastExtraStroke="#ffffff",t.extraInner.style.stroke="#ffffff");const w=Math.max(0,Math.min(1,r));t.haloGroup.style.opacity=(t.glowOpacity*Ra*w).toFixed(3),t.extraGroup.style.opacity=Math.min(1,t.glowOpacity*Ia*w).toFixed(3)}const yt=12,zt=32,Gt=1,Dt=.55,Ea=1,La=1,Na=.85,Wa=0,Ba=1.3,Ut=3.6,Ha=.7,za=1,Ga=.52,Da=1,Ua=.044,qa=235,Va=2.535,Qa=.7,Xa=.5,Ya=new Set(["INPUT","TEXTAREA","SELECT","OPTION"]);function Ja(t,e){const a=Math.max(t.left-e.right,e.left-t.right,0),r=Math.max(t.top-e.bottom,e.top-t.bottom,0);return Math.sqrt(a*a+r*r)}function Ka(t,e,a,r){return!(Math.min(t.bottom,e.bottom)-Math.max(t.top,e.top)<a||Math.max(t.left-e.right,e.left-t.right,0)>r)}function Za(t,e,a,r){return Math.min(t.right,e.right)-Math.max(t.left,e.left)<a?!1:Math.max(t.top-e.bottom,e.top-t.bottom,0)<=r}function Q(t,e,a,r,o,n){const i=Math.max(0,Math.min(n,r*.5,o*.5)),h=t.roundRect;if(typeof h=="function"){h.call(t,e,a,r,o,i);return}t.moveTo(e+i,a),t.lineTo(e+r-i,a),t.quadraticCurveTo(e+r,a,e+r,a+i),t.lineTo(e+r,a+o-i),t.quadraticCurveTo(e+r,a+o,e+r-i,a+o),t.lineTo(e+i,a+o),t.quadraticCurveTo(e,a+o,e,a+o-i),t.lineTo(e,a+i),t.quadraticCurveTo(e,a,e+i,a)}function le(t,e,a,r,o){if(!o.flipX&&!o.flipY){t.drawImage(e,0,0,a,r,o.x,o.y,o.w,o.h);return}t.save(),o.flipX&&(t.translate(o.x+o.w,0),t.scale(-1,1)),o.flipY&&(t.translate(0,o.y+o.h),t.scale(1,-1)),t.drawImage(e,0,0,a,r,o.flipX?0:o.x,o.flipY?0:o.y,o.w,o.h),t.restore()}const tr=4;function er(t,e,a,r,o,n,i){if(r<=2*i||o<=2*i){t.beginPath(),Q(t,e,a,r,o,n),t.clip();return}t.beginPath(),Q(t,e,a,r,o,n),Q(t,e+i,a+i,r-2*i,o-2*i,Math.max(0,n-i)),t.clip("evenodd")}function ar(t,e,a,r,o,n,i,h,l,c,u){const f=Math.max(1,Math.round((yt+tr*3)*u));let d=Math.max(0,i),g=!0;for(let x=0;x<3&&d>1e-4;x++){const m=Math.min(1,d);t.save(),er(t,c.x,c.y,c.w,c.h,c.r,f),t.globalCompositeOperation=g?"source-over":"lighter",g=!1,t.globalAlpha=m,le(t,e,a,r,l),t.globalAlpha=1,t.globalCompositeOperation="destination-in",t.fillStyle=h,t.fillRect(0,0,o,n),t.restore(),d-=m}}function ce(t,e,a,r,o,n,i){const h=i|0;if(h<1||r<=2*h||o<=2*h){t.beginPath(),Q(t,e,a,r,o,n),t.clip();return}t.beginPath(),Q(t,e,a,r,o,n),Q(t,e+h,a+h,r-2*h,o-2*h,Math.max(0,n-h)),t.clip("evenodd")}function rr(t,e,a,r,o,n,i,h,l,c,u,f){let d=h*u,g=!0;for(let x=0;x<3&&d>1e-4;x++){const m=Math.min(1,d);t.save(),ce(t,i.x,i.y,i.w,i.h,i.r,l),t.globalCompositeOperation=g?"source-over":"lighter",g=!1,t.globalAlpha=m,le(t,e,a,r,f),t.globalAlpha=1,t.globalCompositeOperation="destination-in",t.fillStyle=c,t.fillRect(0,0,o,n),t.restore(),d-=m}}function or(t,e,a,r,o,n,i,h){const l=t.createLinearGradient(r,o,n,i);l.addColorStop(0,`rgba(255,255,255,${h.toFixed(3)})`),l.addColorStop(.5,`rgba(255,255,255,${(h*.45).toFixed(3)})`),l.addColorStop(1,"rgba(255,255,255,0)"),t.save(),ce(t,e.x,e.y,e.w,e.h,e.r,a),t.globalCompositeOperation="lighter",t.lineWidth=a*2,t.strokeStyle=l,t.beginPath(),Q(t,e.x,e.y,e.w,e.h,e.r),t.stroke(),t.restore()}function de(t){const e=getComputedStyle(t),a=[parseFloat(e.borderTopLeftRadius)||0,parseFloat(e.borderTopRightRadius)||0,parseFloat(e.borderBottomRightRadius)||0,parseFloat(e.borderBottomLeftRadius)||0].filter(r=>r>0);return a.length?Math.min.apply(null,a):0}function he(t){const e=getComputedStyle(t),a=Math.max(parseFloat(e.borderTopWidth)||0,parseFloat(e.borderRightWidth)||0,parseFloat(e.borderBottomWidth)||0,parseFloat(e.borderLeftWidth)||0);let r=0,o=0;const n=e.boxShadow;if(n&&n!=="none"){const h=n.replace(/rgba?\([^)]*\)/g,u=>u.replace(/,/g,"\0")).split(/,\s*/);let l=1/0,c=1/0;for(const u of h){const f=u.match(/-?\d+(?:\.\d+)?px/g);if(!f||f.length<4)continue;const d=parseFloat(f[3]);d>0&&(/\binset\b/.test(u)?d<l&&(l=d):d<c&&(c=d))}Number.isFinite(l)&&(r=l),Number.isFinite(c)&&(o=c)}const i=Math.max(a,o);return{width:Math.max(a,r,o)||1,outerCssPx:i}}function qt(t){t.cornerRadius=de(t.el);const e=he(t.el);t.hairlineWidth=e.width,t.hairlineOuterCssPx=e.outerCssPx}function nr(t){typeof ResizeObserver<"u"&&(t.resizeObserver=new ResizeObserver(()=>qt(t)),t.resizeObserver.observe(t.el)),typeof MutationObserver<"u"&&(t.mutationObserver=new MutationObserver(()=>qt(t)),t.mutationObserver.observe(t.el,{attributes:!0,attributeFilter:["style","class"]}))}function ir(t){var e,a;(e=t.resizeObserver)==null||e.disconnect(),t.resizeObserver=null,(a=t.mutationObserver)==null||a.disconnect(),t.mutationObserver=null}const tt=new Set;function sr(t,e,a){if(typeof document>"u"||Ya.has(t.tagName))return null;for(const g of tt)if(g.el===t)return g;const r=document.createElement("div");r.setAttribute("data-metal-fx-reflection",""),r.setAttribute("aria-hidden","true");const o=document.createElement("canvas");o.className="metal-fx-reflection-canvas";const n=o.getContext("2d",{alpha:!0});if(!n)return null;const i=document.createElement("canvas");i.className="metal-fx-reflection-stroke-canvas";const h=i.getContext("2d",{alpha:!0});if(!h)return null;r.appendChild(o),r.appendChild(i);const l=getComputedStyle(t);let c=!1;l.position==="static"&&(t.style.position="relative",c=!0);let u=!1;l.isolation!=="isolate"&&(t.style.isolation="isolate",u=!0),t.setAttribute("data-metal-fx-reflect-host",""),t.insertBefore(r,t.firstChild);const f=he(t),d={el:t,anchor:e,anchorEl:a,wrap:r,canvas:o,ctx:n,strokeCanvas:i,strokeCtx:h,cornerRadius:de(t),hairlineWidth:f.width,hairlineOuterCssPx:f.outerCssPx,appliedPositionRelative:c,appliedIsolation:u,resizeObserver:null,mutationObserver:null};return nr(d),tt.add(d),d}function lr(t){for(const e of tt)if(e.el===t){ir(e),e.canvas.width=0,e.canvas.height=0,e.strokeCanvas.width=0,e.strokeCanvas.height=0,e.wrap.parentNode===e.el&&e.el.removeChild(e.wrap),e.el.removeAttribute("data-metal-fx-reflect-host"),e.appliedPositionRelative&&(e.el.style.position=""),e.appliedIsolation&&(e.el.style.isolation=""),tt.delete(e);return}}function cr(){if(tt.size===0)return;const t=typeof window<"u"&&window.devicePixelRatio||1,e=new Map;for(const a of tt){const r=a.el.getBoundingClientRect();let o=e.get(a.anchorEl);if(o||(o=a.anchorEl.getBoundingClientRect(),e.set(a.anchorEl,o)),r.width<1||r.height<1||o.width<1||o.height<1)continue;if(!Ka(o,r,Gt,zt)&&!Za(o,r,Gt,zt)){a.canvas.width!==1&&(a.canvas.width=1,a.canvas.height=1),a.strokeCanvas.width!==1&&(a.strokeCanvas.width=1,a.strokeCanvas.height=1);continue}const n=a.anchor.canvas,i=n.width|0,h=n.height|0;if(i<4||h<4)continue;const l=(o.left+o.right)*.5,c=(o.top+o.bottom)*.5,u=(r.left+r.right)*.5,f=(r.top+r.bottom)*.5,d=l-u,g=c-f,x=Math.max(o.left-r.right,r.left-o.right,0),m=Math.max(o.top-r.bottom,r.top-o.bottom,0),I=x>=m,b=Ja(o,r);let P=1-Math.min(1,b/yt);P=P*P*(3-2*P);const j=Dt+(Ea-Dt)*P,L=Math.min(Ut,j*Ba*Ha),C=a.anchor.scale??1,E=Math.max(za*C,a.hairlineWidth),H=Math.max(1,Math.round(E*t)),X=Math.max(1,Math.round(Math.max(Da*C,a.hairlineWidth)*t)),N=a.hairlineOuterCssPx;a.wrap.style.inset=`${-N}px`,a.wrap.style.borderRadius=`${Math.max(0,a.cornerRadius)}px`;const $=Math.max(1,Math.round((r.width+N*2)*t)),k=Math.max(1,Math.round((r.height+N*2)*t));a.canvas.width!==$&&(a.canvas.width=$),a.canvas.height!==k&&(a.canvas.height=k),a.strokeCanvas.width!==$&&(a.strokeCanvas.width=$),a.strokeCanvas.height!==k&&(a.strokeCanvas.height=k);const F=a.ctx;F.setTransform(1,0,0,1,0,0),F.clearRect(0,0,$,k);const W=a.strokeCtx;W.setTransform(1,0,0,1,0,0),W.clearRect(0,0,$,k);const B=Math.min(yt*t,Math.max($,k));let z,y,w,v;I?(z=d>0?$:0,w=d>0?$-B:B,y=k*.5,v=k*.5):(y=g>0?k:0,v=g>0?k-B:B,z=$*.5,w=$*.5);const M=F.createLinearGradient(z,y,w,v);M.addColorStop(0,`rgba(0,0,0,${La})`),M.addColorStop(.5,`rgba(0,0,0,${Na})`),M.addColorStop(1,`rgba(0,0,0,${Wa})`);const S=i/t,O=Math.max(1,Math.round(qa*Math.max(.1,S/140)*t));let D,U,T,A,V=!1,Ct=!1;if(I){const at=Math.max(o.top,r.top),ut=Math.min(o.bottom,r.bottom);V=!0,D=d>0?$-O:0,U=Math.round((at-r.top+N)*t),T=O,A=Math.max(1,Math.round((ut-at)*t))}else{const at=Math.max(o.left,r.left),ut=Math.min(o.right,r.right);Ct=!0,D=Math.round((at-r.left+N)*t),U=g>0?k-O:0,T=Math.max(1,Math.round((ut-at)*t)),A=O}const St={x:D,y:U,w:T,h:A,flipX:V,flipY:Ct},ht={x:0,y:0,w:$,h:k,r:Math.max(0,a.cornerRadius*t)},me=Math.min(Ut,L*Va*Qa*Xa);ar(F,n,i,h,$,k,me,M,St,ht,t),rr(W,n,i,h,$,k,ht,L,H,M,Ga,St),or(W,ht,X,z,y,w,v,Math.min(.85,Ua*L)),F.globalCompositeOperation="source-over",W.globalCompositeOperation="source-over"}}let gt=!1,Vt=0;function dr(){gt||(gt=!0,!(typeof requestAnimationFrame>"u")&&requestAnimationFrame(t=>{gt=!1,!(t-Vt<Ae)&&(Vt=t,cr())}))}const Qt="metal-fx-styles",hr=`
.metal-fx-root {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  isolation: isolate;
  overflow: visible;
  background: #272727;
  color: #f8f8f8;
}
.metal-fx-root[data-theme='light'] {
  background: #ffffff;
  color: #1d1d1d;
}

.metal-fx-root::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 2;
  box-shadow: inset 0 0 50px 0 rgba(255, 255, 255, 0.02);
}
.metal-fx-root[data-theme='light']::before {
  box-shadow: inset 0 0 50px 0 rgba(0, 0, 0, 0.02);
}

.metal-fx-root::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  z-index: 4;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}
.metal-fx-root[data-theme='light']::after {
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
}
/* Circle variant gets a thicker outer rim than the button variant. */
.metal-fx-root[data-variant='circle']::after {
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.1);
}
.metal-fx-root[data-theme='light'][data-variant='circle']::after {
  box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.06);
}

.metal-fx-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  z-index: 0;
  pointer-events: none;
  border-radius: inherit;
}

/* The inner spacer — defines the inset geometry where the metal ring meets
   the interior (3 px for Button, 1-2 px for Circle) and carries the Circle dark
   hairline ('box-shadow: inset' rules below). Intentionally transparent so
   the wrapper's background propagates through to the punched shader centre,
   giving consumers a single surface tone to override. See "Single-surface
   background" in the file header for the rationale. */
.metal-fx-inner {
  position: absolute;
  inset: 3px;
  border-radius: inherit;
  z-index: 1;
  pointer-events: none;
}

.metal-fx-root[data-variant='button'][data-shape='pill'] .metal-fx-inner {
  border-radius: calc(var(--mfx-radius, 20px) - 3px);
}
.metal-fx-root[data-variant='button'][data-shape='circle'] .metal-fx-inner {
  border-radius: calc(var(--mfx-radius, 16px) - 3px);
}
.metal-fx-root[data-variant='circle'][data-shape='pill'] .metal-fx-inner {
  inset: 0;
  border-radius: var(--mfx-radius, 20px);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
}
.metal-fx-root[data-variant='circle'][data-shape='circle'] .metal-fx-inner {
  inset: 0;
  border-radius: var(--mfx-radius, 16px);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
}
/* Circle-variant hairline alpha — light mode.
   Source-of-truth: index.html L2261-2267. The 0.45-alpha black inset that
   reads as a single-pixel frame against the dark interior is too heavy
   on a #ffffff inner: it ends up looking like a hard 2-px black ring
   against the iridescent shader. Suppressed entirely (alpha 0) — the
   shader's own iridescent rim already defines the silhouette in light
   mode, so an extra dark hairline only competes with it. The rule is
   kept (rather than deleted) as a tunable hook in case a future variant
   wants to re-introduce a soft edge. NOTE: we keep the dark-mode inset
   and border-radius values because — unlike index.html — our renderer
   does NOT overscan the canvas in light mode, so there is no 1-px gap
   between inner element and shader to compensate for. */
.metal-fx-root[data-theme='light'][data-variant='circle'][data-shape='pill'] .metal-fx-inner,
.metal-fx-root[data-theme='light'][data-variant='circle'][data-shape='circle'] .metal-fx-inner {
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0);
}

/* ─── Combined glow SVG (z=3) ──────────────────────────────────────────────
   Single SVG per instance that holds BOTH the wide-halo group
   (#mfx_haloTravel) and the catch-light group (#mfx_extraTravel), exactly
   mirroring canonical's _buildGlowSvgInner (index.html L8078). One
   mix-blend-mode: screen lifts the combined composite onto the shader
   ring; per-frame opacity attributes on each inner group still drive the
   independent fade-in / fade-out cycles for the halo and the catch-light.

   Why a single SVG: the circle variant anchors halo + catch-light at the same
   perimeter point, so they overlap in the bright zone. Two separately-
   screened SVGs would double-screen the overlap (A + B + C - AB - AC -
   BC + ABC instead of A + B + C - AB - AC once both groups composite
   in source-over inside one SVG and then screen against the host once).
   That overlap looked muted versus canonical specifically on the circle
   variant where both layers travel together.

   Source-of-truth opacity: #btnGlowSvg drops to 0.7 in dark and 0.2746 in
   light (index.html L632/L643). */
.metal-fx-glow-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  z-index: 3;
  pointer-events: none;
  opacity: 0.7;
}
.metal-fx-root[data-theme='light'] .metal-fx-glow-svg {
  /* Light-mode 1-px overscan mirrors .btn-glow-svg in metal.html so the
     halo stays glued to the visible silhouette (the shader ring there sits
     1 px outside the host's padding box). */
  inset: -1px;
  width: calc(100% + 2px);
  height: calc(100% + 2px);
  mix-blend-mode: multiply;
  /* Source-of-truth: html[data-theme="light"] #btnGlowSvg { opacity: 0.2746 }
     → −35 % from 0.4225 from the original 0.7 dark-mode opacity. */
  opacity: 0.2746;
  filter: saturate(5.355) brightness(0.78);
}
/* Circle light-mode small variants (e.g. 36×36 send button): the geometrically
   shrunk halo loses density when multiplied against #ffffff. Mirror the
   canonical override at index.html L2316 — bump saturation + drop brightness
   so the small glow holds together visually. */
.metal-fx-root[data-variant='circle'][data-shape='circle'][data-theme='light'] .metal-fx-glow-svg {
  filter: saturate(7.5) brightness(0.6);
}

/* The wrapped child — hoisted into z=5 so it sits above every overlay, with
   normalized chrome so consumer button styles don't fight the metal frame. */
.metal-fx-content {
  position: relative;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  pointer-events: none;
}
.metal-fx-content > * {
  pointer-events: auto;
}
.metal-fx-root[data-normalize='true'] .metal-fx-content > * {
  background: transparent !important;
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  /* Sizing: we deliberately DO NOT force \`width: 100%; height: 100%\` on the
     child here. That used to be the contract ("the wrapper is the visible
     button surface; the child stretches to fill it"), but it created a cyclic
     percentage dependency: the wrapper is \`inline-flex\` with no intrinsic
     size, .metal-fx-content is \`width/height: 100%\` of the wrapper, and the
     child was \`100%\` of .metal-fx-content. With nothing breaking the cycle,
     icon-only / class-sized children collapsed.

     The new contract: the child sizes itself (intrinsic content, CSS class,
     or inline style — all work), and the wrapper's \`inline-flex\` wraps it
     tightly. Consumers who want a metal frame BIGGER than the child (e.g.
     padding around an icon) size <MetalFx style={{ width, height }}> AND
     explicitly set width/height on the child to fill (or accept that the
     child renders at its intrinsic size, centered).

     Typography is intentionally NOT touched. We used to apply
     \`color: inherit; font: inherit;\` here to "match" the wrapper, but
     \`font: inherit\` is a shorthand that overrides font-family, font-size,
     font-weight, AND line-height on the child — which (a) shrank the
     button height (line-height changes propagate through the flex
     content box) and (b) scaled em-based icons / font-icons inside the
     child to whatever the wrapper inherited. The wrapper now stays out
     of the child's typography entirely; consumers who want typographic
     normalization can apply it themselves on the child element. */
}

[data-metal-fx-reflection] {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  overflow: hidden;
  z-index: 0;
  isolation: isolate;
}
.metal-fx-reflection-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  filter: blur(4px) saturate(1.2) brightness(1.58);
}
.metal-fx-reflection-stroke-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  filter: saturate(1.35) brightness(1.75);
}
/* Hosts that participate as reflection targets need positioning + isolation
   so the wrap composites only against the host (not the parent stack). The
   wrap injects these inline as well, but stating them here keeps reflections
   working on hosts that already have other inline styles applied. */
[data-metal-fx-reflect-host] {
  isolation: isolate;
}
`;let vt=!1;function ur(){if(vt||typeof document>"u")return;if(document.getElementById(Qt)){vt=!0;return}const t=document.createElement("style");t.id=Qt,t.textContent=hr,document.head.appendChild(t),vt=!0}ur();const fr={position:"absolute",inset:0,width:"100%",height:"100%"},pr={position:"absolute",inset:3},mr={position:"absolute",inset:0,pointerEvents:"none",zIndex:3,borderRadius:"inherit"},ct=new Map;oa((t,e)=>{const a=ct.get(t);a&&ja(a.handles,t,e,t.opacityMul,a.themeRef.current)});function xr(t){const[e,a]=_.useState(()=>t!=="auto"?t:typeof window>"u"||!window.matchMedia||window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");return _.useEffect(()=>{if(t!=="auto"){a(t);return}if(typeof window>"u"||!window.matchMedia)return;const r=window.matchMedia("(prefers-color-scheme: dark)"),o=()=>a(r.matches?"dark":"light");return o(),r.addEventListener("change",o),()=>r.removeEventListener("change",o)},[t]),e}const ue=_.forwardRef(function({children:t,variant:e="button",preset:a="chromatic",theme:r="auto",strength:o=1,paused:n=!1,borderRadius:i,normalizeHostStyles:h=!0,reflectionTargets:l,disableGlow:c=!1,shaderScale:u,ringCssPx:f,scale:d=1,className:g,style:x,...m},I){const b=_.useRef(null),P=_.useRef(null),j=_.useRef(null),L=_.useRef(null),C=_.useRef(null),E=_.useRef(null),H=_.useRef("dark"),X=_.useRef(0),[N,$]=_.useState(!1),k=xr(r);H.current=k;const F=e==="circle"?"circle":"pill",W=!c;_.useImperativeHandle(I,()=>b.current,[]);const B=(y,w)=>{if(F==="circle")return Math.min(y,w)/2;const v=typeof i=="number"?i:(()=>{var M;const S=(M=L.current)==null?void 0:M.firstElementChild;if(S){const O=parseFloat(getComputedStyle(S).borderTopLeftRadius);if(Number.isFinite(O)&&O>0)return O}return X.current})();return Math.min(v,Math.min(y,w)/2)};_.useEffect(()=>{ra(a,k)},[a,k]),_.useEffect(()=>{const y=C.current;y&&rt(y,{paused:n})},[n]),_.useEffect(()=>{const y=C.current;if(!y)return;const w={};u!==void 0&&(w.shaderScale=u),f!==void 0&&(w.ringCssPx=f),d!==void 0&&(w.scale=d),Object.keys(w).length>0&&rt(y,w)},[u,f,d]),_.useLayoutEffect(()=>{const y=P.current,w=b.current,v=j.current;if(!y||!w)return;{const T=getComputedStyle(w),A=parseFloat(T.borderTopLeftRadius);X.current=Number.isFinite(A)?A:0}const M=()=>{const T=w.getBoundingClientRect(),A=Math.max(1,Math.round(T.width)),V=Math.max(1,Math.round(T.height));return{cssWidth:A,cssHeight:V,cornerRadius:B(A,V)}},S=M();C.current=Ke({hostCanvas:y,cssWidth:S.cssWidth,cssHeight:S.cssHeight,cornerRadius:S.cornerRadius,kind:F,paused:n,shaderScale:u,ringCssPx:f,scale:d,onFirstCopy:()=>$(!0)}),w.style.setProperty("--mfx-radius",`${S.cornerRadius}px`),w.style.borderRadius=`${S.cornerRadius}px`,v&&(E.current=Ht(v,{width:S.cssWidth,height:S.cssHeight,cornerRadius:S.cornerRadius,kind:F,scale:d}));let O=0;const D=new ResizeObserver(()=>{O===0&&(O=requestAnimationFrame(()=>{O=0;const T=M(),A=C.current;A&&(rt(A,{cssWidth:T.cssWidth,cssHeight:T.cssHeight,cornerRadius:T.cornerRadius}),w.style.setProperty("--mfx-radius",`${T.cornerRadius}px`),w.style.borderRadius=`${T.cornerRadius}px`,v&&(v.innerHTML="",E.current=Ht(v,{width:T.cssWidth,height:T.cssHeight,cornerRadius:T.cornerRadius,kind:F,scale:d}),A&&E.current&&ct.set(A,{handles:E.current,themeRef:H})))}))});D.observe(w);let U=null;return typeof IntersectionObserver<"u"&&(U=new IntersectionObserver(T=>{const A=C.current;if(A)for(const V of T)aa(A,V.isIntersecting)},{rootMargin:"64px"}),U.observe(w)),C.current&&E.current&&(ct.set(C.current,{handles:E.current,themeRef:H}),ta(C.current)),()=>{D.disconnect(),U?.disconnect(),O!==0&&cancelAnimationFrame(O);const T=C.current;T&&(ct.delete(T),ea(T),Ze(T)),C.current=null,E.current=null,v&&(v.innerHTML="")}},[F]),_.useEffect(()=>{const y=C.current;y&&rt(y,{opacityMul:Math.max(0,Math.min(1,o))})},[o,e]),_.useEffect(()=>{const y=C.current,w=b.current;if(!y||!w||!l||k!=="dark")return;y.onAfterFrame=dr;const v=l.flatMap(M=>M.current?[M.current]:[]);for(const M of v)sr(M,y,w);return()=>{y.onAfterFrame=void 0;for(const M of v)lr(M)}},[l,k]),_.useEffect(()=>{const y=b.current,w=C.current;if(!y||!w)return;const v=B(w.cssWidth,w.cssHeight);rt(w,{cornerRadius:v}),y.style.setProperty("--mfx-radius",`${v}px`),y.style.borderRadius=`${v}px`},[i,k,e,F]);const z=_.useMemo(()=>({...x,"--mfx-strength":String(Math.min(1,Math.max(0,o))),opacity:N?1:0,visibility:N?"visible":"hidden",transition:N?"opacity 0.15s ease-out":"none"}),[x,o,N]);return p.jsxs("div",{...m,ref:b,className:g?`metal-fx-root ${g}`:"metal-fx-root","data-variant":e,"data-shape":F,"data-theme":k,"data-paused":n?"true":void 0,"data-normalize":h?"true":"false",style:z,children:[p.jsx("canvas",{ref:P,className:"metal-fx-canvas",style:fr}),p.jsx("div",{className:"metal-fx-inner","aria-hidden":"true",style:pr}),p.jsx("div",{ref:j,"aria-hidden":"true",style:{...mr,display:W?void 0:"none"}}),p.jsx("div",{ref:L,className:"metal-fx-content",children:t})]})});ue.displayName="MetalFx";const et=18;function fe(){return p.jsxs("svg",{"aria-hidden":!0,width:et,height:et,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p.jsx("circle",{cx:"12",cy:"12",r:"4"}),p.jsx("path",{d:"M12 2v2"}),p.jsx("path",{d:"M12 20v2"}),p.jsx("path",{d:"m4.93 4.93 1.41 1.41"}),p.jsx("path",{d:"m17.66 17.66 1.41 1.41"}),p.jsx("path",{d:"M2 12h2"}),p.jsx("path",{d:"M20 12h2"}),p.jsx("path",{d:"m6.34 17.66-1.41 1.41"}),p.jsx("path",{d:"m19.07 4.93-1.41 1.41"})]})}function pe(){return p.jsx("svg",{"aria-hidden":!0,width:et,height:et,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:p.jsx("path",{d:"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"})})}function gr(){return p.jsxs("svg",{"aria-hidden":!0,width:et,height:et,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[p.jsx("rect",{x:"2",y:"3",width:"20",height:"14",rx:"2"}),p.jsx("path",{d:"M8 21h8"}),p.jsx("path",{d:"M12 17v4"})]})}const vr=[{value:"light",label:"Light",Icon:fe},{value:"dark",label:"Dark",Icon:pe},{value:"system",label:"System",Icon:gr}];function br(t){return t==="dark"?pe:fe}function wr({theme:t,resolvedTheme:e,onSetTheme:a,className:r="",direction:o="down",align:n="right"}){const[i,h]=_.useState(!1),l=_.useRef(null),c=_.useCallback(()=>h(!1),[]);_.useEffect(()=>{if(!i)return;const f=d=>{l.current&&!l.current.contains(d.target)&&c()};return document.addEventListener("mousedown",f),()=>document.removeEventListener("mousedown",f)},[i,c]),_.useEffect(()=>{if(!i)return;const f=d=>{d.key==="Escape"&&c()};return document.addEventListener("keydown",f),()=>document.removeEventListener("keydown",f)},[i,c]);const u=br(e);return p.jsxs("div",{ref:l,className:`relative ${r}`,children:[p.jsx("button",{type:"button","aria-label":"Theme","aria-expanded":i,onClick:()=>h(f=>!f),className:"flex items-center justify-center w-9 h-9 rounded-lg text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white transition-colors",children:p.jsx(u,{})}),i&&p.jsx("div",{className:`absolute z-50 min-w-[140px] py-1 rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 shadow-lg ${o==="up"?"bottom-full mb-1":"top-full mt-1"} ${n==="left"?"left-0":"right-0"}`,children:vr.map(({value:f,label:d,Icon:g})=>{const x=t===f;return p.jsxs("button",{type:"button",onClick:()=>{a(f),c()},className:`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors ${x?"text-oai-black dark:text-white bg-oai-gray-100 dark:bg-oai-gray-800":"text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/60 hover:text-oai-black dark:hover:text-white"}`,children:[p.jsx(g,{}),p.jsx("span",{children:d})]},f)})})]})}const yr="https://github.com/mm7894215/TokenTracker/releases/latest";function Er({auth:t,signedIn:e,sessionSoftExpired:a,userId:r}){const{currency:o,rate:n}=ke(),{theme:i,resolvedTheme:h,setTheme:l}=ge(),{openLoginModal:c}=ve(),{signedIn:u,loading:f}=be(),d=!we(),g=e&&!a,x=_.useMemo(()=>g&&(typeof t=="function"||typeof t=="string"||t&&typeof t=="object")?t:null,[t,g]),m=_e({userId:r,period:"total",accessToken:x});return p.jsxs("div",{className:"flex flex-col min-h-screen bg-oai-gray-50 dark:bg-oai-gray-950 text-oai-black dark:text-oai-white font-oai antialiased transition-colors duration-200",children:[p.jsx("header",{className:"sticky top-0 z-50 w-full px-4 pt-4 pb-2 transition-all duration-300 pointer-events-none",children:p.jsxs("div",{className:"mx-auto max-w-3xl rounded-2xl border border-oai-gray-200/50 dark:border-white/10 bg-white/75 dark:bg-oai-gray-950/60 backdrop-blur-xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.3)] flex h-14 items-center justify-between px-3 sm:px-4 pointer-events-auto transition-all duration-300",children:[p.jsxs("div",{className:"flex items-center gap-4",children:[p.jsxs(Tt,{to:"/",className:"flex items-center gap-3 no-underline outline-none rounded-md focus-visible:ring-2 focus-visible:ring-indigo-500 transition-opacity hover:opacity-80 active:scale-95",children:[p.jsx("img",{src:"/app-icon.png",alt:"",width:24,height:24,className:"rounded-md"}),p.jsx("span",{className:"text-sm font-semibold tracking-wide text-oai-black dark:text-white uppercase",children:"Token Tracker"})]}),p.jsx("div",{className:"hidden sm:block scale-90 origin-left opacity-90 hover:opacity-100 transition-opacity",children:p.jsx(Me,{})})]}),p.jsxs("div",{className:"flex items-center gap-1.5 sm:gap-2",children:[p.jsxs(Tt,{to:"/leaderboard",className:"group no-underline inline-flex items-center gap-1.5 h-8 px-3 text-xs font-bold rounded-full border border-oai-gray-200 dark:border-white/10 bg-transparent text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-100 dark:hover:bg-white/5 hover:text-oai-black dark:hover:text-white transition-all duration-200 active:scale-95 shadow-sm",children:[p.jsx(Re,{size:13,strokeWidth:2.5,"aria-hidden":!0,className:"transition-transform duration-150 ease-out group-hover:scale-110 group-hover:rotate-6"}),p.jsx("span",{children:Y("leaderboard.profile.nav.back")})]}),d&&p.jsx(ue,{variant:"button",preset:"chromatic",theme:"dark",borderRadius:9999,disableGlow:!0,className:"!bg-black",children:p.jsxs("a",{href:yr,target:"_blank",rel:"noopener noreferrer",className:"group no-underline inline-flex h-8 items-center gap-1.5 px-3 text-xs font-bold rounded-full bg-black text-white transition-transform duration-200 active:scale-[0.98]",children:[p.jsx(Te,{size:13,strokeWidth:2.5,"aria-hidden":!0,className:"transition-transform duration-150 ease-out group-hover:translate-y-0.5"}),p.jsx("span",{className:"hidden sm:inline",children:Y("leaderboard.profile.nav.download")})]})}),f?p.jsx("div",{className:"h-8 w-16 animate-pulse rounded-full bg-oai-gray-200 dark:bg-white/10","aria-hidden":!0}):u?p.jsx(ye,{}):p.jsx("button",{type:"button",onClick:c,className:"inline-flex h-8 min-w-[76px] items-center justify-center px-3 text-xs font-bold rounded-full border border-oai-gray-200 dark:border-white/10 bg-transparent text-oai-gray-700 dark:text-oai-gray-300 hover:bg-oai-gray-100 dark:hover:bg-white/5 hover:text-oai-black dark:hover:text-white transition-all duration-200 active:scale-95 shadow-sm select-none",children:Y("header.auth.sign_in_aria")})]})]})}),p.jsx("main",{className:"flex-1 px-4 pt-4 pb-10 sm:pt-6 sm:pb-16",children:p.jsx("div",{className:"mx-auto max-w-3xl",children:p.jsxs("div",{className:"rounded-2xl bg-white dark:bg-oai-gray-950 ring-1 ring-oai-gray-200 dark:ring-oai-gray-800 overflow-hidden shadow-sm dark:shadow-none",children:[m.loading&&p.jsx(Ce,{variant:"page"}),!m.loading&&m.error&&p.jsx("div",{className:"px-6 py-16 text-center",children:p.jsx("p",{className:"text-sm text-red-500 dark:text-red-400",children:Y("leaderboard.profile_modal.error")})}),!m.loading&&!m.error&&!m.data&&p.jsx("div",{className:"px-6 py-16 text-center",children:p.jsx("p",{className:"text-sm text-oai-gray-500 dark:text-oai-gray-400",children:Y("leaderboard.profile_modal.empty")})}),!m.loading&&!m.error&&m.data&&p.jsx(Se,{data:m.data,currency:o,rate:n,variant:"page"})]})})}),p.jsx("footer",{className:"border-t border-oai-gray-200 dark:border-oai-gray-900 py-8 px-4 transition-colors duration-200",children:p.jsxs("div",{className:"mx-auto flex max-w-3xl items-center justify-between text-sm text-oai-gray-400 dark:text-oai-gray-500",children:[p.jsx("p",{children:Y("landing.v2.footer.line")}),p.jsx(wr,{theme:i,resolvedTheme:h,onSetTheme:l,direction:"up",align:"right"})]})})]})}export{Er as LeaderboardProfilePage};
