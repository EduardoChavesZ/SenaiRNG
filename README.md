# Plataforma RNG de Cartas

Aplicação de coleção e sorteio com moedas virtuais internas. Não há compras, apostas ou pagamentos reais. A interface e as mensagens estão em português do Brasil.

## Requisitos

- Node.js 20 ou superior e npm.
- PostgreSQL 16 ou superior. `docker-compose.yml` inicia um banco local.

## Executar localmente

No PowerShell, na raiz do projeto:

```powershell
Copy-Item .env.example .env
```

Edite `.env` e defina pelo menos `DATABASE_URL`, `ADMIN_EMAIL` e `ADMIN_PASSWORD` (a senha inicial do admin precisa ter 12 ou mais caracteres). Em seguida:

```powershell
docker compose up -d db
npm install
npm run db:migrate --workspace server
npm run db:seed --workspace server
```

Inicie a API e o frontend em terminais separados:

```powershell
npm run dev --workspace server
npm run dev --workspace client
```

Abra `http://localhost:5173`. O Vite encaminha `/api` para `http://localhost:3000`; se a API estiver em outra porta, defina `API_PROXY_TARGET` antes de iniciar o frontend. As configurações iniciais da economia vêm de `.env.example` e são inseridas pelo seed somente quando ainda não existem; rodar o seed novamente não substitui valores que o admin já alterou. O seed não cria cartas fictícias.

## Invocação

A recompensa diária continua separada da nova seção **Invocação**. Administradores devem primeiro classificar cada raridade para conversão de duplicatas, configurar uma recompensa padrão de Gold e XP (e também Gems para Épicas ou superiores) e, então, criar um banner com cartas já existentes. Um banner só pode ser publicado se tiver cartas elegíveis, conversões válidas e, quando pity estiver ativo, uma carta elegível para a garantia. As quantidades 1x e 10x são obrigatórias.

As cartas podem ter um vídeo opcional do YouTube. O painel exige confirmação de autorização antes de salvar o link; somente o identificador validado é armazenado e a interface usa o player oficial do YouTube. A preferência de música do jogador começa desligada.

Na seção administrativa **Economia**, o admin pode configurar uma música opcional para a tela de acesso usando uma URL HTTPS do YouTube e confirmar que tem autorização para incorporá-la. A tela não reproduz áudio automaticamente: cada visitante decide quando abrir o player. A animação de pétalas respeita a preferência de movimento reduzido do sistema, e o rodapé mantém uma área livre para futuras imagens animadas.

No catálogo administrativo, cada carta publicada precisa de uma imagem PNG, JPG ou WebP enviada pelo próprio formulário; imagens antigas ausentes ficam sinalizadas para completar sem apagar cartas. Banners aceitam imagens estáticas ou GIF com fallback estático e enquadramento configurável. Os uploads locais ficam em `server/uploads`; tamanhos, dimensões, pixels, quadros e duração de GIF têm limites configuráveis no `.env`.

Para produção, use `COOKIE_SECURE=true`, configure `APP_ORIGIN` para a origem real do frontend e mantenha segredos fora do repositório.

## Comandos

```powershell
npm run build
npm test --workspace server
npm run db:migrate --workspace server
npm run db:seed --workspace server
```

O teste de RNG executa 100 mil seleções criptográficas e compara a frequência com a probabilidade efetiva dentro de seis desvios-padrão. Testes automatizados de concorrência/persistência devem usar um PostgreSQL descartável; não use um banco local persistente como alvo. Consulte [docs/database.md](./docs/database.md) para a arquitetura e o procedimento seguro, e [docs/database-er.mmd](./docs/database-er.mmd) para o diagrama ER.

## Estrutura

- `client/src/ui`: telas do jogador, painel admin e estilos responsivos.
- `server/src/routes`: endpoints de autenticação, carteira, catálogo, sorteios e administração.
- `server/src/services`: configuração de probabilidades e seleção RNG isolada.
- `server/src/db`: conexão, transações, migrações e seed.
- `server/migrations`: esquema incremental do banco.
- `server/uploads`: imagens validadas armazenadas localmente; o banco guarda caminhos e metadados visuais.

## Dados e integridade

As migrations `001` a `011` mantêm contas e sessões, carteiras e ledger, configurações e auditoria, catálogo, invocações e coleção, perfis, cosméticos e conquistas, recompensas diárias, banners e pity, conversões de duplicatas, preferências de usuário e metadados das imagens de cartas e banners. A `006` altera a elegibilidade da roleta para cooldown horário e sequência de 24 horas; a `007` cria preferências de efeitos, música opcional das revelações e volume; a `010` remove o estoque finito e torna todas as cartas ilimitadas; a `011` adiciona suporte persistido à mídia visual. As migrations são incrementais e registradas em `schema_migrations`; não edite arquivos históricos já aplicados. Confira `DATABASE_URL` antes de migrar um banco existente.

Cada invocação usa uma transação PostgreSQL, bloqueia banner, carteira, pool e pity, aplica pesos inteiros com aleatoriedade criptográfica, atualiza coleção, conversões, estatísticas e ledger. Lotes múltiplos são processados sequencialmente e tudo-ou-nada. Uma chave de idempotência repetida pelo mesmo usuário e com os mesmos parâmetros devolve o resultado persistido, sem nova cobrança.

## Escopo

Implementados no MVP: cadastro/login e papéis; carteira, extrato e recompensa diária; gestão administrativa de raridades, categorias, cartas ilimitadas, probabilidades, economia, auditoria e banners; invocação individual/múltipla, pity independente, conversão de duplicatas e música opcional via YouTube; coleção e histórico persistentes; animações por raridade, opção de pular, controle de som e redução de movimento.

Ficam para a v2: cutscene exclusiva Secret, gráficos de dashboard, recuperação de senha por e-mail, login social, verificação de e-mail, trocas, ranking e conquistas.
