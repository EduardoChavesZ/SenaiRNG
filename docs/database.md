# Persistência PostgreSQL

## Arquitetura

O PostgreSQL é a fonte de verdade para contas, sessões, saldos, catálogo, invocações, coleções, recompensas, perfis, preferências e auditoria. Todas as cartas ativas são ilimitadas; não há contadores de estoque. A API usa `pg` diretamente e controla transações em `server/src/db/transaction.ts`; não há ORM. `server/src/db/migrate.ts` aplica os arquivos SQL em ordem lexical e registra cada arquivo aplicado em `schema_migrations`. Cada migration executa numa transação.

As migrations existentes são incrementais:

| Migration | Responsabilidade |
| --- | --- |
| `001_accounts_wallet.sql` | Contas, sessões, carteiras, ledger, configurações e auditoria |
| `002_catalog_stock.sql` | Categorias, raridades e cartas (estoque legado removido em `010`) |
| `003_draws_collection.sql` | Lotes e resultados de invocação, coleção |
| `004_profiles_rewards_multi_currency.sql` | Moedas adicionais, perfis, cosméticos, conquistas, recompensas e estatísticas |
| `005_invocation_banners.sql` | Banners, pity, conversão de duplicatas e snapshots adicionais |
| `006_hourly_daily_rewards.sql` | Cooldown horário, sequência de 24 horas e paleta da roleta |
| `007_user_preferences.sql` | Preferências de efeitos, música de invocação e volume |
| `008_profile_images_speech.sql` | Imagens de perfil e texto do balão de fala |
| `009_profile_nickname_color.sql` | Cor personalizada do apelido |
| `010_remove_stock.sql` | Remove limites de estoque e arquiva movimentações históricas |
| `011_card_banner_media.sql` | Metadados das imagens de cartas e mídia visual dos banners |

Uma migration aplicada é histórica e não deve ser editada. Mudanças de esquema devem ser feitas numa nova migration. O runner registra nomes, não checksums, e não fornece rollback automático; revise o SQL e faça backup antes de aplicá-lo a um banco persistente.

## Entidades e integridade

- **Conta e economia:** `users` tem papel `user` ou `admin`, exclusão lógica e e-mail único entre contas ativas. `user_sessions` guarda apenas o hash do token. `wallets` contém os saldos atuais; `wallet_transactions` registra as alterações de saldo.
- **Configuração administrativa:** `settings` guarda valores JSONB. `audit_logs` registra alterações administrativas com valores anterior e posterior.
- **Catálogo:** `categories`, `rarities` e `cards` definem o catálogo. Caminho, MIME e dimensões são persistidos para imagens; cartas antigas sem imagem permanecem preservadas para completar o cadastro. Cartas ativas não têm limite de quantidade.
- **Histórico legado:** `legacy_stock_movements` preserva movimentações anteriores à remoção do estoque e não participa mais das invocações.
- **Invocações e coleção:** `draw_batches` registra a operação e a chave de idempotência; `draws` preserva o resultado e snapshots visuais; `user_cards` mantém a coleção agregada. A chave única por usuário/operação evita cobrança duplicada.
- **Banners e pity:** `invocation_banners`, `invocation_banner_cards` e `invocation_pity_configs` definem pools e garantias; `user_banner_pity` guarda estado por usuário/banner. `invocation_banners` guarda também mídia, fallback estático e ponto focal, sem interferir nas regras RNG. `duplicate_reward_configs` aceita regra por raridade e exceção por carta.
- **Recompensas diárias:** `daily_rewards` e `daily_streak_milestones` definem resultados; `daily_reward_history` é o histórico de concessões e `daily_streaks` mantém o estado corrente. Desde `006`, o próximo giro é controlado por timestamp, a sequência só avança após 24 horas e uma chave de idempotência continua impedindo repetição da mesma operação.
- **Perfil e preferências:** `user_profile_customizations` e `user_preferences` são um-para-um com a conta. `user_preferences` persiste redução de efeitos, música opcional das revelações e volume do som. O som de interface continua desligado ao iniciar a sessão para respeitar a política de interação/autoplay do navegador.
- **Progressão e loja:** `user_game_stats` guarda estatísticas agregadas; `achievements` e `user_achievements` armazenam conquistas; `cosmetic_items` e `user_cosmetic_items` definem loja e itens adquiridos.

Restrições, índices e referências exatas estão nas migrations. Algumas relações de referência são polimórficas (`reference_type`/`reference_id`) ou deliberadamente guardam snapshots; elas não são chaves estrangeiras.

## Diagrama ER

O diagrama de relacionamentos está em [database-er.mmd](./database-er.mmd). Ele representa o esquema após aplicar as migrations `001` a `011`.

## Execução e segurança operacional

Na raiz do projeto, configure `DATABASE_URL` em `.env` para o banco pretendido e confirme o host e nome antes de executar:

```powershell
npm run db:migrate --workspace server
npm run db:seed --workspace server
```

O seed é idempotente para configurações existentes e não cria cartas fictícias. Não aponte comandos de migração para uma base com dados que não possa ser alterada. Em produção, use credenciais com privilégios mínimos, `COOKIE_SECURE=true`, segredos fora do repositório, backups verificados e restauração testada. Imagens enviadas ficam em `server/uploads`; o PostgreSQL guarda o caminho, portanto os arquivos também precisam de backup.

Uploads usam `UPLOAD_MAX_BYTES` (5 MiB por padrão), `UPLOAD_MAX_DIMENSION` (4096 px), `UPLOAD_MAX_PIXELS` (16 megapixels), `BANNER_GIF_MAX_FRAMES` (120) e `BANNER_GIF_MAX_DURATION_MS` (15000). Cartas aceitam PNG, JPEG e WebP; banners também aceitam GIF, preservado sem conversão e acompanhado por fallback estático.

Os testes unitários do servidor cobrem regras e serviços sem usar uma base persistente. Testes automatizados de concorrência e persistência devem ser executados contra um PostgreSQL descartável configurado separadamente; não use `rng_dev` ou outro banco de desenvolvimento persistente como alvo de teste.
