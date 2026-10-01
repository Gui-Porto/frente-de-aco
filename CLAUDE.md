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
| `vehicles/` | `tank.js` (corpo rígido Rapier + forças próprias de suspensão/tração por contato, câmbio, dano por componente, reparo), `plane.js` (modelo de voo 6DOF próprio, instrutor "mouse aim"), `paint.js` (camuflagem e insígnias procedurais) |
| `combat/ballistics.js` | projéteis com arrasto, blindagem inclinada/normalização/ricochete, pós-penetração, explosivos (HE/bombas), destroços como corpos Rapier |
| `ai/brains.js` | IA de tanque, antiaéreo e avião (usa a mesma física do jogador) |
| `ui/` | HUD (silhueta de estado, retículos, assistências), raio-X, minimapa, menus (hangar, spawn com SP, pausa, configurações, fim) |
| `game/` | `loop.js` (física em passo fixo 1/120 s), `match.js` (tickets, captura, SP, respawn), `controls.js`, `camera.js` |

## Física — decisões importantes

- Tanques: o Rapier integra o corpo e resolve colisões; suspensão e tração são forças nossas aplicadas a cada passo, com a **normal local do terreno em cada contato** e trecho inclinado da esteira (ângulo de ataque). O motor sempre empurra no sentido comandado (corrige o bug de travar em rampa). Todos os tanques sobem 30°.
- Aviões: integração própria; a lei de controle do instrutor (arfagem pelo vetor velocidade + trim; rolagem/leme da v2) foi validada por teste de voo nivelado. Mudanças nos ganhos de rolagem/leme já causaram oscilação — revalide com voo nivelado/curva ao mexer.
- Terreno de teste falso: a normal de `h = (−10 − z)·tanθ` é `(0, 1, +tanθ)`. Um sinal trocado já gerou conclusões erradas.

## Testes manuais

`window.__game` expõe `S`, `simulate(dt)`, `spawnVehicle`, etc. para rodar partidas aceleradas sem renderizar (Playwright). Em navegador sem GPU use qualidade "baixa" (`localStorage fda.settings.v1 = {graphics:{quality:'baixa'}}`).
