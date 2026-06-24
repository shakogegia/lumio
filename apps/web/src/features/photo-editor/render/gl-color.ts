import type { ChromaParams, ToneLut, VignetteParams } from "@lumio/shared";

/** The render inputs — exactly the artifacts the shared color model produces.
 *  The bake (`applyColorToRaw`) runs the identical math, so preview = save. */
export interface GlColorModel {
  /** Per-channel tone LUT (any length; uploaded as a 256-wide texture). null = identity. */
  tone: ToneLut | null;
  chroma: ChromaParams | null;
  vignette: VignetteParams | null;
}

export function isWebGL2Available(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
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
// tone LUT per channel → temperature/hue/saturation/vibrance → radial vignette.
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uImage;
uniform sampler2D uLut;     // 256x1 RGB: column i = [toneR[i], toneG[i], toneB[i]]
uniform bool uHasChroma;
uniform float uTempR;
uniform float uTempB;
uniform float uHue;         // degrees
uniform float uSatF;
uniform float uVib;
uniform float uVigStrength;

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
  vec3 c = src.rgb;

  // Tone: per-channel LUT lookup (linear filtering interpolates between entries,
  // matching the shared sampleLut lerp).
  c = vec3(
    texture(uLut, vec2(c.r, 0.5)).r,
    texture(uLut, vec2(c.g, 0.5)).g,
    texture(uLut, vec2(c.b, 0.5)).b
  );

  if (uHasChroma) {
    c.r *= uTempR;
    c.b *= uTempB;
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

  if (uVigStrength > 0.0) {
    float dist = length(vUv - 0.5) / 0.70710678;
    c *= (1.0 - uVigStrength * smoothstep(0.45, 1.0, dist));
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
      uHasChroma: gl.getUniformLocation(this.program, "uHasChroma"),
      uTempR: gl.getUniformLocation(this.program, "uTempR"),
      uTempB: gl.getUniformLocation(this.program, "uTempB"),
      uHue: gl.getUniformLocation(this.program, "uHue"),
      uSatF: gl.getUniformLocation(this.program, "uSatF"),
      uVib: gl.getUniformLocation(this.program, "uVib"),
      uVigStrength: gl.getUniformLocation(this.program, "uVigStrength"),
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

    const ch = model.chroma;
    gl.uniform1i(this.uniforms.uHasChroma!, ch ? 1 : 0);
    gl.uniform1f(this.uniforms.uTempR!, ch?.tempR ?? 1);
    gl.uniform1f(this.uniforms.uTempB!, ch?.tempB ?? 1);
    gl.uniform1f(this.uniforms.uHue!, ch?.hue ?? 0);
    gl.uniform1f(this.uniforms.uSatF!, ch?.satF ?? 1);
    gl.uniform1f(this.uniforms.uVib!, ch?.vib ?? 0);
    gl.uniform1f(this.uniforms.uVigStrength!, model.vignette?.strength ?? 0);

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
