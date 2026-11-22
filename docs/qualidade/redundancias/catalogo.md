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
| RD-0124 | 21/11/2026 | T-0041 | listas.ts: regra de inativos em normalizar e trocarFiltro | código | média | engenheiro-software | aplicado (62133e6) | 2026-11-21-T-0041-descritor-listas.md |
| RD-0125 | 21/11/2026 | T-0041 | listas.ts: ConsultaDaLista e RESERVADAS com literais repetidos | código | baixa | engenheiro-software | aplicado (62133e6) | 2026-11-21-T-0041-descritor-listas.md |
| RD-0126 | 21/11/2026 | T-0041 | listas.ts: exports sem consumidor (ChavePaginacao, BUSCA_MAXIMO) | código | baixa | engenheiro-software | aplicado (62133e6) | 2026-11-21-T-0041-descritor-listas.md |
| RD-0127 | 21/11/2026 | T-0041 | contrato listas.md: chaves reservadas e 'a mesma query' ditas 2 vezes | doc | baixa | engenheiro-software | aplicado (62133e6) | 2026-11-21-T-0041-descritor-listas.md |
| RD-0128 | 21/11/2026 | T-0041 | listas.test.ts: asserções tautológicas e repetidas | teste | baixa | engenheiro-software | aplicado (62133e6) | 2026-11-21-T-0041-descritor-listas.md |
| RD-0188 | 21/11/2026 | T-0008 | Licenças (print 05): descrição do manifesto repete o nome do módulo ("Plataforma do tenant", "Pedidos vindos") e "nativo em nuvem" | texto | baixa | modulo-core · modulo-pedido · modulo-integracao-fdv | aberto | 2026-11-21-T-0008-prints-F1.md |
| RD-0189 | 21/11/2026 | T-0008 | Licenças (print 05), licencas/page.tsx:26: selo "Licenciado" × "Não contratado" para a mesma situação | texto · indicador | baixa | engenheiro-apps | aberto | 2026-11-21-T-0008-prints-F1.md |
| RD-0190 | 21/11/2026 | T-0008 | Login (prints 01 e 02): "Entrar" no título e no botão do mesmo cartão | texto | baixa | engenheiro-apps | aberto | 2026-11-21-T-0008-prints-F1.md |
| RD-0221 | 21/11/2026 | T-0012 | duble-hub.ts (OBRIGATORIOS, REFERENCIAS, canonico, compararCursor) e emissor-minimo.ts × domain/mapeamento.ts, lote.ts, canonico.ts e SDK hub.ts: oráculos independentes do lado FDV | código | — | testes | manter | 2026-11-21-T-0012-ponta-a-ponta.md |
| RD-0222 | 21/11/2026 | T-0012 | ida-erp-fdv.test.ts:305 "sem a divisão" roda 2× idêntico; duble-hub.test.ts:253 ⊂ :569; config.test.ts:196 repete a chave do :75 | teste | média | testes | corrigido no #117 | 2026-11-21-T-0012-ponta-a-ponta.md |
| RD-0223 | 21/11/2026 | T-0012 | DATA_HORA_UTC em duble-hub.ts e massa-kit.ts; laço de fatias do emissor-minimo × emFatias | código | baixa | testes | corrigido no #117 | 2026-11-21-T-0012-ponta-a-ponta.md |
| RD-0224 | 21/11/2026 | T-0012 | contrato-hub.ts:1-6: cabeçalho diz "C-6 em PR; quando entrar no main, os tipos vêm de lá" (já está no main) | doc | média | testes | corrigido no #117 | 2026-11-21-T-0012-ponta-a-ponta.md |
| RD-0225 | 21/11/2026 | T-0012 | T-0012.md: contagens em 3 lugares; tabela de variáveis repete a de Perfis; regra do 422 de topologia 4× | doc | média | testes | corrigido no #117 | 2026-11-21-T-0012-ponta-a-ponta.md |
| RD-0293 | 21/11/2026 | T-0045 | nfe-sefaz/chave.ts × nfe-emissor/chave.ts (T-0018): chave de acesso e DV 2×, critérios diferentes (CNPJ alfanumérico) | código | alta | engenheiro-software | aberto | 2026-11-21-T-0045-simulador.md |
| RD-0294 | 21/11/2026 | T-0045 | CNPJ do titular do A1 em 3 lugares (xmldsig.ts, core leitor-pfx.ts, nfe-emissor certificado.ts); impressão digital 2×; slice(0,8) × cnpjRaiz | código | alta | engenheiro-software · modulo-core | aberto | 2026-11-21-T-0045-simulador.md |
| RD-0295 | 21/11/2026 | T-0045 | A1 de teste em 2 pacotes; 3 leitores de PKCS#12 (abrirA1DeTeste sobra); validade e instante de teste repetidos | código · teste | média | engenheiro-software | aberto | 2026-11-21-T-0045-simulador.md |
| RD-0296 | 21/11/2026 | T-0045 | assinador/montador de teste × T-0018: comentário "este arquivo sai" falso; desenhos dizem "sem duplicar"; NS e ALG redeclarados | código · doc | média | engenheiro-software | aberto | 2026-11-21-T-0045-simulador.md |
| RD-0297 | 21/11/2026 | T-0045 | contrato SEFAZ redeclarado no spike (tipos *Local, montarEnviNFe, formatarDataHora); enviNFe/envEvento montados à mão no simulador | código | média | engenheiro-software | aberto | 2026-11-21-T-0045-simulador.md |
| RD-0298 | 21/11/2026 | T-0045 | sefaz-simulador: cabeçalho de retorno 8×, refAut 2×, AAMM 2×, TP_AMB_SIMULADOR, leitura de XML igual à do xmldsig.ts | código | média | engenheiro-software | aberto | 2026-11-21-T-0045-simulador.md |
| RD-0299 | 21/11/2026 | T-0045 | OperacaoNaoImplementadaNoSimulador obsoleta sem consumidor; exports mortos (knip); testes de assinatura repetidos no simulador | código · teste | baixa | engenheiro-software | aberto | 2026-11-21-T-0045-simulador.md |
| RD-0300 | 21/11/2026 | T-0045 | ADR 0008 × desenho T-0045 × cabeçalhos: 55 cStat, ordem das conferências, trava 3 camadas, citação, pendência do core; README PL_010g × SHA256SUMS | doc | média | engenheiro-software | aberto | 2026-11-21-T-0045-simulador.md |
