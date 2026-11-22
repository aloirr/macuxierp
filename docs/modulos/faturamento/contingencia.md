# Contingência da NF-e 55 (T-0021, lote 4, v0.2.1)

Desenho de 22/11/2026 (Manaus). Regras (doc 03 v0.2.1, PR #262): **RN-FAT-05** (o operador decide a entrada; o sistema sugere), **RN-FAT-08** (mesma série e número; tpEmis e xJust no XML; EPEC só conta como faturada após o evento), **RN-FAT-09** (o operador encerra; EPEC em fila na volta, dentro do prazo), **RN-FAT-10** (filial com NF-e simulada não entra); RF-FAT-05. Modalidades v1 a registrar em ADR. FS-DA fora.

## Modalidades na v1
- **SVC-AN (tpEmis 6)** e **SVC-RS (tpEmis 7)**: a nota é autorizada no ambiente SVC (autorização normal, com protocolo). SVC que atende cada UF vem por parâmetro (`modalidadeDaUf(uf, tabela)`); `TABELA_SVC_PADRAO` traz AM, BA, CE, GO, MA, MS, MT, PA, PE, PI, PR em SVC-RS e as demais em SVC-AN (AM = SVC-RS). **Conferir com o Manual de Contingência/NT (fiscal).**
- **EPEC (tpEmis 4, evento 110140)**: a SEFAZ autoriza só o evento (cStat 136); a NF-e é transmitida depois. Prazo da transmissão posterior: `prazoHoras` por parâmetro (conferir com o fiscal).

## Entrada (RN-FAT-05, RN-FAT-10)
- **O operador decide; o sistema sugere** (`sugerirContingencia`): consulta de status indisponível, ou tentativas com tempo-limite >= `limite` (parâmetro; valor a definir com o PO/fiscal). Perfil faturista-chefe/administrador liga a contingência por filial.
- Entrada: modalidade (SVC-AN/SVC-RS ou EPEC), `xJust` (mínimo 15, máximo 256 caracteres, sem espaços nas pontas) e `dhCont` (UTC, não no futuro; tolerância de 5 min). Validação: `validarEntradaContingencia`.
- **RN-FAT-10:** filial com a bandeira `faturamento_real_nfe_simulada` (configuracao_filial) é recusada (`nfeSimulada: true`, violação RN-FAT-10).
- **Tela:** a filial "em contingência" fica em destaque (faixa/selo visível em todas as telas do faturamento da filial, com a modalidade e o `dhCont`); a sugestão do sistema aparece como aviso com o botão "Entrar em contingência".

## Saída e volta (RN-FAT-09)
- O operador encerra a contingência (saída manual; nada de volta automática).
- Notas EPEC vão em fila na volta, **sem dobrar o número**, dentro do prazo (`prazoEpec({ emitidaEm, prazoHoras })`; `prazoHoras` por parâmetro, **conferir com o fiscal**: Manual/NT).
- Tela das pendentes: lista as notas `emitida_contingencia` da filial com o prazo e a `situacaoPrazoEpec(agora, prazo)` (`no_prazo`, `perto_do_fim` com janela padrão de 6 h (conferir), `vencido`). Prazo vencido: alerta vermelho ao administrador.
- Rejeição na transmissão da volta: pela RN-FAT-07 (nota rejeitada mantém o número; correção e retransmissão).

## O que muda na NF-e (RN-FAT-08)
`ide/tpEmis` (4, 6 ou 7), `ide/dhCont` e `ide/xJust`. **A chave de acesso muda com tpEmis (dígito 35 de 44)**: nota ainda sem chave autorizada é remontada com o novo tpEmis (a identidade da nota fixa série, número e cNF; só tpEmis e a chave mudam; a rejeitada 'dhCont/tpEmis' não vale chave antiga). `aplicarContingenciaAoConteudo` grava `conteudo.contingencia` {tpEmis, dhCont ISO UTC, xJust}; `notaParaEmissaoDe` e o `nfe-emissor` ainda precisam levar dhCont/xJust ao XML (etapa 2). O `TipoEmissao` do contrato ainda não tem o 4 (etapa 3 abre a extensão do contrato).

## Estados
SVC: `em_autorizacao` -> `autorizada` (tpEmis 6/7), como hoje. EPEC: `em_autorizacao` -> `emitida_contingencia` (evento autorizado, DANFE em contingência) e na volta `emitida_contingencia` -> `em_autorizacao` -> autorizada/rejeitada/denegada (`transicaoVoltaContingencia`, `podeTransmitirNaVolta`: EPEC só com `epecAutorizado`). Número e série sempre mantidos (RN-FAT-08); guarda do XML pela RN-FAT-03. **Faturado (RN-FAT-08):** `contaComoFaturada(nota)`: SVC autorizada conta; EPEC só depois do evento vinculado/autorizado. As etapas 3/4 usam essa função no saldo do pedido (`quantidadeFaturada`).

## DANFE (RN-FAT-08)
Em contingência leva a marca da modalidade (desenho; a marca valida na etapa 4): o aviso fiscal (EPEC: "DANFE impresso em contingência", dados do evento; SVC: tpEmis no cabeçalho). Layout: o `design-de-marca` valida antes de entrar.

## Etapas
2. SVC no seletor de transporte e no simulador, XML com dhCont/xJust (nfe-emissor, nfe-sefaz). 3. EPEC (contrato com tpEmis 4, evento 110140, retorno). 4. Volta à normal (worker transmite pendentes, prazo). 5. Rota e tela por filial. 6. Testes db e DANFE em contingência.

## Dependências
- **Migração (banco-dados):** configuração de contingência por filial: tabela `filial_contingencia` (filial_id, modalidade, x_just, dh_cont, ativa, ligada_por, desligada_em; um registro ativo por filial; RLS padrão) ou colunas em `filial_fiscal`; mais `epec_protocolo`/`epec_autorizada_em` na nota. Consulta: a ativa por filial, notas `emitida_contingencia` por filial. Volume baixo.
- **Fiscal:** confirmar a tabela UF -> SVC e o `prazoHoras` da EPEC (conferir com o Manual/NT).
- **Marca:** validar o aviso do DANFE.
