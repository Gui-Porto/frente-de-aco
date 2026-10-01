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
export const FOGC = new THREE.Color(0xb7c2c6);
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
const pmrem = new THREE.PMREMGenerator(renderer);
{
  const envScene = new THREE.Scene();
  const s2 = new Sky(); s2.scale.setScalar(1000);
  for (const k in sky.material.uniforms) s2.material.uniforms[k].value = sky.material.uniforms[k].value;
  s2.material.uniforms.showSunDisc.value = 0;
  envScene.add(s2);
  scene.environment = pmrem.fromScene(envScene, 0, 0.1, 2000).texture;
  scene.environmentIntensity = 0.12;
}

// ---------- Pós-processamento ----------
export const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
let gtao = null, bloom = null, aa = null;
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
    if (!gtao) { gtao = new GTAOPass(scene, camera, w, h); gtao.blendIntensity = 0.85; gtao.updateGtaoMaterial({ radius: 0.6, distanceFallOff: 1, thickness: 1 }); }
    composer.addPass(gtao);
  }
  if (Q.bloom) { if (!bloom) bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.5, 0.92); composer.addPass(bloom); }
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
  scene.fog.density = lerp(0.00075, 0.00018, clamp(agl / 700, 0, 1)) / Q.far;
  sky.position.copy(camera.position);
  sky.material.uniforms.time.value += dt;
  if (S.flashT > 0) { S.flashT -= dt; if (S.flashT <= 0) flash.intensity = 0; }
}
export function renderFrame() { composer.render(); }
