# Frente de Aço

Combate de armas combinadas da Segunda Guerra (e jatos da Guerra Fria) no navegador: tanques e aviões, com física e balística realistas e jogabilidade arcade, no estilo do War Thunder. Interface em português do Brasil.

## Rodar

Requer **Node.js 22+** (desenvolvido com o 24) e Git.

```bash
git clone https://github.com/Gui-Porto/frente-de-aco.git
cd frente-de-aco
npm install
npm run dev      # http://localhost:5173
npm test         # testes unitários (Vitest)
npm run build    # gera dist/ (alvo esnext)
```

Para continuar um trabalho em andamento, troque para a branch dele antes do `npm install` (ex.: `git checkout feature/air-overhaul`).

## Modos

- **Armas combinadas** (Normandia, 1944): tanques e aviões no mesmo mapa, captura de pontos, tickets e pontos de spawn (SP).
- **Batalha Aérea**: duelo, combate em equipes, superioridade aérea, interceptação e sobrevivência. Começa no chão, na cabeceira da sua pista; pouse na própria pista para reparar e rearmar.

## Destaques

- **Tanques**: M4A3 (76) W, T-34-85, Pz.Kpfw. IV H, Tiger H1 e o antiaéreo Wirbelwind. Corpo rígido (Rapier) com suspensão por roda, tração por lagarta, câmbio com RPM, reparo.
- **Aviões a hélice**: Spitfire, P-47D, Il-2, Fw 190 — modelo de voo 6DOF próprio (sustentação, arrasto, estol, compressibilidade, G e blecaute), WEP, bombas e foguetes.
- **Jatos**: F-86F Sabre, MiG-15bis, MiG-21MF e F-4E Phantom II — turbojato com aceleração não linear, pós-combustão ou WEP, radar (busca/rastreio/telemétrico), RWR, alerta de míssil (MAW), mísseis IR e semiativos, contramedidas, freio aerodinâmico com painéis animados, canhões modelados.
- **Dano por componente** (aviões): piloto, motores, tanques de combustível (vazamento e incêndio), radiador/óleo, hidráulicos, superfícies de comando que travam ou são arrancadas, armas e munição, radar; asas e cauda se soltam como destroços físicos; furos de bala onde o tiro entrou.
- **Munição por cinta** (estilo WT): escolha por arma no cartão da aeronave — perfurante, incendiária, explosiva, traçante.
- **Pouso e base**: trem de pouso animado, pouso manual, reparo e rearme parado na própria pista.
- **Balística**: arrasto, queda, perfuração por velocidade, chapa inclinada, normalização, ricochete, estilhaços e câmera de impacto em raio-X.

## Controles padrão (padrão War Thunder, tudo remapeável em Configurações)

| Tanque | | Avião | |
|---|---|---|---|
| W A S D | dirigir | mouse | aponta o avião (mira do instrutor) |
| Botão esq. | canhão | Shift / Ctrl | potência (segure Shift em 100% = WEP / pós-combustão) |
| Espaço | metralhadora | W / S · A / D · Q / E | arfagem · rolagem · leme (controle direto) |
| Shift | mira do atirador | Botão esq. · Espaço | armas · míssil |
| Botão dir. | zoom | Botão do meio (scroll) | marcar o alvo na mira |
| 1 2 3 | munição | Caps Lock · N | radar: travar · trocar modo |
| F · 6 | reparar · extintor | Z · X | trocar míssil · contramedidas |
| E / Q | controle de cruzeiro | G · F · H | trem · flaps · freio (liga/desliga) |
| | | V · C · K | câmera · olhar livre · extintor |

Tab placar, M mapa, Esc menu.

## Desenvolvimento

- Arquitetura, decisões de física/renderização e como adicionar aeronaves: veja [`CLAUDE.md`](CLAUDE.md).
- Fluxo **gitflow**: `main` só versões lançadas (tags `vX.Y.Z`), `develop` integração, trabalho novo em `feature/<nome>` ou `fix/<nome>` saindo de `develop` e voltando por PR. Commits convencionais (`feat:`, `fix:`, `refactor:`, `chore:`).
- Testes manuais acelerados: `window.__game` expõe `S`, `B`, `simulate(dt)` etc. para rodar partidas sem renderizar (Playwright). Em navegador sem GPU use qualidade "baixa".
- Créditos de áudio em [`CREDITOS.md`](CREDITOS.md).
