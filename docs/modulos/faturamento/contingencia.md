# Contingência da NF-e 55 (T-0021, lote 4, v0.2.1)

Desenho de 22/11/2026 (Manaus). Regras (doc 03 v0.2.1, PR #262): **RN-FAT-05** (o operador decide a entrada; o sistema sugere), **RN-FAT-08** (mesma série e número; tpEmis e xJust no XML; EPEC só conta como faturada após o evento registrado (cStat 136)), **RN-FAT-09** (o operador encerra; EPEC em fila na volta, dentro do prazo), **RN-FAT-10** (filial com NF-e simulada não entra); RF-FAT-05. Modalidades v1 a registrar em ADR. FS-DA fora.

## Modalidades na v1
- **SVC-AN (tpEmis 6)** e **SVC-RS (tpEmis 7)**: a nota é autorizada no ambiente SVC (autorização normal, com protocolo). SVC que atende cada UF vem por parâmetro (`modalidadeDaUf(uf, tabela)`). **ADR 0011:** a tabela UF -> SVC fica só em `packages/nfe-sefaz` (`SVC_DA_UF`); o domain não tem tabela (`TABELA_SVC_PADRAO` removida) e a api passa a do pacote quando o PR do engenheiro entrar. UF fora da tabela devolve nulo. **AM = SVC-RS, a conferir (ADR 0011).**
- **EPEC (tpEmis 4, evento 110140)**: a SEFAZ autoriza só o evento (cStat 136); a NF-e é transmitida depois. Decisão do PO (07h05 de 22/11/2026 Manaus, PR #271, com a conferência do fiscal): a transmissão posterior sai assim que a SEFAZ normal responder, **no máximo 168 h depois da autorização do EPEC** (não da emissão nem do encerramento): `PRAZO_EPEC_HORAS = 168` (RN-FAT-09).

## Entrada (RN-FAT-05, RN-FAT-10)
- **O operador decide; o sistema sugere** (`sugerirContingencia`): consulta de status indisponível, ou tentativas com tempo-limite >= `limite` (parâmetro; valor a definir com o PO/fiscal). Perfil faturista-chefe/administrador liga a contingência por filial.
- Entrada: `modalidade` (svc_an/svc_rs ou epec), `motivo` (= xJust; mínimo 15, máximo 256 caracteres, pela regra do `Texto` do emissor: sem espaço nas pontas nem duplo, sem tab, quebra de linha ou caractere de controle) e `inicioEm` (= dhCont; UTC; nunca depois de agora, sem tolerância, para não passar do dhEmi; violação RN-FAT-05). Validação: `validarEntradaContingencia`.
- **RN-FAT-10:** filial com a bandeira `faturamento_real_nfe_simulada` (configuracao_filial) é recusada (`nfeSimulada: true`, violação RN-FAT-10).
- **Tela:** a filial "em contingência" fica em destaque (faixa/selo visível em todas as telas do faturamento da filial, com a modalidade e o `inicio_em`); a sugestão do sistema aparece como aviso com o botão "Entrar em contingência".

## Saída e volta (RN-FAT-09)
- O operador encerra a contingência (saída manual; nada de volta automática).
- Notas EPEC vão em fila na volta, **sem dobrar o número**, dentro do prazo (`prazoEpec({ epecAutorizadoEm, prazoHoras = 168 })`, contado de `epec_autorizada_em`; sem "conferir").
- Tela das pendentes: lista as notas `emitida_contingencia` da filial com o prazo e a `situacaoPrazoEpec(agora, prazo)` (`no_prazo`, `perto_do_fim` com janela padrão de 6 h (decisão de UX nossa, não do Manual; ajustável pelo PO), `vencido`). Prazo vencido: alerta vermelho ao administrador.
- Rejeição na transmissão da volta: pela RN-FAT-07 (nota rejeitada mantém o número; correção e retransmissão).

## O que muda na NF-e (RN-FAT-08)
`ide/tpEmis` (4, 6 ou 7), `ide/dhCont` e `ide/xJust`. **A chave de acesso muda com tpEmis (dígito 35 de 44)**: nota ainda sem chave autorizada é remontada com o novo tpEmis (a identidade da nota fixa série, número e cNF; só tpEmis e a chave mudam; a rejeitada 'dhCont/tpEmis' não vale chave antiga). `aplicarContingenciaAoConteudo` grava `conteudo.contingencia` {tpEmis, dhCont ISO UTC, xJust}; `notaParaEmissaoDe` e o `nfe-emissor` ainda precisam levar dhCont/xJust ao XML (etapa 2). O `TipoEmissao` do contrato aceita 1, 4 (EPEC), 6 e 7.

## Estados
SVC: `em_autorizacao` -> `autorizada` (tpEmis 6/7), como hoje. EPEC: `em_autorizacao` -> `emitida_contingencia` (evento autorizado, DANFE em contingência) e na volta `emitida_contingencia` -> `em_autorizacao` -> autorizada/rejeitada/denegada (`transicaoVoltaContingencia`, `podeTransmitirNaVolta`: **só EPEC (tpEmis 4), com `epecAutorizado`**). **SVC não retransmite** (o autorizador normal recusa tpEmis 6/7): violação RN-FAT-09 (campo `tpEmis`). Número e série sempre mantidos (RN-FAT-08); guarda do XML pela RN-FAT-03. **Faturado (RN-FAT-08, PR #271):** `contaComoFaturada(nota)`: SVC autorizada conta; EPEC com evento autorizado conta desde o evento, em qualquer status exceto cancelada, inutilizada e denegada (inclui `em_autorizacao` na retransmissão e `rejeitada`, que reenvia com o mesmo número, RN-FAT-07); EPEC sem evento não conta.
**Estado "EPEC vinculado, pendente de autorização" (só desenho, para a etapa 3; estados.ts e migração intactos):** é a nota `emitida_contingencia` com `epec_autorizada_em` preenchida (`epecAutorizado`) até a transmissão posterior ser autorizada. A UI mostra esse rótulo; se a etapa 3 preferir marcador próprio, será pedido por recado ao banco-dados. As etapas 3/4 usam essa função no saldo do pedido (`quantidadeFaturada`).

## DANFE (RN-FAT-08)
Em contingência leva a marca da modalidade (desenho; a marca valida na etapa 4): o aviso fiscal (EPEC: "DANFE impresso em contingência", dados do evento; SVC: tpEmis no cabeçalho). Layout: o `design-de-marca` valida antes de entrar.

## Etapas
2. SVC no seletor de transporte e no simulador, XML com dhCont/xJust (nfe-emissor, nfe-sefaz). 3. EPEC (contrato com tpEmis 4, evento 110140, retorno). 4. Volta à normal (worker transmite pendentes, prazo). 5. Rota e tela por filial. 6. Testes db e DANFE em contingência.

## Dados (migrações 0013 e 0032)
Tabela existente **`faturamento.contingencia`** (0013, RLS padrão), estendida pela 0032; **não existe `filial_contingencia`**. Contingência **por filial E ambiente** (regra 7): colunas `filial_id` e `ambiente` ('homologacao'|'producao'); a API sempre filtra por (tenant, filial, ambiente).
- `modalidade`: 'svc_an' | 'svc_rs' (0013) e 'epec' (0032). Mapeamento para o XML: svc_an -> tpEmis 6, svc_rs -> 7, epec -> 4 (`TP_EMIS_DA_MODALIDADE`). `motivo` (15 a 256 caracteres) = xJust; `inicio_em` = dhCont; `fim_em` = saída (o operador encerra).
- Índice único parcial: **uma aberta por vez** por (tenant, filial, ambiente). Gatilho: só recebe o `fim_em`, uma vez. O gatilho da nota exige contingência aberta (mesma filial e ambiente) para `emitida_contingencia`.
- 0032 acrescenta `ligada_por` e `desligada_por` (usuário que liga e que encerra) em `contingencia` e, na `nota`, `epec_protocolo` (15 dígitos) e `epec_autorizada_em` (só com tipo_emissao 4).
- **Prazo da EPEC calculado no domain** (`prazoEpec`, `situacaoPrazoEpec`), **não gravado**.
- No conteúdo da NF-e ficam os nomes do Manual: `tpEmis`, `dhCont`, `xJust`; no domínio a entrada usa os nomes da tabela (`motivo`, `inicioEm`, `modalidade`); `ambiente` não entra no domínio (a API filtra).
- **RN-FAT-10 (NF-e simulada)** é checada na API pela `configuracao_filial` (0026), que passa `nfeSimulada` ao `validarEntradaContingencia`.

## Dependências
- **Migração 0032 (banco-dados):** extensão acima. Consulta: a aberta por (filial, ambiente); notas `emitida_contingencia` por filial. Volume baixo.
- **Fiscal:** conferir a tabela UF -> SVC (AM -> SVC-RS). O prazo da EPEC (168 h) já está decidido.
- **Marca:** validar o aviso do DANFE.

**Sugestão de entrada (RN-FAT-05):** `sugerirContingencia({ cStatServico, tentativasComTempoLimite, limite })`: o motivo `consulta_indisponivel` só quando o statusServico responde cStat 108 ou 109; `PRAZO_EPEC_HORAS` é provisório até o `PRAZO_TRANSMISSAO_EPEC_HORAS` de `@macuxierp/nfe-sefaz/contingencia` (ainda inexistente no main).
