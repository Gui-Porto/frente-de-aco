# Backlog — pedidos do jogador

Lista viva dos pedidos, na ordem em que serão feitos. Cada item vira uma branch (`feature/…` ou `fix/…`) com commits e um PR para revisão. Ao concluir, o item sai daqui e vai para a descrição do PR.

## Retomada (trabalho autônomo)

Feito em 2026-11-17 e integrado em `develop`: M1 Abrams, jatos de ataque na era Moderna, estradas, minimapa orientado, distância na mira, revisão da HUD por captura, medição de desempenho (sem regressão) e a autocrítica em `docs/AVALIACAO.md`. Não foram entregues pelos agentes: P-47 com modelo real (segue na lista abaixo).

Pendente:

1. Antiaérea com modelo real — **aguardando o dono autorizar o download**: "FlakPanzer IV Wirbelwind" de Prak (Sketchfab `0995d38d4b1f4648b5c1bc1384f4eeaf`, CC BY, 42,9 mil faces; página conferida em 2026-11-17, descrição sem indício de extração de jogo). Era Moderna: Gepard de xFORTUNAx `67815bf4efae4f3da979dbb3696daf85` (23,9 mil triângulos, feito do zero no Blender, peças separadas — preferido) ou Tunguska de usedm `54ff4d655755473d99eab1ccc7eb6bfc`. Baixar pelo Chrome logado, preparar com `tools/blender/prep.py`.
2. Próximos passos sugeridos pela avaliação: texturas/adereços do mapa, tripulação por veículo (`def.crew`), HEAT.

## Em andamento / próximos

- **Jatos mais bonitos (modelos glTF prontos)**: escolher/comprar modelos (Sketchfab/CGTrader) de F-86, MiG-15, F-4E e MiG-21 com licença que permita uso no jogo; preparar os nós `wingL/wingR/tail/prop/hp_N` (+ superfícies) e ligar por `def.model = { url }`. Depende do jogador escolher os modelos.

- **Fatia vertical (branch `feature/fatia-vertical`)** — feito: Tiger glTF com torre/canhão/rodas/esteira, direção, mira do atirador presa ao canhão, hit-cam e painel de estado em raio-X 3D, som do motor/canhão, destruição com cozimento. Falta:
  - **T-34-85 com modelo real**: o gratuito baixável (Hsu.Pei.Ge) tem só casco/torre texturizados e 170 mil triângulos de detalhe sem textura — fica abaixo do Tiger. Melhor candidato exige login no Sketchfab: https://sketchfab.com/3d-models/58d1ec1a786f4065a504da5ccf6fc7b5 (Federico.Oviedo, CC-BY).
  - **P-47 com modelo real**: o P-47D-22 de vachtar (CC-BY) precisa converter material spec-gloss (gltf-transform ou Blender — execução por `npx` foi negada).
  - **Comprimir `public/models/tiger.glb`** (23 MB): `npx @gltf-transform/cli optimize ... --compress meshopt --texture-compress webp` (e ligar o MeshoptDecoder no loader).
  - Motores dos outros tanques audíveis (hoje só o do jogador), insígnias/camuflagem sobre o glTF, blindagem do raio-X (tecla) no modelo real.

- **Elenco por era com modelos reais** (decisão do dono, 2026-11-16): poucos veículos, todos com modelo glTF, antigos e modernos, mais antiaérea. Feito: Tiger H1, T-34-85. Candidatos já triados no Sketchfab (CC-BY salvo indicação; baixar pelo Chrome logado "SUPERVISOR_MONI"):
  - M1 Abrams: Artem.Goyko `2577a4eccbc74b2da6dba5bfd09b7511` (40 mil faces; torre precisa ser separada) · reserva Fri13Day `34fcc7e772724a1c810652171f1c506d`.
  - T-72M1: DustyMojito `e5c1edee1c27446c874bde41fa8c7911` (155 mil faces, o melhor da triagem) · alternativa Leopard 2A6 buh-late `7cb23d5322df4b409a880de635826067`.
  - P-47D: vachtar `3ff78eecd09d4398b6b1eef882c688a5` (razorback, peças separadas) · bolha: saramolina `611e018fb844431696d85c8961831f99`.
  - MiG-21bis: xFORTUNAx `9b12f069c3654c6faa6c567fead7be08` · reserva kyu190a `3cddfda0447a46f48a1f54c04de5a853`.
  - Fw 190 e F-4: sem candidato texturizado de origem clara; só os CC0 de mgg8 ("feitos no Blender com assistência de IA") — decisão do dono.
  - Rejeitar autores com rips de jogo: KojfDiscord, 42manako, MirzaArrafiERV_45, Jeyhun1985, manbs999, scout., s9pata, fuzion_z3, manilov.ap.
  - Tanque moderno exige regras novas: estabilizador, APFSDS, blindagem composta, telêmetro.
- **Era Moderna** (menu → Era): hoje só o T-72M1 dos dois lados. Falta o M1 Abrams (arquivo baixado, `m1_abrams.glb` de Artem.Goyko: malha única e em escala minúscula — precisa de separação por ilhas como o T-34), HEAT, telêmetro a laser, tripulação de 3 (o jogo assume 5) e aviões modernos na batalha de tanques.
- **Wirbelwind (antiaérea)** segue procedural; precisa de modelo.

## Pendências menores

Nenhuma no momento.
