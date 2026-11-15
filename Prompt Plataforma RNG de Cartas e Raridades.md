# Prompt: Plataforma RNG de Cartas e Raridades

*Versão revisada e consolidada, pronta para colar na IA de desenvolvimento.*

---

## Como você deve trabalhar

Atue como desenvolvedor full-stack experiente. Priorize organização, qualidade de código e experiência do usuário.

**Antes de escrever qualquer código**, faça apenas o seguinte e depois **pare e aguarde minha aprovação**:

1. Analise o projeto existente (se houver) e identifique as tecnologias já em uso. Não substitua tecnologias existentes sem justificativa.
2. Proponha a arquitetura e a estrutura de pastas.
3. Apresente o modelo de dados (tabelas, relações e índices).
4. Explique o fluxo completo de um sorteio, incluindo transação, bloqueios e idempotência.
5. Aponte riscos e dúvidas que precisem da minha decisão.

Depois da aprovação, implemente **por etapas**, com commits pequenos e uma breve explicação ao fim de cada etapa. Ordem sugerida: (1) base, contas e carteira; (2) cartas e raridades; (3) motor de RNG; (4) coleção e histórico; (5) animações; (6) testes e otimização.

Regras durante o desenvolvimento:

- Nada de funcionalidade falsa ou apenas visual: todo botão deve ter função real.
- Dados fictícios só como **seed** claramente identificado. Nunca os trate como dados persistentes reais.
- Evite duplicação de código e arquivos que concentrem toda a lógica.
- Comente apenas o que for realmente importante.

---

## 1. Objetivo e escopo

Quero uma plataforma web interativa de sorteios (RNG) de cartas com raridades, no estilo de sistemas de invocação de jogos de coleção. O usuário gasta **moeda virtual** para sortear cartas, que entram na sua coleção. Existe também um **painel administrativo** para gerenciar cartas, raridades, probabilidades e a economia, sem editar código. Todas as cartas ativas são ilimitadas.

A plataforma é apenas entretenimento: **sem compras, apostas ou pagamentos com dinheiro real**. A moeda virtual só pode ser obtida dentro da plataforma.

### MVP (obrigatório na primeira versão)

- Cadastro, login e papéis (`user` e `admin`).
- Carteira de moedas com extrato.
- Sorteio individual (1x) e múltiplo (10x, com quantidade configurável).
- Cartas, raridades e categorias gerenciáveis pelo admin; todas as cartas ativas são ilimitadas.
- Probabilidades configuráveis com recálculo conforme a disponibilidade.
- Coleção do usuário e histórico persistente.
- Animações por raridade (versão enxuta), opção de pular e som opcional.
- Painel admin com CRUD, probabilidades, economia e auditoria.

### Fica para a v2 (não implementar agora)

- Cutscene exclusiva da raridade Secret e transições cinematográficas elaboradas.
- Dashboard com gráficos.
- Recuperação de senha por e-mail, login social e verificação de e-mail.
- Sistema de pity (garantia), troca de cartas entre usuários, ranking e conquistas.

---

## 2. Contas e papéis

- Cadastro e login com e-mail (ou usuário) e senha.
- Senhas com hash seguro (argon2id ou bcrypt com custo adequado). Nunca armazene senha em texto puro.
- Sessão segura (cookie `httpOnly`, `secure` e `sameSite`, ou JWT com expiração e renovação). Justifique a escolha na proposta de arquitetura.
- Papéis: `user` e `admin`. O painel admin é um papel dentro do mesmo sistema de contas, não um login separado.
- O primeiro admin é criado por **seed/variável de ambiente**, nunca por cadastro público.
- Toda rota administrativa deve validar o papel **no backend**. Esconder o botão no frontend não conta como proteção.
- Rate limit nas rotas de login, cadastro e sorteio.

---

## 3. Economia: moeda virtual

- Cada usuário possui uma carteira. O saldo **nunca é editado diretamente**: toda mudança gera um registro em um **extrato (ledger)** com tipo, valor, saldo resultante, data e referência (ex.: o sorteio ou o admin responsável).
- Tipos de movimentação: bônus de cadastro, resgate diário, custo de sorteio, concessão pelo admin e ajuste pelo admin.
- Fontes de moeda no MVP:
  - **Bônus de cadastro** (valor configurável).
  - **Resgate diário**, uma vez por dia, com o cooldown **validado no servidor**.
  - **Concessão manual pelo admin**, sempre registrada na auditoria.
- O **custo por sorteio** é configurável pelo admin. O sorteio múltiplo custa quantidade × custo, sem desconto no MVP.
- Saldo insuficiente bloqueia o sorteio com mensagem clara. O saldo nunca pode ficar negativo.
- O usuário vê saldo e extrato em uma tela de carteira.

---

## 4. Motor de RNG

### Regras de aleatoriedade

- O servidor decide o resultado. **Nada enviado pelo frontend influencia o sorteio** além do pedido (quantidade e chave de idempotência).
- Use gerador criptograficamente seguro (ex.: `crypto.randomInt`), nunca `Math.random`.
- Use **pesos inteiros** (ex.: escala de 10⁹) em vez de ponto flutuante, para que chances como 1/100.000 não sofram erro de arredondamento. Cada sorteio é uma seleção ponderada por soma acumulada, sem sequência predeterminada e sem favorecimento oculto.

### Modos de distribuição (configurável pelo admin)

1. **Individual:** cada carta tem seu próprio peso (a chance pode ser informada como "1 em N" ou em %).
2. **Por raridade:** cada raridade tem uma chance, e a carta é escolhida dentro da raridade (peso igual ou ponderado, conforme configuração).

### Probabilidade nominal × efetiva

- **Nominal:** o que o admin configurou.
- **Efetiva:** a chance real **neste momento**, após remover as cartas indisponíveis (desativadas) e renormalizar.
- A interface do usuário deve mostrar a **efetiva** e deixar claro que ela pode mudar conforme o pool e suas cartas ativas. O admin vê as duas.
- Diferencie sempre **chance individual da carta** de **chance acumulada da raridade**, com rótulos explícitos, para não induzir ninguém ao erro.
- Se nenhuma carta estiver disponível, o sorteio é recusado com mensagem clara e o usuário **não é cobrado**.

### Atomicidade e concorrência

Todo sorteio (1x ou Nx) acontece em **uma única transação**:

1. Valida a sessão e a chave de idempotência (única por usuário; repetir a mesma chave devolve o resultado anterior, sem sortear de novo).
2. Bloqueia a carteira do usuário e as linhas das cartas elegíveis (`SELECT ... FOR UPDATE` ou equivalente).
3. Confere o saldo.
4. Executa cada sorteio da série com os pesos e a seleção configurados.
5. Registra resultados, atualização da coleção e débito no extrato.
6. Confirma (`COMMIT`). Se algo falhar, tudo é revertido (tudo ou nada).

Cliques duplos ou requisições simultâneas do mesmo usuário não podem gerar sorteios duplicados.

---

## 5. Cartas, raridades e disponibilidade

### Cartas

Campos: ID único, nome, imagem, descrição, categoria, raridade, peso/chance, status (ativa/inativa) e data de cadastro.

- Toda carta ativa está sempre disponível e pode ser sorteada sem limite de quantidade.
- Cartas e raridades que já aparecem no histórico não podem ser apagadas de verdade: use **exclusão lógica (soft delete)**. Uma raridade só pode ser removida se não houver cartas ativas vinculadas.

### Raridades

Sistema personalizável (sugestão inicial: Common, Uncommon, Rare, Epic, Legendary, Mythic, Secret). Cada raridade tem: nome, cor principal, cor secundária, efeito visual, nível de animação, ordem/prioridade e chance (no modo por raridade). O admin pode criar, editar e remover raridades sem se limitar às sugeridas.

### Imagens

Upload validado (tipo, tamanho máximo, extensão e nome sanitizado), salvo em armazenamento organizado (disco ou serviço de objetos). O banco guarda apenas o caminho/URL, nunca o arquivo.

---

## 6. Probabilidades no painel admin

Área específica onde o admin pode:

- Definir a chance de cada carta (modo individual) ou de cada raridade (modo por raridade).
- Ver a chance **acumulada por raridade** e a **efetiva** atual de cada carta.
- Identificar configurações inválidas (peso zero em carta ativa, raridade sem cartas disponíveis, soma incoerente) com avisos claros.
- Trocar o modo de distribuição, com confirmação e registro na auditoria.

---

## 7. Telas

**Área do jogo** (visual imersivo, de jogo; evite aparência de dashboard corporativo):

- **Início:** identidade visual, botão principal de sorteio, destaques das cartas mais raras, últimos sorteios, saldo de moedas e acesso rápido à coleção e ao histórico.
- **Sorteio:** botões de 1x e múltiplo (com custo visível), probabilidades efetivas, animação e resultado.
- **Coleção:** cartas obtidas com quantidade de cópias, filtros (nome, raridade, categoria), ordenação (raridade, nome, quantidade) e cartas ainda não descobertas como silhuetas. Atualiza automaticamente após cada sorteio.
- **Histórico:** cartas obtidas com data/hora, raridade e probabilidade, com filtro por raridade e período. Persistente.
- **Carteira:** saldo, extrato e resgate diário.

**Painel administrativo** (funcional e organizado, acesso restrito): indicadores básicos, CRUD de cartas, raridades, categorias, probabilidades, configurações da economia, histórico de sorteios, concessão de moedas e log de auditoria.

As cartas devem ter layout consistente (imagem em destaque, nome, raridade, probabilidade), com efeitos visuais proporcionais à raridade, hover e transições suaves.

---

## 8. Animações e acessibilidade

A abertura de cartas deve ser uma experiência, não só uma imagem aleatória. A intensidade é **proporcional à raridade** e não pode cansar em sorteios múltiplos.

| Raridade | Intensidade da animação (MVP) |
| --- | --- |
| Common / Uncommon | Abertura curta, brilho discreto |
| Rare / Epic | Mudança de iluminação, partículas leves, revelação elaborada |
| Legendary / Mythic | Escurecimento da tela, partículas, revelação gradual |
| Secret | Destaque máximo (cutscene completa fica para a v2) |

Obrigatório:

- Botão para **pular** a animação, inclusive em sorteios múltiplos (resumo final com todas as cartas).
- Efeitos sonoros ativáveis/desativáveis, com controle de volume. O som nunca começa ligado sem ação do usuário.
- Respeitar `prefers-reduced-motion` e oferecer opção de reduzir efeitos. Evitar flashes rápidos que possam causar desconforto (fotossensibilidade).
- Compatibilidade com celular e boa performance. Priorize CSS, JavaScript e bibliotecas leves (Framer Motion só se necessário). Nada de animações pesadas.

---

## 9. Segurança e integridade

Consolidação dos requisitos de segurança:

- Toda validação e toda regra de negócio no backend. Validação de entrada em todas as rotas (ex.: Zod/Joi).
- Probabilidades e saldo controlados apenas pelo servidor.
- Autenticação e autorização por papel em todas as rotas protegidas.
- Rate limit, CORS restrito e cabeçalhos de segurança (ex.: helmet).
- Proteção contra injeção de SQL (consultas parametrizadas/ORM) e contra XSS.
- **Log de auditoria** de ações administrativas importantes: quem, o quê, quando e valores antes/depois (cartas, probabilidades, moedas, raridades, configurações).
- Mensagens de erro claras para o usuário, sem vazar detalhes internos.
- Segredos somente em variáveis de ambiente.

---

## 10. Arquitetura e tecnologias

Se o projeto já tiver stack definida, **use a existente**. Caso contrário, esta é a sugestão (ajuste e justifique na proposta):

- **Frontend:** React (JavaScript ou TypeScript), Tailwind CSS ou CSS, Framer Motion se necessário.
- **Backend:** Node.js + Express, API REST.
- **Banco:** PostgreSQL (ou MySQL), com migrações.
- **Infra local:** `docker-compose` para o banco e `.env.example` com todas as variáveis.
- **Idioma da interface:** português do Brasil (pt-BR).

Separe responsabilidades (rotas, controladores, serviços, repositórios, componentes, páginas). A lógica de sorteio fica em um serviço isolado e testável. Não adicione tecnologia só para aumentar a complexidade.

### Entidades mínimas do banco

`users`, `wallets`, `wallet_transactions`, `rarities`, `categories`, `cards`, `user_cards` (coleção), `draw_batches` (uma por requisição, com a chave de idempotência), `draws` (um registro por carta sorteada), `audit_logs` e `settings` (custo do sorteio, bônus, valor do resgate diário e modo de distribuição).

---

## 11. Critérios de aceite

O trabalho só está pronto quando:

1. **Probabilidades:** um teste automatizado simula uma grande quantidade de sorteios (ex.: 100 mil) e confirma que as frequências ficam dentro de uma tolerância estatística definida das probabilidades efetivas.
2. **Concorrência:** requisições concorrentes não podem duplicar cobrança ou resultados.
3. **Idempotência:** repetir a mesma requisição de sorteio não sorteia nem cobra duas vezes.
4. **Saldo:** o saldo nunca fica negativo, e a soma do extrato é igual ao saldo.
5. **Atomicidade:** uma falha no meio de um sorteio múltiplo não deixa coleção ou saldo parcialmente alterados.
6. **Permissões:** um usuário comum recebe 403 em qualquer rota administrativa.
7. **Persistência:** histórico, coleção e saldo sobrevivem a recarregar a página e reiniciar o servidor.
8. **Disponibilidade:** cartas ativas do pool sempre podem ser sorteadas; com todas as cartas inativas ou ausentes, o sorteio é recusado sem cobrar.
9. **Interface:** a chance exibida é igual à efetivamente usada, e a diferença entre chance individual e chance acumulada por raridade está clara.
10. **Responsividade e animações:** funcionam em celular, com opção de pular e respeito a `prefers-reduced-motion`.

---

## 12. Entrega final

Ao concluir, apresente:

- Funcionalidades implementadas e o que ficou pendente (incluindo itens da v2).
- Estrutura de pastas.
- Tecnologias utilizadas.
- Modelo do banco de dados.
- Como executar o projeto (instalação, migrações, seed e testes).
- Variáveis de ambiente necessárias.
- Resultado dos testes dos critérios de aceite.
