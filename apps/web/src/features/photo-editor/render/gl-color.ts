import type {
  ChromaParams,
  DetailParams,
  GrainParams,
  LinearParams,
  ToneLut,
  VignetteParams,
} from "@lumio/shared";

/** The render inputs — exactly the artifacts the shared color model produces.
 *  The bake (`applyColorToRaw`) runs the identical math, so preview = save. */
export interface GlColorModel {
  /** Exposure × white-balance matrix, applied in linear light. null = identity. */
  linear: LinearParams | null;
  /** Per-channel tone LUT (any length; uploaded as a 256-wide texture). null = identity. */
  tone: ToneLut | null;
  chroma: ChromaParams | null;
  vignette: VignetteParams | null;
  /** Spatial sharpen + masking + noise reduction (3×3 of source). null = off. */
  detail: DetailParams | null;
  /** Per-pixel film grain, applied last. null = off. */
  grain: GrainParams | null;
}

const IDENTITY3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export function isWebGL2Available(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    // Release the probe context immediately — WebGL contexts are a scarce resource
    // (~16 per page); leaking one per call would evict live editor contexts.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  // Flip V so texture row 0 (image top) lands at the top of the canvas.
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Fragment shader — mirrors packages/shared/src/photo-color.ts#applyColorToRaw:
// linear pre-pass (exposure × white balance) → tone LUT per channel →
// hue/saturation/vibrance → radial vignette.
const FRAG = `#version 300 es
precision highp float;
precision highp int;   // grain hash needs full 32-bit uint math (fragment int defaults to mediump)
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uImage;
uniform sampler2D uLut;     // 256x1 RGB: column i = [toneR[i], toneG[i], toneB[i]]
uniform bool uHasLinear;
uniform mat3 uLinear;       // exposure × white-balance CAT (column-major)
uniform bool uHasChroma;
uniform float uHue;         // degrees
uniform float uSatF;
uniform float uVib;
uniform float uVigStrength; // signed: <0 darken corners, >0 lighten
uniform vec2 uResolution;   // image size in px (for texel offsets + grain coords)
uniform bool uHasDetail;
uniform float uSharpen;     // folded high-pass gain (sharpen/100 × SHARPEN_MAX)
uniform float uMask;        // 0..1 masking strength
uniform float uNr;          // 0..1 noise-reduction strength
uniform bool uHasGrain;
uniform float uGrainAmount; // grain/100 × GRAIN_MAX
uniform float uGrainCell;   // grain lattice cell size in px (>=1)

// Detail/grain constants — kept byte-identical to packages/shared/src/photo-color.ts.
const float MASK_LO = 0.1;
const float MASK_HI = 0.8;
const float NR_SIGMA = 0.12;
const float GWv[9] = float[9](1.0, 2.0, 1.0, 2.0, 4.0, 2.0, 1.0, 2.0, 1.0);
const float SXv[9] = float[9](-1.0, 0.0, 1.0, -2.0, 0.0, 2.0, -1.0, 0.0, 1.0);
const float SYv[9] = float[9](-1.0, -2.0, -1.0, 0.0, 0.0, 0.0, 1.0, 2.0, 1.0);

float lumaOf(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Integer pixel-coord hash, reduced to 16 bits so float32 matches JS double.
uint grainHashU(uint ix, uint iy) {
  uint n = (ix * 0x1f1f1f1fu) ^ iy;
  n = n * 0x27d4eb2du;
  n = n ^ (n >> 15u);
  return n;
}
float grainHash(int ix, int iy) {
  return float(grainHashU(uint(ix), uint(iy)) & 0xffffu) / 65536.0;
}
float smoothUnit(float t) { return t * t * (3.0 - 2.0 * t); }
float valueNoise(float x, float y, float cell) {
  float fx = x / cell, fy = y / cell;
  float ifx = floor(fx), ify = floor(fy);
  int ix = int(ifx), iy = int(ify);
  float sx = smoothUnit(fx - ifx), sy = smoothUnit(fy - ify);
  float a = mix(grainHash(ix, iy),     grainHash(ix + 1, iy),     sx);
  float b = mix(grainHash(ix, iy + 1), grainHash(ix + 1, iy + 1), sx);
  return mix(a, b, sy) * 2.0 - 1.0;
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 rotateHue(vec3 c, float deg) {
  float a = radians(deg);
  float cs = cos(a);
  float sn = sin(a);
  return vec3(
    c.r * (0.213 + cs * 0.787 - sn * 0.213) + c.g * (0.715 - cs * 0.715 - sn * 0.715) + c.b * (0.072 - cs * 0.072 + sn * 0.928),
    c.r * (0.213 - cs * 0.213 + sn * 0.143) + c.g * (0.715 + cs * 0.285 + sn * 0.140) + c.b * (0.072 - cs * 0.072 - sn * 0.283),
    c.r * (0.213 - cs * 0.213 - sn * 0.787) + c.g * (0.715 - cs * 0.715 + sn * 0.715) + c.b * (0.072 + cs * 0.928 + sn * 0.072)
  );
}

void main() {
  vec4 src = texture(uImage, vUv);

  // Detail (spatial): denoise + sharpen the SOURCE from a clamped 3×3, before color.
  vec3 c;
  if (uHasDetail) {
    vec2 texel = 1.0 / uResolution;
    vec3 ctr = src.rgb;
    float cl = lumaOf(ctr);
    float sig2 = NR_SIGMA * NR_SIGMA;
    vec3 blur = vec3(0.0);
    vec3 nrSum = vec3(0.0);
    float nrW = 0.0, gx = 0.0, gy = 0.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        int k = (j + 1) * 3 + (i + 1);
        vec3 s = texture(uImage, vUv + vec2(float(i), float(j)) * texel).rgb;
        float gw = GWv[k] / 16.0;
        blur += gw * s;
        float nl = lumaOf(s);
        float bw = gw * exp(-((nl - cl) * (nl - cl)) / sig2);
        nrSum += bw * s; nrW += bw;
        gx += SXv[k] * nl; gy += SYv[k] * nl;
      }
    }
    vec3 den = mix(ctr, nrSum / nrW, uNr);
    float edge = smoothstep(MASK_LO, MASK_HI, sqrt(gx * gx + gy * gy));
    c = den + (uSharpen * mix(1.0, edge, uMask)) * (den - blur);
  } else {
    c = src.rgb;
  }

  // Exposure × white balance in LINEAR light, then re-encode to gamma.
  if (uHasLinear) {
    c = linearToSrgb(uLinear * srgbToLinear(c));
  }

  // Tone: per-channel LUT lookup (linear filtering interpolates between entries,
  // matching the shared sampleLut lerp).
  c = vec3(
    texture(uLut, vec2(c.r, 0.5)).r,
    texture(uLut, vec2(c.g, 0.5)).g,
    texture(uLut, vec2(c.b, 0.5)).b
  );

  if (uHasChroma) {
    if (uHue != 0.0) c = rotateHue(c, uHue);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float vf = 1.0;
    if (uVib != 0.0) {
      float mx = max(c.r, max(c.g, c.b));
      float mn = min(c.r, min(c.g, c.b));
      float pixSat = mx <= 0.0 ? 0.0 : (mx - mn) / mx;
      vf = 1.0 + uVib * (1.0 - pixSat);
    }
    float f = uSatF * vf;
    c = vec3(l) + (c - vec3(l)) * f;
  }

  if (uVigStrength != 0.0) {
    float dist = length(vUv - 0.5) / 0.70710678;
    c *= (1.0 + uVigStrength * smoothstep(0.45, 1.0, dist));
  }

  // Grain (per pixel, monochrome) — vUv*resolution gives top-down pixel coords
  // matching the bake's loop indices (vUv already flips V so row 0 = image top).
  if (uHasGrain) {
    vec2 pix = vUv * uResolution;
    c += vec3(uGrainAmount * valueNoise(floor(pix.x), floor(pix.y), uGrainCell));
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}`;

/**
 * A minimal WebGL2 image-color renderer: one textured quad, the shared color
 * model applied in a fragment shader. Framework-free — `<AdjustedImage>` drives it.
 * Renders the image at its natural resolution; CSS scales the canvas like an <img>.
 */
export class GlColor {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private imageTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null>;
  private lutData = new Uint8Array(256 * 3);
  width = 0;
  height = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.program = createProgram(gl, VERT, FRAG);

    // Full-screen quad (two triangles).
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;

    this.imageTex = createTexture(gl);
    this.lutTex = createTexture(gl);

    gl.useProgram(this.program);
    this.uniforms = {
      uImage: gl.getUniformLocation(this.program, "uImage"),
      uLut: gl.getUniformLocation(this.program, "uLut"),
      uHasLinear: gl.getUniformLocation(this.program, "uHasLinear"),
      uLinear: gl.getUniformLocation(this.program, "uLinear"),
      uHasChroma: gl.getUniformLocation(this.program, "uHasChroma"),
      uHue: gl.getUniformLocation(this.program, "uHue"),
      uSatF: gl.getUniformLocation(this.program, "uSatF"),
      uVib: gl.getUniformLocation(this.program, "uVib"),
      uVigStrength: gl.getUniformLocation(this.program, "uVigStrength"),
      uResolution: gl.getUniformLocation(this.program, "uResolution"),
      uHasDetail: gl.getUniformLocation(this.program, "uHasDetail"),
      uSharpen: gl.getUniformLocation(this.program, "uSharpen"),
      uMask: gl.getUniformLocation(this.program, "uMask"),
      uNr: gl.getUniformLocation(this.program, "uNr"),
      uHasGrain: gl.getUniformLocation(this.program, "uHasGrain"),
      uGrainAmount: gl.getUniformLocation(this.program, "uGrainAmount"),
      uGrainCell: gl.getUniformLocation(this.program, "uGrainCell"),
    };
    gl.uniform1i(this.uniforms.uImage!, 0);
    gl.uniform1i(this.uniforms.uLut!, 1);
  }

  /** Upload a decoded image and size the canvas to its natural resolution. */
  setImage(source: TexImageSource & { width?: number; height?: number }): void {
    const gl = this.gl;
    const w = (source as { naturalWidth?: number }).naturalWidth ?? source.width ?? 0;
    const h = (source as { naturalHeight?: number }).naturalHeight ?? source.height ?? 0;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  /** Re-render with the given color model. Cheap — call on every slider change. */
  render(model: GlColorModel): void {
    const gl = this.gl;
    if (this.width === 0 || this.height === 0) return;
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Tone LUT → 256x1 RGB texture.
    this.fillLut(model.tone);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 256, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, this.lutData);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);

    const lin = model.linear;
    gl.uniform1i(this.uniforms.uHasLinear!, lin ? 1 : 0);
    // `m` is column-major; uploaded transpose=false. IDENTITY3 when absent (unused).
    gl.uniformMatrix3fv(this.uniforms.uLinear!, false, lin ? lin.m : IDENTITY3);

    const ch = model.chroma;
    gl.uniform1i(this.uniforms.uHasChroma!, ch ? 1 : 0);
    gl.uniform1f(this.uniforms.uHue!, ch?.hue ?? 0);
    gl.uniform1f(this.uniforms.uSatF!, ch?.satF ?? 1);
    gl.uniform1f(this.uniforms.uVib!, ch?.vib ?? 0);
    gl.uniform1f(this.uniforms.uVigStrength!, model.vignette?.strength ?? 0);

    gl.uniform2f(this.uniforms.uResolution!, this.width, this.height);
    const d = model.detail;
    gl.uniform1i(this.uniforms.uHasDetail!, d ? 1 : 0);
    gl.uniform1f(this.uniforms.uSharpen!, d?.sharpen ?? 0);
    gl.uniform1f(this.uniforms.uMask!, d?.mask ?? 0);
    gl.uniform1f(this.uniforms.uNr!, d?.nr ?? 0);
    const gr = model.grain;
    gl.uniform1i(this.uniforms.uHasGrain!, gr ? 1 : 0);
    gl.uniform1f(this.uniforms.uGrainAmount!, gr?.amount ?? 0);
    gl.uniform1f(this.uniforms.uGrainCell!, gr?.cell ?? 1);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Build the 256×1 RGB LUT bytes from the (possibly null/longer) tone LUT. */
  private fillLut(tone: ToneLut | null): void {
    const d = this.lutData;
    for (let i = 0; i < 256; i++) {
      const x = i / 255;
      d[i * 3] = tone ? sample(tone.r, x) : i;
      d[i * 3 + 1] = tone ? sample(tone.g, x) : i;
      d[i * 3 + 2] = tone ? sample(tone.b, x) : i;
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.imageTex);
    gl.deleteTexture(this.lutTex);
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** Interpolated lookup of a [0,1]→[0,1] table at x∈[0,1], scaled to a 0..255 byte. */
function sample(lut: Float32Array, x: number): number {
  const n = lut.length;
  const fx = Math.min(1, Math.max(0, x)) * (n - 1);
  const i = Math.floor(fx);
  const a = lut[i]!;
  const b = i + 1 < n ? lut[i + 1]! : a;
  const v = a + (b - a) * (fx - i);
  return Math.max(0, Math.min(255, Math.round(v * 255)));
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

function createProgram(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram()!;
  const vs = compileShader(gl, gl.VERTEX_SHADER, vert);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`GL program link failed: ${log ?? "unknown"}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`GL shader compile failed: ${log ?? "unknown"}`);
  }
  return shader;
}
