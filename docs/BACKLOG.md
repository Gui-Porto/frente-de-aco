# Backlog — pedidos do jogador

Lista viva dos pedidos, na ordem em que serão feitos. Cada item vira uma branch (`feature/…` ou `fix/…`) com commits e um PR para revisão. Ao concluir, o item sai daqui e vai para a descrição do PR.

## Em andamento / próximos

- **Jatos mais bonitos (modelos glTF prontos)**: escolher/comprar modelos (Sketchfab/CGTrader) de F-86, MiG-15, F-4E e MiG-21 com licença que permita uso no jogo; preparar os nós `wingL/wingR/tail/prop/hp_N` (+ superfícies) e ligar por `def.model = { url }`. Depende do jogador escolher os modelos.

- **Fatia vertical (branch `feature/fatia-vertical`)** — feito: Tiger glTF com torre/canhão/rodas/esteira, direção, mira do atirador presa ao canhão, hit-cam e painel de estado em raio-X 3D, som do motor/canhão, destruição com cozimento. Falta:
  - **T-34-85 com modelo real**: o gratuito baixável (Hsu.Pei.Ge) tem só casco/torre texturizados e 170 mil triângulos de detalhe sem textura — fica abaixo do Tiger. Melhor candidato exige login no Sketchfab: https://sketchfab.com/3d-models/58d1ec1a786f4065a504da5ccf6fc7b5 (Federico.Oviedo, CC-BY).
  - **P-47 com modelo real**: o P-47D-22 de vachtar (CC-BY) precisa converter material spec-gloss (gltf-transform ou Blender — execução por `npx` foi negada).
  - **Comprimir `public/models/tiger.glb`** (23 MB): `npx @gltf-transform/cli optimize ... --compress meshopt --texture-compress webp` (e ligar o MeshoptDecoder no loader).
  - Motores dos outros tanques audíveis (hoje só o do jogador), insígnias/camuflagem sobre o glTF, blindagem do raio-X (tecla) no modelo real.

## Pendências menores

Nenhuma no momento.
