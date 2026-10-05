# Backlog — pedidos do jogador

Lista viva dos pedidos, na ordem em que serão feitos. Cada item vira uma branch (`feature/…` ou `fix/…`) com commits e um PR para revisão. Ao concluir, o item sai daqui e vai para a descrição do PR.

## Em andamento / próximos

- **Jatos mais bonitos (modelos glTF prontos)**: escolher/comprar modelos (Sketchfab/CGTrader) de F-86, MiG-15, F-4E e MiG-21 com licença que permita uso no jogo; preparar os nós `wingL/wingR/tail/prop/hp_N` (+ superfícies) e ligar por `def.model = { url }`. Depende do jogador escolher os modelos.

- **App nativo × navegador**: análise feita no PR de fix/modelos-pecas — por ora não compensa (mesmo motor de render e mesmo JS); antes, medir onde travam as partidas grandes (física/IA por avião, GC) e levar física/IA para um Web Worker.
- **Cabines**: segue em refino a pedido (capuz do painel já corrigido); próximos: painel lateral e consoles mais ricos nos jatos.

## Pendências menores

Nenhuma no momento.
