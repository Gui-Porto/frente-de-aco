# Avaliação honesta — Frente de Aço × War Thunder

Escrita em 2026-11-17, na branch `feature/fatia-vertical`, olhando capturas de tela e medições de partidas aceleradas (não é impressão de memória). Régua: o War Thunder em batalha realista de solo. Notas de 0 a 10 onde 10 = "não dá para distinguir do WT nesse quesito".

## Resumo

O jogo já tem o **esqueleto certo** — balística com blindagem inclinada, dano por módulo e tripulação, raio-X, mira presa ao canhão, SP, eras — e isso é a parte difícil de projetar. O que mais afasta do WT hoje é **visual do mundo** (mapa de polígonos chapados, sem texturas de verdade), **elenco minúsculo** e **IA simples**. Os tanques com modelo real estão num nível bem acima do resto da cena, e esse contraste aparece em qualquer captura.

| Item | Nota | Uma linha |
|---|---|---|
| Modelos dos tanques | 6,5 | Tiger, T-34-85, T-72 e M1 são bons; esteira e rodas animam. Faltam LOD intermediário, camuflagem/insígnia própria e modelo de dano visível. |
| Modelos dos aviões | 4,5 | Procedurais: forma correta, detalhe de brinquedo. Ao lado de um glTF de tanque, destoam. |
| Física do tanque | 6 | Suspensão por contato, câmbio, sobe rampa. Falta inércia de torre/canhão no tranco, derrapagem lateral convincente e terreno que afunda. |
| Modelo de voo | 6,5 | 6DOF próprio, estol, G, trem como física. Jatos ainda balançam depois de curva forte no mouse. |
| Mira e balística | 7 | Queda, arrasto, telêmetro, indicador de penetração, luneta solidária ao canhão. Falta paralaxe da mira e retículo histórico por veículo. |
| Dano | 7 | Módulos, tripulação, cozimento de munição, hit-cam 3D. Blindagem composta é "equivalente em mm" (aproximação), sem HEAT/ERA. |
| Som | 4,5 | Tudo sintetizado: funciona, mas canhão e motor não têm o peso de gravação real. Outros tanques são mudos. |
| Mapa | 3,5 | Um mapa só. Estradas, vila, cercas e árvores existem, mas casas são caixas, árvores são cones, não há texturas, ruínas, rios nem relevo dentro do campo. |
| HUD | 6,5 | Painel de estado, munição, minimapa orientado, placar, feed. Falta bússola, marcadores de ponto na tela e mapa tático grande. |
| IA | 4 | Anda, atira, captura. Não usa cobertura, não angula o casco, não recua; avião de IA é previsível. |
| Conteúdo | 2 | 4 tanques, 1 antiaérea procedural, 5 aviões na batalha de solo, 1 mapa. O WT tem milhares; aqui o alvo é "poucos e bons". |
| Desempenho | 7 | ~210 chamadas e ~1,1 M de triângulos por quadro com 11 tanques juntos; simulação 3–4 ms por passo; nenhum shader compilado no meio da partida. |

## O que está bom de verdade

- **Laço de combate**: mirar, estimar alcance, escolher munição, ver o resultado no raio-X. É o coração do WT e funciona.
- **Tanques glTF com trem de rolamento animado** a partir de modelos CC BY, com script de preparo reprodutível por veículo.
- **Dano de aeronave por estrutura** (longarina, cone de cauda, superfícies arrancadas) — mais detalhado do que o necessário para o porte do projeto.
- **Robustez**: 86 testes unitários, partidas aceleradas sem erro nas duas eras, bancada de inspeção de modelos.

## O que está fraco

1. **O mundo parece protótipo.** Chão com cor por vértice e ruído, casas e árvores de baixa contagem de polígonos sem textura. É o que mais pesa na primeira impressão, e melhorar tanque não resolve.
2. **Aviões procedurais** ao lado de tanques fotográficos.
3. **Áudio sintetizado** — escolha do dono, mas é o quesito em que a distância para o WT é mais audível.
4. **IA de tanque** sem noção de cobertura ou de ângulo de blindagem; com o jogador parado, o time dele perde sempre (4 contra 5), sinal de que a IA não compensa nada.
5. **Era Moderna incompleta**: sem HEAT, sem fumígenos, sem térmica, tripulação do M1/T-72 modelada como 5 (são 4 e 3), sem antiaérea e sem mísseis ar-solo.

## O que falta (em ordem de retorno pelo esforço)

1. **Texturas e adereços do mapa** (casas, muros, árvores com folhagem em cartão alfa, chão com textura PBR) — maior salto visual por hora de trabalho.
2. **Antiaérea com modelo real** nas duas eras (Wirbelwind; Gepard ou Tunguska) — candidatos já triados, falta baixar.
3. **Aviões glTF** (P-47 primeiro; depende de converter material spec-gloss).
4. **Tripulação por veículo** (`def.crew`) e HEAT para a era Moderna.
5. **IA**: parar em cobertura, angular o casco, recuar para recarregar.
6. **Som dos outros veículos** (motor e tiro posicionados), mesmo sintetizado.
7. **Segundo mapa** com relevo dentro do campo de batalha.
8. Comprimir os `.glb` (48 MB somados; meshopt + WebP reduziria para ~1/4).

## Defeitos achados e corrigidos nesta rodada

- Tanque renascia em cima de outro no spawn e os dois capotavam ("Veículo capotado" com o jogador parado).
- Menu abria mostrando o Sherman, que não está no elenco.
- Escala de alcance da luneta amontoada com APFSDS; rótulo da luneta escondido atrás do painel de munição.
- Placar quebrava nomes em duas linhas; trilhos da estrada ziguezagueavam.
- A bancada de inspeção (`tools/bench.html`) gerava folhas vazias nas 6 vistas.

## Atualização (mesmo dia, mais tarde)

Entraram depois desta avaliação: Wirbelwind e Gepard com modelo real (esteiras ainda paradas), tripulação por veículo e HEAT com fator de composta. Os itens 2 e 4 da lista "o que falta" estão resolvidos; o mapa continua sendo o ponto mais fraco.

Segunda rodada do mesmo dia: P-47 e A-10 com pele real, Wirbelwind com esteira em elos, IA de ataque aéreo corrigida (jato não se enterra mais no mergulho), som com motores dos outros blindados. O som segue 100% sintetizado: melhorou em densidade, mas a distância para gravações reais continua — é decisão do dono voltar a usá-las.
