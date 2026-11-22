# Catálogo de redundâncias

Os achados RD-0001 a RD-0019 foram registrados em rodadas anteriores (PRs #7, #14, #18, #19 e #20; ver diários e tarefas) e não constavam neste arquivo no `main` em 21/11/2026. RD-0020 a RD-0022 são da T-0033 (PR #22). O próximo número livre segue a última linha da tabela.

| ID | Data | Tarefa | Onde | Tipo | Sev. | Dono | Status | Relatório |
|---|---|---|---|---|---|---|---|---|
| RD-0023 | 21/11/2026 | T-0030 | desenho T-0030 §7 e ADR 0006 item 4: RN-CORE-08 copiada; referência ao §7 morta | doc | média | engenheiro-software | corrigido | 2026-11-21-T-0030-etapa1-docs.md |
| RD-0024 | 21/11/2026 | T-0030 | desenho T-0002, linha do PUT /ambientes-fiscais repete a ADR 0006 | doc | baixa | engenheiro-software | corrigido | 2026-11-21-T-0030-etapa1-docs.md |
| RD-0025 | 21/11/2026 | T-0030 | achado do licenca.mjs contado 4 vezes, inclusive na ADR 0006 | doc | baixa | engenheiro-software | corrigido | 2026-11-21-T-0030-etapa1-docs.md |
| RD-0026 | 21/11/2026 | T-0030 | ADR 0006 × desenho T-0030: contexto e detalhe do script duplicados; mensagem do 422 em 2 versões | doc | baixa | engenheiro-software | corrigido | 2026-11-21-T-0030-etapa1-docs.md |
| RD-0027 | 21/11/2026 | T-0026 | desenho T-0026 D11: leitor CSV num segundo lugar do SDK, fora do `paraCsv` (platform-sdk/listas) | código | média | engenheiro-software | corrigido | 2026-11-21-T-0026-etapa1-desenho.md |
| RD-0028 | 21/11/2026 | T-0026 | desenho T-0026 §8: regras do layout (não decrescente, Qtd4) no teste do SDK | teste | média | engenheiro-software | corrigido | 2026-11-21-T-0026-etapa1-desenho.md |
| RD-0029 | 21/11/2026 | T-0026 | desenho T-0026 §6: IdExternoCarga refazia IdExterno; IdExternoValor exportado do contrato | código | média | engenheiro-software | corrigido | 2026-11-21-T-0026-etapa1-desenho.md |
| RD-0030 | 21/11/2026 | T-0026 | desenho T-0026 × T-0002 §2: idempotência, licença e logs reescritos | doc | média | engenheiro-software | corrigido | 2026-11-21-T-0026-etapa1-desenho.md |
| RD-0031 | 21/11/2026 | T-0026 | desenho T-0026 §3.11 repetia as linhas *ERP:* das tabelas | doc | baixa | engenheiro-software | corrigido | 2026-11-21-T-0026-etapa1-desenho.md |
| RD-0032 | 21/11/2026 | T-0026 | desenho T-0026 §3: "200" e "filial padrão" repetidos nas tabelas | doc | baixa | engenheiro-software | corrigido | 2026-11-21-T-0026-etapa1-desenho.md |
| RD-0033 | 21/11/2026 | T-0026 | desenho T-0026: repetições internas (l. 169, 233, 259, 276, 279) | doc | baixa | engenheiro-software | corrigido | 2026-11-21-T-0026-etapa1-desenho.md |
| RD-0041 | 21/11/2026 | T-0024 | compose.yml (psql, papeis, api, worker): env_file, command e volumes repetidos | código | média | engenheiro-software | corrigido | 2026-11-21-T-0024-deploy.md |
| RD-0042 | 21/11/2026 | T-0024 | compose.yml:1-35: cabeçalho repete a ADR 0003 | doc | média | engenheiro-software | corrigido | 2026-11-21-T-0024-deploy.md |
| RD-0043 | 21/11/2026 | T-0024 | apps/web/Dockerfile: ARG/ENV mortos, NODE_ENV repetido, comentário com nomes antigos | código · doc | média | engenheiro-apps | corrigido | 2026-11-21-T-0024-deploy.md |
| RD-0044 | 21/11/2026 | T-0024 | scripts de produção e compose.yml: leitura do .env 5×, dc() 2×, rede do túnel 3× | código | média | engenheiro-software | corrigido | 2026-11-21-T-0024-deploy.md |
| RD-0045 | 21/11/2026 | T-0024 | lista de arquivos de ambiente em 5 lugares (compose, env.modelo, ADR 0003, banco.sh, preparar-vm.sh) | doc | média | engenheiro-software | corrigido | 2026-11-21-T-0024-deploy.md |
| RD-0046 | 21/11/2026 | T-0024 | Dockerfiles × compose.yml (HEALTHCHECK, ENV), .dockerignore herdado, estágios base e manifestos iguais | código | baixa | engenheiro-software · engenheiro-apps | parcial | 2026-11-21-T-0024-deploy.md |
| RD-0047 | 21/11/2026 | T-0024 | producao-publicar.yml (herança do FDV) e compose.yml (S3, SMTP, prefixo sem leitor) | rotina · código | média | governança · engenheiro-software | aberto | 2026-11-21-T-0024-deploy.md |
