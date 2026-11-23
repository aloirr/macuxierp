2026-11-21 — T-0007 — Cadastros completo (contracts, domain, api e web). Domain: RN-CAD-01 a 08, D7 (carteira) e D8 (filial) em funções puras com teste. API `/v1/cadastros`: filiais, clientes (endereços, contatos, limite só adm/gerente, vendedor só na própria carteira), produtos (unidades, NCM/CEST vigentes), tabelas de preço (PUT em lote até 5.000, preço vigente com queda na filial padrão), estoque e movimentos (negativo só adm/gerente), condições de pagamento, vendedores, transferência de carteira, consultas CNPJ/CEP (sugestão, BrasilAPI/ViaCEP com reserva, timeout 5 s, cache 24 h sem sócios nem CPF), IE (202, 422 RN-CORE-06 sem A1) e tabelas oficiais só leitura; eventos na outbox e auditoria (A). Adaptador SQL testado com PostgreSQL real (MACUXI_DB_MIGRACOES). Web: páginas do BKO como dados (colunas, filtros na URL, CSV, permissões). Previsão do doc 05 (16h06) mantida. Recados no corpo do commit (caixa 403 até a T-0025): pedidos ao engenheiro-software (montar o plugin em apps/api/src/modulos.ts; ErroApi com 503; turbo inputs para o teste de banco), ao modulo-core (porta do A1 por filial; payload de core.usuario.alterado@1) e ao testes (rodar sql.db.test.ts no CI).
2026-11-21 — T-0007 — correções da revisão do PR #15: CNPJ da consulta via validarDocumentoCliente, testes duplicados removidos, auditoria do limite de crédito, RN-CAD-03 (endereço principal) e RN-CAD-06 (vigência) no domain
2026-11-22 — C-10 — external_id de unidade, preço e endereço nos eventos (ADR 0010)
2026-11-22 — T-0021 — consumidor de estoque das notas (autorizada baixa, cancelada devolve)
2026-11-22 — T-0021 — campos fiscais da filial e do produto, consulta para o fiscal
2026-11-22 — T-0021 — regime PIS/COFINS obrigatório na filial CRT 3
2026-11-23 — T-0051 — carga por entidade: modelo CSV, aviso de dependência e entidade única
2026-11-23 — T-0051 — entidade_faltante no CARGA_DEPENDENCIA
2026-11-23 — T-0051 — manifest do cadastros usa os PERFIS do SDK (RN-CORE-09)
2026-11-23 — T-0053 — textos da regra A0 no cadastros (RD-1064, 1066–1069, 1080)
2026-11-23 — T-0058 — mensagens fiscais (RN-CAD-04) com o código e a ação na carga
2026-11-23 — T-0058 — planoSubstituicao (substituir tudo inativa o que falta)
2026-11-23 — T-0058 — carga no /config: adicionar e substituir tudo, menu fora do BKO
2026-11-23 — T-0058 — substituir_tudo reativa na carga seguinte (ativo=sim por padrão) e não inativa existente sem external_id (sem_chave)
2026-11-23 — T-0058 (WIP) — reativação no ponto comum da carga (carga-reativar.ts, chamado no executarCarga) e testes forma × prazo
