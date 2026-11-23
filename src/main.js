import './styles.css';
import './air/air.css';
import RAPIER from '@dimforge/rapier3d-compat';

// O Rapier é WebAssembly: inicializa antes de carregar os módulos que criam o mundo físico.
const status = document.querySelector('#boot');
try {
  await RAPIER.init();
  const [{ TANKS, PLANES }, { preloadTankModels }, { preloadModels }] = await Promise.all([import('./data/vehicles.js'), import('./vehicles/tankModel.js'), import('./vehicles/modelLibrary.js')]);
  await Promise.all([preloadTankModels(Object.values(TANKS)), preloadModels(Object.values(PLANES))]); // peles glTF das aeronaves (modelLibrary.js)
  await import('./game/loop.js');
  status?.remove();
} catch (e) {
  console.error(e);
  if (status) status.textContent = 'Não foi possível iniciar o jogo: ' + (e && e.message ? e.message : e);
}
