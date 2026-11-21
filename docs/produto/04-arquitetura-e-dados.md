# 04 — Arquitetura modular e dados

> Espelho do doc 04 do Macuxi FDV, sem o app mobile e sem o Conector on-premise. Decisões: ADR 0001 (stack), ADR 0002 (biblioteca NF-e), ADR 0003 (deploy na VM do FDV), ADR 0004 (recados), ADR 0005 (certificado A1).

## Visão geral
```
        Navegador (https://erp.macuxifdv.com.br)
                     │
              apps/web — BKO do ERP (Next.js)
                     │  /v1/<modulo>/*
                     ▼
   ┌──────────── apps/api (Fastify) — monólito modular ────────────┐      ┌── apps/worker ──────────────────┐
   │ plataforma: auth, licenças, eventos (outbox), auditoria       │      │ outbox → filas                  │
   │ core │ cadastros │ pedido │ faturamento │ fiscal │ integracao-fdv │◄────►│  · SEFAZ (autorizar, retorno,    │
   └─────────┬─────────────────────────────┬───────────────────────┘      │    eventos, inutilizar, status)  │
             ▼                             ▼                              │  · Hub do FDV (lotes, pedidos)   │
   PostgreSQL (mesmo servidor do FDV)   S3 (mesmo do FDV)                 └──────┬───────────────┬──────────┘
   banco macuxierp, 1 schema/módulo     prefixo macuxierp/<tenant>/              │ mTLS + A1     │ HTTPS + chave de conector
   + RLS por tenant_id                  XML imutável ≥ 5 anos                    ▼               ▼
                                                                    SEFAZ-AM (NF-e 4.00)   Hub /integracao/v1 do FDV
```

## Ambiente e versões
- **Node 24 LTS** (`.nvmrc`), pnpm, Turborepo, TypeScript estrito, Vitest, ESLint, dependency-cruiser — os mesmos do FDV.
- **PostgreSQL 16** (mesmo servidor do FDV). Sem pgvector (o ERP não usa busca semântica).
- **Fastify** (API), **Next.js** (BKO), **Drizzle** (schema e migrações), **Zod** (contratos) — as mesmas versões do FDV, para o mesmo time manter.

## Estrutura do monorepo
```
apps/
  web/        shell Next.js do BKO (engenheiro-apps)
  api/        bootstrap Fastify: monta os plugins dos módulos licenciados (engenheiro-software)
  worker/     despachante da outbox e filas da SEFAZ e da integração (engenheiro-software)
modules/<modulo>/            core | cadastros | pedido | faturamento | fiscal | integracao-fdv
  manifest.ts    id, versão, depende, perfis, menus, eventos publicados e consumidos
  domain/        regras puras + testes (RN-<MOD>-nn)
  contracts/     Zod: API pública e eventos ← única parte importável por outros módulos
  api/           plugin Fastify (/v1/<modulo>), handlers de eventos, jobs
  web/           páginas do BKO (registradas no shell)
  db/            schema (Drizzle) — dono: banco-dados
packages/
  platform-sdk/  defineModule, dinheiro em centavos, eventos, permissões
  ui/            tokens e componentes do BKO (marca Macuxi)
  config/        eslint, tsconfig, regras de fronteira
db/              migrações, RLS, papéis, seeds e tabelas fiscais
tests/           integração entre módulos, multi-tenant, Hub do FDV, NF-e em homologação, e2e
```

### Regras de fronteira (checadas no CI, `pnpm fronteiras`)
1. Um módulo importa apenas `packages/*` e `modules/<outro>/contracts`.
2. Nenhum módulo lê ou escreve tabela de outro schema.
3. Mudança incompatível em contrato = nova versão (`@2`), convivência por uma versão, ADR e recado aos consumidores.

## Banco
- **Mesmo servidor PostgreSQL do FDV**, banco próprio **`macuxierp`**.
- Papéis próprios: `macuxierp_app` (API), `macuxierp_worker` (despachante e filas), `macuxierp_leitura` (consulta e diagnóstico). Nenhum deles tem acesso ao banco do FDV, e o papel do FDV não tem acesso ao `macuxierp`.
- **Um schema por módulo**: `core`, `cadastros`, `pedido`, `faturamento`, `fiscal`, `integracao_fdv`, mais `plataforma` (tenant, licença, outbox, auditoria).
- **RLS por `tenant_id`** em todas as tabelas, com teste automático de vazamento entre tenants.
- Campos comuns: `id uuid`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`, `external_id`.
- Migrações aditivas (a versão anterior roda sobre o esquema novo), como no FDV.
- O servidor é o DBaaS do FDV (admin sem superusuário): as migrações seguem o mesmo cuidado do FDV (papéis criados pelo admin com `CREATEROLE`, sem `ALTER` de atributo).

| Schema | Tabelas principais (desenho inicial; o banco-dados fecha na F1) |
|---|---|
| `plataforma` | tenant, tenant_modulo, perfil, usuario_perfil, evento (outbox), auditoria, arquivo |
| `core` | empresa, usuario, certificado (cifrado), parametro |
| `cadastros` | filial, cliente, cliente_endereco, cliente_contato, produto, tabela_preco, tabela_preco_item, estoque_saldo, estoque_movimento, condicao_pagamento, vendedor, carteira; tabelas oficiais: ncm, cest, cfop, cst, municipio, classificacao_tributaria |
| `pedido` | pedido, pedido_item, pedido_evento, aprovacao |
| `fiscal` | regra_tributaria, regra_item, ibpt, versao_nt |
| `faturamento` | serie, numeracao, nota, nota_item, nota_evento, nota_xml (só inserção + hash), inutilizacao, titulo, titulo_baixa |
| `integracao_fdv` | credencial (cifrada), cursor_entidade, lote_envio, lote_erro, pedido_recebido, retorno_enviado, sinal |

## VM, proxy e endereço
- **Mesma VM de produção do FDV** (Magalu Cloud), com um **serviço próprio**: projeto Compose `macuxierp` em `/opt/macuxierp`, com os contêineres `api`, `worker` e `web` do ERP, separados dos do FDV.
- **Mesmo proxy**: o túnel do Cloudflare que já publica o FDV ganha o hostname `erp.macuxifdv.com.br`, apontado para o `web` do ERP (e `/v1` para a `api`). O DNS é do Alexandre.
- **Uma publicação por vez na VM**: o GitHub só garante a concorrência dentro de um repositório, então o grupo `producao-vm` sozinho não impede o FDV e o ERP de publicarem juntos. A trava vale **na própria VM** (ADR 0003).

## Arquivos
- O mesmo armazenamento S3 do FDV, com o prefixo **`macuxierp/<tenant>/...`**.
- **XML autorizado imutável**: gravado uma vez (`If-None-Match: *`), com o hash SHA-256 no banco; guarda mínima de 5 anos; incluído no backup e no ensaio de restauração do FDV.
- DANFE em PDF é gerado de novo a partir do XML quando preciso (não é a fonte da verdade).

## Segredos
- Nada de segredo em código, recado ou log. `.env` de produção e secrets do GitHub: só o Alexandre cria.
- **Certificado A1** e a senha: criptografados no banco (AES-256-GCM, chave por ambiente no secret do servidor, `MACUXIERP_CHAVE_A1`), decifrados só na memória do worker na hora de assinar ou abrir o mTLS. O caminho seguro de envio do A1 é a tela do BKO (upload direto para a API, por HTTPS), nunca chat, recado ou e-mail (ADR 0005).
- Credencial do conector do FDV: também cifrada por tenant.

## Fontes gratuitas (conferidas na ADR 0002)
| Necessidade | Fonte | Observação |
|---|---|---|
| Autorizar NF-e | Webservices da SEFAZ-AM (autorizador próprio) | Homologação e produção gratuitas; credenciamento do emissor |
| Layout e regras | Portal Nacional da NF-e: XSD, MOC, NTs, NT 2025.002-RTC | Versão usada registrada em ADR |
| CNPJ | Dados abertos do CNPJ (Receita) + BrasilAPI | Sem API REST oficial unitária gratuita |
| Situação da IE | Consulta Cadastro da SEFAZ (com o A1) | Gratuito |
| CEP | ViaCEP e BrasilAPI | Sem chave |
| Municípios | API de localidades do IBGE | Código IBGE na NF-e |
| NCM | Tabela NCM do Portal Único Siscomex (JSON) | Rotina de atualização |
| CEST, CFOP, CST | Convênio ICMS do CEST e anexos do MOC | Seed versionado |
| Carga aproximada | Tabela IBPT | Gratuita com cadastro do CNPJ |
| Notas recebidas (fase 2) | Distribuição DF-e (Ambiente Nacional) | Fora da v1 |
| DANFE | Biblioteca de PDF já usada no FDV | Sem serviço pago |

## Segurança e não funcionais
- JWT de acesso 15 min + refresh rotativo em cookie httpOnly (como no FDV); argon2id.
- RBAC + licença de módulo em toda rota; RLS em todos os schemas.
- Logs pino com `tenant_id`, `modulo`, `request_id`, sem dado pessoal, sem XML com dados do destinatário.
- API p95 < 300 ms nas rotas de cadastro; autorização da NF-e assíncrona (fila), com o status na tela.
- Backups diários do banco (os do servidor do FDV) e ensaio de restauração junto com o do FDV.
