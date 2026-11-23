import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { settings, QUALITY, onSettings } from './settings.js';
import { $, clamp, lerp } from './util.js';

export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.domElement.className = 'gl';
$('#app').prepend(renderer.domElement);

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 30000);
export const FOGC = new THREE.Color(0xb4c2cf);
scene.fog = new THREE.FogExp2(FOGC, 0.00075);
scene.background = FOGC.clone();

// ---------- Céu físico (Preetham) e sol ----------
export const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(145));
export const sky = new Sky();
sky.scale.setScalar(20000);
Object.assign(sky.material.uniforms.turbidity, { value: 4.2 });
sky.material.uniforms.rayleigh.value = 1.6;
sky.material.uniforms.mieCoefficient.value = 0.004;
sky.material.uniforms.mieDirectionalG.value = 0.82;
sky.material.uniforms.cloudCoverage.value = 0.42;
sky.material.uniforms.cloudDensity.value = 0.45;
sky.material.uniforms.sunPosition.value.copy(SUN_DIR);
scene.add(sky);

export const sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
sun.castShadow = true;
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
export const hemi = new THREE.HemisphereLight(0xcfdbe6, 0x4f4a36, 0.35);
scene.add(hemi);
export const flash = new THREE.PointLight(0xffb060, 0, 70, 2);
scene.add(flash);

// Iluminação baseada em imagem gerada a partir do próprio céu (reflexos no metal e pintura)
export const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene(), envSky = new Sky(); envSky.scale.setScalar(1000); envScene.add(envSky);
let envRT = null;
// refeito quando o horário/clima muda (Batalha Aérea)
export function refreshEnvMap() {
  for (const k in sky.material.uniforms) envSky.material.uniforms[k].value = sky.material.uniforms[k].value;
  envSky.material.uniforms.showSunDisc.value = 0;
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0, 0.1, 2000);
  scene.environment = envRT.texture;
}
refreshEnvMap();
scene.environmentIntensity = 0.12;
export const env = { fogMul: 1 };

// ---------- Pós-processamento ----------
export const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
let activeScene = scene;
// troca a cena desenhada (o hangar da Batalha Aérea tem cena própria)
export function setScene(s) { activeScene = s; renderPass.scene = s; if (gtao) gtao.scene = s; }
let gtao = null, bloom = null, aa = null;
// objetos que só existem para projetar sombra (casco simples dos tanques com modelo glTF): somem no passe de normais do GTAO
export const shadowOnly = new Set();
const output = new OutputPass();
let shadowSize = 0;
export let Q = QUALITY[settings.graphics.quality] || QUALITY.alta;
export function applyQuality() {
  Q = QUALITY[settings.graphics.quality] || QUALITY.alta;
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
  renderer.setSize(innerWidth, innerHeight);
  if (shadowSize !== Q.shadow) {
    shadowSize = Q.shadow;
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  const sc = sun.shadow.camera, ext = 90;
  Object.assign(sc, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 900 }); sc.updateProjectionMatrix();
  composer.passes.length = 0;
  composer.addPass(renderPass);
  const w = innerWidth * renderer.getPixelRatio(), h = innerHeight * renderer.getPixelRatio();
  if (Q.ao) {
    if (!gtao) { gtao = new GTAOPass(activeScene, camera, w, h); gtao.blendIntensity = 0.85;
      const rnd = gtao.render.bind(gtao); gtao.render = (...x) => { for (const o of shadowOnly) o.visible = false; rnd(...x); for (const o of shadowOnly) o.visible = true; }; gtao.updateGtaoMaterial({ radius: 0.6, distanceFallOff: 1, thickness: 1 });
      // o passe de normais/profundidade do GTAO desenha TUDO com material opaco: fumaça, rastro de míssil, chama e marcas
      // (transparentes, sem escrita de profundidade) entravam como chapa sólida e a oclusão pintava uma laje PRETA em cima
      // delas (o rastro do míssil "ficou preto"). Ficam fora desse passe, como já ficavam pontos e linhas.
      gtao._overrideVisibility = function () { const cache = this._visibilityCache; this.scene.traverse(o => { if (!o.visible) return; const m = o.material; if (o.isPoints || o.isLine || o.isLine2 || ((o.isMesh || o.isSprite) && m && !Array.isArray(m) && m.depthWrite === false)) { o.visible = false; cache.push(o); } }); }; }
    composer.addPass(gtao);
  }
  if (Q.bloom) { if (!bloom) bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.35, 4.0); composer.addPass(bloom); }
  composer.addPass(output);
  aa = Q.aa === 'smaa' ? new SMAAPass() : new FXAAPass();
  composer.addPass(aa);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
}
applyQuality();
onSettings(applyQuality);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

export function flashAt(pos, inten, S) { flash.position.copy(pos); flash.intensity = inten * 40; S.flashT = 0.08; }

// Sombra e neblina seguem a câmera/veículo; neblina fica mais rala em altitude
export function frameLighting(focus, camY, groundY, S, dt) {
  sun.position.copy(focus).addScaledVector(SUN_DIR, 400);
  sun.target.position.copy(focus);
  const agl = camY - groundY;
  scene.fog.density = lerp(0.00042, 0.00006, clamp(agl / 700, 0, 1)) / Q.far * env.fogMul; // ~4 km de visibilidade no chão, serras à vista em altitude (era um paredão cinza a 2,5 km)
  sky.position.copy(camera.position);
  sky.material.uniforms.time.value += dt;
  if (S.flashT > 0) { S.flashT -= dt; if (S.flashT <= 0) flash.intensity = 0; }
}
// flush explícito a cada quadro: sem ele o Chrome/ANGLE (D3D11) acumulava comandos e a cada ~4,6 s
// travava 200–550 ms num flush do compositor (medido com trace; a GPU em si gasta ~1,5 ms por quadro)
const glCtx = renderer.getContext();
export const afterRender = []; // desenhos por cima do quadro pronto (hit-cam 3D): f() usa o renderer direto na tela
export function renderFrame() { composer.render(); for (const f of afterRender) f(); glCtx.flush(); }
// Brilho do quadro PRONTO em até dois pontos da tela (a HUD escreve x/y em px de CSS e lê v, 0..1): a mira branca sumia
// sobre céu estourado/névoa clara, então ela escurece quando o fundo atrás dela é claro. Leitura sem travar o quadro:
// readPixels para um PBO a cada 3 quadros e o resultado é colhido quando a GPU sinaliza (fence) — glReadPixels direto
// pararia o pipeline todo quadro.
export const screenLum = { x: [0, 0], y: [0, 0], v: [0.3, 0.3] };
{
  const gl = glCtx, N = 5, buf = new Uint8Array(2 * N * N * 4); let pbo = null, sync = null, fN = 0;
  if (gl.fenceSync) afterRender.push(() => {
    if (sync) {
      const st = gl.clientWaitSync(sync, 0, 0); if (st === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(sync); sync = null;
      if (st !== gl.WAIT_FAILED) {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        for (let k = 0; k < 2; k++) { let s = 0; for (let i = 0; i < N * N; i++) { const o = (k * N * N + i) * 4; s += 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2]; } screenLum.v[k] = s / (N * N * 255); }
      }
    }
    if (++fN % 3) return;
    renderer.setRenderTarget(null);
    if (!pbo) { pbo = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, buf.byteLength, gl.STREAM_READ); } else gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    const pr = renderer.getPixelRatio(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, h = N >> 1;
    for (let k = 0; k < 2; k++) gl.readPixels(clamp(Math.round(screenLum.x[k] * pr) - h, 0, W - N), clamp(H - Math.round(screenLum.y[k] * pr) - h, 0, H - N), N, N, gl.RGBA, gl.UNSIGNED_BYTE, k * N * N * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  });
}
