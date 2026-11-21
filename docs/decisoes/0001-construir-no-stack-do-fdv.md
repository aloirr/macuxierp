# ADR 0001 — Construir o Macuxi ERP no mesmo stack do Macuxi FDV

- **Status:** aceita (decisão do Alexandre, dono do produto)
- **Data:** 20/11/2026, 20h56 de Manaus (decisão); 21/11/2026 (registro)
- **Fonte:** recado R-20261120-205653-alexandre no `aloirr/macuxifdv-recados` ("vamos pelo caminho 1.")
- **Dono do registro:** engenheiro-software

> Esta ADR **só registra** a decisão e a comparação que a sustenta. Ela não reabre a escolha.

## Contexto
O Macuxi FDV precisa de um ERP que seja fonte da verdade dos cadastros e do faturamento, para ser usado de fato pelas empresas clientes. Havia dois caminhos (recado do Agente PO ao Alexandre, 20/11/2026):
1. construir o ERP no **mesmo stack do FDV**;
2. adotar um ERP gratuito pronto: **Odoo** com a localização brasileira da **OCA**, ou **ERPNext**.

## Decisão
O Macuxi ERP é construído no **mesmo stack do FDV**: TypeScript, Node 24, Fastify (API), Next.js (BKO), PostgreSQL (o mesmo servidor do FDV, com banco próprio), Drizzle, Zod, Vitest, pnpm e Turborepo; a mesma VM e o mesmo fluxo de deploy (liberar → aprovar → publicar). Não se adota Odoo nem ERPNext.

## Comparação
| Critério | Stack do FDV (escolhido) | Odoo + OCA l10n-brazil | ERPNext |
|---|---|---|---|
| Time de agentes | O mesmo time, as mesmas regras, o mesmo guardião | Python/ORM do Odoo, XML de views, outra forma de módulo | Python/Frappe, outra forma de módulo |
| Integração com o FDV | Nativa: o ERP fala o contrato canônico do Hub; tipos Zod no mesmo padrão | Conector externo ou módulo Odoo novo para o Hub | Conector externo ou app Frappe novo |
| NF-e e Reforma Tributária | A construir (ADR 0002), atrás de uma porta, no ritmo das NTs | Madura na OCA (`l10n_br_fiscal`, `l10n_br_nfe`), mas o ritmo das NTs depende da comunidade e da versão do Odoo | Localização brasileira fraca; NF-e por app de terceiros |
| Multiempresa SaaS | O mesmo modelo do FDV (tenant + RLS) | Multiempresa por banco ou por empresa, outro modelo de isolamento | Multi-site por banco (bench) |
| Infra e custo | A mesma VM, o mesmo Postgres, o mesmo S3, o mesmo deploy | Pilha nova (Odoo + workers + filestore), upgrades de versão pesados | Pilha nova (Frappe, Redis, MariaDB) |
| Manutenção | Nenhuma pilha nova para manter | Duas pilhas (FDV + Odoo) e migração anual de versão | Duas pilhas (FDV + Frappe) |
| Escopo | Só o básico da v1 (doc 01), sem sobra | Muito além do necessário; customizar é o custo | Muito além do necessário |

## Consequências
- O fiscal (NF-e 55 com IBS/CBS/IS) é construído pelo time, com a biblioteca da ADR 0002 e as tabelas oficiais gratuitas (doc 04).
- Todo o processo do FDV vale para o ERP: recados, agentes, guardião, CI, PR, deploy com aprovação, ADRs e quadro.
- Risco aceito: manter o ritmo das Notas Técnicas da NF-e, que mudam com frequência. Mitigação: porta `EmissorNFe`, versão da NT registrada em ADR e teste de schema (XSD) no CI do módulo de faturamento.
