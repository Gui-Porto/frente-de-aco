# Frente de Aço

Jogo de combate de armas combinadas da Segunda Guerra (tanques + aviões) no navegador, estilo War Thunder, "arcade mas realista". UI e textos em português do Brasil.

## Comandos

- `npm run dev` — servidor de desenvolvimento (Vite) em http://localhost:5173
- `npm run build` — build de produção em `dist/` (alvo `esnext`: usa top-level await)
- `npm run preview` — serve o `dist/`
- `npm test` — testes unitários (Vitest) em `tests/`

## Fluxo de trabalho (gitflow)

- `main`: só versões lançadas (tag `vX.Y.Z`). Nunca commitar direto.
- `develop`: integração. Trabalho novo em `feature/<nome>` (ou `fix/<nome>`) saindo de `develop`, merge `--no-ff` de volta.
- `release/<versão>` e `hotfix/<nome>` conforme gitflow. Commits convencionais (`feat:`, `fix:`, `refactor:`, `chore:`…).

## Arquitetura (`src/`)

Módulos ES; o estado mutável compartilhado fica em `core/state.js` (`S`, `tanks`, `planes`, `projs`, `popped`) porque imports não podem ser reatribuídos. Dependências circulares existem e são aceitáveis desde que usadas só em tempo de execução, nunca no topo do módulo.

| Pasta | Conteúdo |
|---|---|
| `main.js` | inicializa o Rapier (WASM) e só então importa `game/loop.js` |
| `core/` | `render.js` (Three, céu Preetham, IBL, sombras, pós-processamento GTAO/bloom/SMAA, presets de qualidade), `settings.js` (ações/teclas no padrão WT, persistência em `localStorage` `fda.settings.v1`), `state.js`, `util.js` |
| `world/` | `terrain.js` (altura analítica `H(x,z)` usada pela física, malhas com shader de camadas, mapa de altura em textura), `scenery.js` (construções, cercas vivas, árvores, grama instanciada na GPU, colisores), `physics.js` (mundo Rapier, heightfield, grupos de colisão) |
| `data/vehicles.js` | dados históricos aproximados dos veículos, munições e tabelas balísticas |
| `vehicles/` | `tank.js` (corpo rígido Rapier + forças próprias de suspensão/tração por contato, câmbio, dano por componente, reparo), `plane.js` (modelo de voo 6DOF próprio, instrutor "mouse aim"), `planeModel.js` (modelo 3D procedural: asas/empenagem com perfil NACA, fuselagem torneada), `paint.js` (camuflagem e insígnias procedurais) |
| `combat/ballistics.js` | projéteis com arrasto, blindagem inclinada/normalização/ricochete, pós-penetração, explosivos (HE/bombas), destroços como corpos Rapier |
| `ai/brains.js` | IA de tanque, antiaéreo e avião (usa a mesma física do jogador) |
| `ui/` | HUD (silhueta de estado, retículos, assistências), raio-X, minimapa, menus (hangar, spawn com SP, pausa, configurações, fim) |
| `air/` | Batalha Aérea (modo separado, `S.mode === 'air'`, estado de menu `airmenu`): `battle.js` (BattleManager, arena por era, controles de radar/míssil), `missions.js`, `ai.js` (FighterBrain: usa o próprio radar e só reage a míssil que percebe), `targeting.js` (buscador IR/PN/avanço, puro), `missiles.js` (IR e semiativo), `input.js`, `camera.js`, `hud.js` (orquestra `hud/`), `hangar.js`, `environment.js`, `screens.js`, `sound.js` (áudio por perfil de motor/RWR) |
| `air/systems/` | Sistemas da aeronave, puros e testados: `engine.js` (ENGINES + EngineSet: spool não linear, pós-combustão, TSFC), `atmosphere.js` (ISA), `avionics.js` (catálogo RADARS/RWRS/MAWS), `radar.js` (varredura/STT/ACM/telemétrico), `rwr.js` (RWR + MAW) |
| `air/hud/` | `kit.js` (canvas/primitivas), `themes.js` (ww2/nato/sov), `flight.js` (painel inf. dir.), `scopes.js` (radar B-scope + RWR inf. esq., mapa tático), `warnings.js` (alertas só por sistema) |
| `game/` | `loop.js` (física em passo fixo 1/120 s), `match.js` (tickets, captura, SP, respawn), `controls.js`, `camera.js` |

## Física — decisões importantes

- Tanques: o Rapier integra o corpo e resolve colisões; suspensão e tração são forças nossas aplicadas a cada passo, com a **normal local do terreno em cada contato** e trecho inclinado da esteira (ângulo de ataque). O motor sempre empurra no sentido comandado (corrige o bug de travar em rampa). Todos os tanques sobem 30°.
- Aviões: integração própria; a lei de controle do instrutor (arfagem pelo vetor velocidade + trim; rolagem/leme da v2) foi validada por teste de voo nivelado. Mudanças nos ganhos de rolagem/leme já causaram oscilação — revalide com voo nivelado/curva ao mexer.
- Terreno de teste falso: a normal de `h = (−10 − z)·tanθ` é `(0, 1, +tanθ)`. Um sinal trocado já gerou conclusões erradas.

## Testes manuais

`window.__game` expõe `S`, `simulate(dt)`, `spawnVehicle`, etc. para rodar partidas aceleradas sem renderizar (Playwright). Em navegador sem GPU use qualidade "baixa" (`localStorage fda.settings.v1 = {graphics:{quality:'baixa'}}`).

## Aeronaves — como adicionar uma

Tudo por dados, sem `if (key === …)`: entrada em `PLANES` (`data/vehicles.js`: aerodinâmica, `engine`/`engines`, `radar`/`rwr`/`maw`, `missiles: [{w, n}]`, `wave`, `inertia`/`damp`/`flapV` opcionais, `hud`, `model`) + ficha em `air/aircraft.js` (`era` define arena/adversários). Motor novo → `ENGINES`; sistema novo → `avionics.js`. HUD e áudio só mostram/tocam o que a aeronave tem. Modelo comprado: `def.model = { url }` com nós `wingL/wingR/tail/prop/hp_N` (+ opcionais `ailL/ailR/flapL/flapR/elevL/elevR/rud`) (`vehicles/modelLibrary.js`); sem ele, procedural.

**Peças/dano por aeronave** (`vehicles/planeDamage.js`): piloto, motor(es), armas/munição (por grupo e lado, tiradas de `guns`), radar, aileron/flap/profundor/leme saem sozinhos — nas mesmas posições do modelo (`vehicles/planeGeom.js`). O que é específico do avião real vai em `def.parts`: tanques (`k:'fuel'`, combustível fica em cada tanque e o furo esvazia só o seu), radiador (`cool`), turbo, e sistemas `k:'act'` com `does: ['flaps'|'brake'|'guns'|'ctl']` (hidráulico/pneumático/elétrico; sem nenhum vivo, aquilo trava). Peça de asa: `w: [s, cf]` (sai em par). Outros campos: `stab: 'all'` (estabilizador todo móvel), `boost: { ch, manual }` (comandos com servo), `ail`/`flap` (trecho da envergadura). Superfície destruída trava na deflexão em que estava; flap travado baixado acima do limite é arrancado.

## Renderização — decisões importantes

- **Sem bloom**: o céu Preetham tem brilho HDR muito acima de 1; o UnrealBloom deixava a tela leitosa ("neblina estourada"). Se reativar, teste isolando passes.
- **Partículas instanciadas** (`fx/particles.js`): 1 draw call por modo de mistura e um único `ShaderMaterial`. Sprites individuais custavam um draw call cada e compilavam shader novo no primeiro abate (travada). Fumaça sempre em tons claros/médios — nunca quase-preto, que vira "sombra".
- **Shaders pré-compilados** no carregamento (`renderer.compile`): nenhum material novo deve aparecer só durante a partida. Ao criar material novo, garanta que exista na cena antes do compile ou reutilize um existente. Teste: `renderer.info.programs.length` não pode crescer ao destruir um veículo.
