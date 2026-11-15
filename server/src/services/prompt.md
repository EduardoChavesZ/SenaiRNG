Você é um engenheiro de software sênior responsável por implementar o sistema de invocação de cartas no projeto existente SorteSenai. Trabalhe no repositório atual; não crie outro projeto nem substitua a arquitetura.

## Objetivo

Implementar invocação de cartas por banners/pools configuráveis, com probabilidades e pity por banner, conversão de duplicatas, animações definidas por raridade e música autorizada associada a cartas. Entregue a implementação funcional, integrada e testada.

## Primeiro: inspecione o repositório

Antes de editar:

1. Leia README, manifests, migrations e os fluxos existentes de sorteio, carteira, coleção, histórico, raridades, administração e recompensa diária.
2. Confirme no código os pontos de entrada e o estado atual. Como referências iniciais, investigue os componentes do cliente `GameDashboard`, `PrizeWheel`, `AdminDashboard`, `styles.css` e `api.ts`; as rotas de sorteio/administração; e os serviços de sorteio ponderado, probabilidades e carteira. Não presuma que nomes ou estruturas continuem iguais sem verificá-los.
3. Apresente um plano técnico breve baseado no código encontrado e, em seguida, implemente as etapas sem esperar por aprovação adicional, a menos que encontre uma decisão destrutiva ou uma ambiguidade realmente bloqueante.
4. Não sobrescreva alterações existentes nem corrija problemas não relacionados. Preserve padrões, UX, tipos e validação já usados.

## Limites obrigatórios

- A roleta existente de recompensa diária continua exclusiva para recompensas diárias. Não a mova, reutilize ou misture com invocação de cartas.
- A tela de cartas chama-se **Invocação**, seguindo o visual de referência: saldo destacado e botões para invocar 1x e 10x. As quantidades disponíveis, incluindo obrigatoriamente 1x e 10x, são configuráveis pelo administrador.
- Não crie cartas, imagens, artes, banners ilustrados ou conteúdo fictício. Cartas serão cadastradas por administradores. Banner/pool é configuração funcional, não solicitação de arte.
- Não implemente crafting ou carteira de fragmentos nesta etapa.
- Não implemente pagamento, dinheiro real, compra de moeda ou monetização.
- Não introduza dependências desnecessárias nem faça refatorações amplas fora deste escopo.

## Banners e pools de invocação

Implemente banners/pools de invocação administráveis, sem exigir imagens. Cada banner precisa permitir ao administrador configurar, no mínimo:

- Identificação, nome, descrição e estado ativo/inativo.
- Período de disponibilidade com início e fim; valide datas e fuso conforme os padrões atuais.
- Cartas elegíveis no pool, seus pesos e probabilidades efetivas. Reutilize cartas, raridades e pesos existentes; não duplique o catálogo.
- Moeda e custo por invocação, respeitando as moedas existentes do projeto.
- Quantidades oferecidas (1x e 10x obrigatórias), respeitando limites administrativos.
- Regras de soft pity e hard pity definidas abaixo.
- Mudanças administrativas auditáveis, com valores anteriores e novos quando o padrão do projeto oferecer auditoria.

Uma carta pode estar em mais de um banner quando o modelo atual permitir. Só banners ativos dentro do período devem aceitar invocações. A API deve informar opções, custo efetivo, moeda, pool e chances reais da solicitação atual. Trate pool vazio e cartas inativas explicitamente; não cobre quando não for possível completar o sorteio. Cartas ativas são ilimitadas; não implemente contadores, decrementos ou alertas de estoque.

## Sorteio e probabilidades

- O servidor é a única autoridade que escolhe cartas. Reutilize a geração aleatória criptograficamente segura e a lógica de pesos existente; jamais determine o resultado no cliente.
- Calcule e valide probabilidades com pesos inteiros e, onde o projeto já oferece, razões exatas numerador/denominador. Exiba chances coerentes com banner e pity aplicáveis; não apresente chance nominal como se fosse chance efetiva.
- Para invocações múltiplas, processe cada posição sequencialmente dentro da mesma operação: coleção, pity e recompensas de uma posição afetam a posição seguinte.
- Se saldo, configuração do banner ou qualquer outra condição impedir a operação completa, aplique a política transacional existente para não deixar cobrança, coleção ou resultados parciais inconsistentes.

## Pity independente por banner

Cada usuário possui contadores independentes por banner. O administrador configura:

- Raridade-alvo da garantia.
- **Hard pity:** máximo de falhas/posições sem obter a raridade-alvo ou superior; a invocação que atinge o limite garante uma carta elegível da raridade-alvo ou superior.
- **Soft pity:** ponto de início, incremento por falha e regra de progressão até o hard pity. Documente e exiba a regra configurada; a probabilidade deve ser normalizada e não ultrapassar 100%.

Defina os limites sem off-by-one: especifique qual número de invocação aciona a garantia e teste a fronteira. O contador aumenta uma vez por sorteio concluído; ao obter a raridade-alvo ou superior, reinicia. Falhas e erros não avançam o contador. Os contadores de banners diferentes nunca interferem entre si. Em lote 10x, cada resultado altera o contador usado pelo próximo.

Impeça ativar ou salvar uma regra de garantia se o pool não tiver cartas elegíveis da raridade definida ou superior. Persistência, locking e idempotência devem impedir que retry, requests concorrentes ou replay alterem contadores duas vezes.

## Cartas duplicadas e economia

A primeira cópia de uma carta é registrada na coleção normalmente. Se o usuário já possui a carta antes da invocação, a nova cópia é convertida em recompensas e **não aumenta a quantidade** daquela carta. Preserve registros históricos já existentes; não apague duplicatas antigas da coleção.

Use a raridade da carta para definir moedas de conversão, com configuração padrão por raridade e sobrescrita opcional por carta. Valores devem ser administráveis e validados. Nesta etapa, as combinações permitidas são:

- Comum e Incomum: Gold + XP.
- Rara: Gold + XP.
- Épica e raridades superiores: Gems + Gold + XP.

Conceda fragmentos em nenhuma raridade por enquanto: não crie saldo, transações, interface ou crafting de fragmentos. Essa funcionalidade fica para uma etapa futura. Mostre no resultado qual carta duplicada foi convertida e quais recompensas foram concedidas. A conversão e os lançamentos das moedas devem ocorrer atomicamente com o sorteio, com referências rastreáveis no extrato.

Cartas novas incrementam cartas únicas; todos os resultados incrementam a contagem de sorteios. Mantenha estatísticas, conquistas e histórico consistentes com as regras acima.

## Animações por raridade

- Animações são configuradas exclusivamente no nível de raridade, para que todas as cartas dessa raridade compartilhem o comportamento. Administradores escolhem efeito e intensidade/nível conforme as opções existentes no projeto.
- Use os dados e recursos de carta/raridade já cadastrados. Não invente artes ou recursos gráficos.
- Na tela de resultado, revele cartas de forma legível; em 10x apresente todas sem ocultar resultados e permita reduzir/pular animação.
- Animação é apenas apresentação: nunca altera resultado, chances, pity ou cobrança.
- Respeite `prefers-reduced-motion` e a preferência de efeitos reduzidos já existente.

## Música autorizada por carta

Permita que um administrador associe uma música a uma carta usando um link do YouTube. Reproduza somente por meio do player/iframe oficial do YouTube e dentro dos termos aplicáveis:

- Não baixe, ripe, extraia, converta, proxie ou esconda áudio/vídeo; não contorne anúncios, controles, restrições ou políticas do YouTube.
- O fato de o site não ser comercial não constitui autorização de uso. Exija confirmação administrativa de que o conteúdo é próprio, autorizado ou licenciado para incorporação.
- Valide e normalize a URL do lado do servidor; aceite somente URLs HTTPS de domínios YouTube permitidos e gere o embed usando o identificador validado. Não permita HTML, URLs de script ou players arbitrários.
- Mantenha o player compatível com as regras de incorporação; não o esconda para reproduzir áudio em segundo plano.
- Música desligada por padrão ou condicionada à preferência explícita do usuário. Se tentar iniciar junto à revelação, faça-o somente se a preferência estiver habilitada e o navegador/player permitir; caso contrário, apresente botão acessível **Ouvir**.
- Inclua controles de pausar/desligar e volume quando suportados.
- Não interrompa nem atrase o resultado da invocação se o YouTube estiver indisponível ou bloquear autoplay. O resultado deve ser acessível sem música.

## Interface do jogador

- Mantenha uma seção **Recompensa diária** separada e a roleta diária nela.
- A tela **Invocação** mostra o banner selecionado e seu estado, saldo da moeda usada, custo por invocação, controles de 1x/10x e mensagem clara de saldo insuficiente, banner fechado ou pool sem cartas.
- Informe chances do banner de forma precisa e acessível; deixe claro quando o pity estiver ativo sem prometer resultado incorreto.
- Após o sorteio, mostre todas as cartas, raridades, animação correspondente e, quando aplicável, recompensas de duplicata. Música é opcional e não substitui informação textual.
- Desative as ações impossíveis no cliente para UX, mas valide todas as regras novamente no servidor.
- Preserve responsividade, navegação existente, modo de movimento reduzido e acessibilidade por teclado/leitor de tela.

## Painel administrativo

Adicione controles integrados ao painel atual para:

- Criar/editar/ativar/desativar banners e configurar pool de cartas, pesos, moedas, custos, quantidades e período.
- Configurar soft/hard pity, raridade-alvo e thresholds; validar combinações impossíveis.
- Configurar valores de conversão por raridade e sobrescritas por carta, respeitando as moedas permitidas.
- Configurar efeito e nível de animação da raridade.
- Associar/remover link do YouTube autorizado por carta, testar a incorporação com player oficial e registrar confirmação de direitos.
- Consultar histórico e auditoria relevantes sem expor dados privados de usuários desnecessariamente.

Toda ação administrativa deve exigir autorização existente, validação tipada, tratamento explícito de erro e auditoria consistente com os padrões do projeto.

## Integridade, segurança e migrations

- Faça migrations incrementais, reversíveis quando os padrões do repositório suportarem, com constraints e índices adequados. Preserve dados atuais e saldos Gold existentes; não reescreva migrations já aplicadas.
- Antes de executar migrations, verifique o banco e o mecanismo do projeto. Não aplique mudanças a um banco persistente/produção sem autorização explícita; use banco de teste para validação.
- Reutilize transações, locking de carteira, idempotency keys, rate limits, validação Zod e auditoria já existentes. Se precisar de nova tabela ou campo, justifique e mantenha a mudança mínima.
- Cobrança, resultados, cópias da coleção, moedas de duplicata, contador de pity, histórico e estatísticas devem confirmar ou reverter juntos.
- Requests repetidos com a mesma chave idempotente retornam o mesmo resultado sem cobrar ou recompensar novamente. Chaves conflitantes com parâmetros diferentes devem falhar explicitamente.
- Trate concorrência entre draws, alterações de banner e mudança de configuração.
- Não use defaults silenciosos para configuração inválida.
- Não confie em valor, raridade, custo ou moeda enviado pelo cliente; carregue os dados autoritativos do banco.

## Testes e critérios de aceite

Adicione testes focados e execute build/type-check e testes existentes. Cubra pelo menos:

1. Migrations aplicam em banco vazio e preservam dados de uma base anterior; não há perda de saldo, coleção ou histórico.
2. Apenas cartas ativas e elegíveis do banner participam; chances efetivas e razões somam corretamente e reagem ao pool.
3. 1x/10x respeitam custos, moedas, saldo e configuração administrativa; lote falho não deixa estado parcial.
4. Uma repetição idempotente não cobra, não concede recompensas, não altera coleção/pity nem estatísticas novamente.
5. Primeira cópia é adicionada à coleção; cópia seguinte não aumenta quantidade e concede os valores corretos por raridade; sobrescrita por carta prevalece; nenhuma recompensa usa fragmentos.
6. Soft pity, hard pity, reset, sequência múltipla e contadores independentes por banner, incluindo exatamente as fronteiras configuradas e requests concorrentes.
7. É impossível habilitar garantia para raridade ausente do pool.
8. Só administradores alteram banner, pity, recompensas, animação e YouTube; alterações relevantes geram auditoria.
9. URLs de música inválidas/externas são rejeitadas; embed oficial é usado; bloquear o player/autoplay não afeta o sorteio; preferência desligada não toca música.
10. A recompensa diária continua funcionando sem mudanças de comportamento e sua roleta não aparece na tela de invocação.
11. Interface responsiva, 10x mostra dez resultados, sem cartas mostra estado vazio, e movimento reduzido remove animações não essenciais.

Use os comandos já definidos pelo projeto (por exemplo `npm run build` e `npm test --workspace server`, confirmando-os nos manifests). Se algum teste falhar, corrija a causa relacionada à implementação e execute novamente. Não declare sucesso se build, testes ou migration de teste não forem verificados.

## Entrega

Ao terminar, informe:

- O que mudou e em quais arquivos/componentes.
- Migrations criadas e o estado de aplicação; não confunda teste temporário com banco persistente.
- Testes/build executados e resultados.
- Decisões necessárias que não puderam ser implementadas sem confirmação.
- Confirme explicitamente que a recompensa diária permaneceu separada, que nenhuma arte/carta fictícia foi criada e que crafting/fragmentos ficaram fora desta etapa.