# Backlog — pedidos do jogador

Lista viva dos pedidos, na ordem em que serão feitos. Cada item vira uma branch (`feature/…` ou `fix/…`) com commits e um PR para revisão. Ao concluir, o item sai daqui e vai para a descrição do PR.

## Em andamento / próximos

- **Jatos mais bonitos (modelos glTF prontos)**: escolher/comprar modelos (Sketchfab/CGTrader) de F-86, MiG-15, F-4E e MiG-21 com licença que permita uso no jogo; preparar os nós `wingL/wingR/tail/prop/hp_N` (+ superfícies) e ligar por `def.model = { url }`. Depende do jogador escolher os modelos.

- **Modelos sem buracos (fix/modelos-pecas, 2026-10-05)**: nenhum avião pode ser visto por dentro.
  - Todos: traseira "invisível e desconectada" (cone de cauda vira agulha antes da empenagem; F-4E sem cauda sob o estabilizador).
  - F-86: cabine incompleta, canos para dentro, bocal vazado. Spitfire: radiador sobre o alojamento do trem, placa da perna estranha.
  - P-47: armas pobres, porta do trem cobre os foguetes. Fw 190: porta do trem entra na bomba.
  - MiG-15: fendas do flap, placa na boca, traseira. F-4E: mísseis sem suporte, entradas laterais vazadas, frente da cabine vazada.
  - MiG-21: frente da cabine vazada, porta do trem na bomba, "asa sobre a asa" cobrindo a insígnia.
  - Melhorar modelo de todos os canhões e mísseis; rastro de cada míssil; efeito supersônico; míssil que às vezes fica distorcido no ar.
- **Decolagem dos pistão fora da pista**: a IA/jogador a pistão começa no meio do nada; tem de começar na pista.
- **Mapa / sensação de chão**: "parece que eu nunca encosto no chão" — melhorar o terreno perto do solo (escala, detalhe, referência de altura).

## Pendências menores

Nenhuma no momento.
