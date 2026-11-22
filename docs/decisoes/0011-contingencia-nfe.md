# ADR 0011 — Contingência da NF-e na v1: SVC da UF e EPEC, entrada e saída por filial, decididas pelo operador

- **Status:** proposta (etapa 2 da T-0021, lote 4, v0.2.1). A situação de cada dado do Manual está na tabela "Conferência do fiscal"; o que segue "a conferir" fecha com o modulo-fiscal antes do liberar
- **Data:** 22/11/2026, 07h20 (Manaus); revista às 07h32 com a conferência do modulo-fiscal (22/11, 07h12) e o PR #269 do faturamento (head 764d2c7)
- **Dono:** engenheiro-software
- **Base:** `CLAUDE.md`, regras 4, 7, 8 e 9; RN-FAT-01, 03, 04, 05 (nova redação), 07, 08, 09 e 10 e a linha de conferência pendente de `docs/produto/03-regras-de-negocio.md`; recado R-20261122-062011 (escopo da ADR e da etapa 2); ADR 0002 (emissor, opção A, PL_010g), ADR 0005 (A1 cifrado), ADR 0006 (só o operador põe filial em produção), ADR 0008 (simulador só em homologação); Manual de Orientação do Contribuinte da NF-e 4.00 (tpEmis, `dhCont`/`xJust`, EPEC)
- **Muda:** o desenho T-0045 §2.2, que deixava a EPEC fora da v1; `ModoEmissao` continua `normal | svc-an | svc-rs`, e a EPEC ganha destino e porta próprios

## Contexto
Até a v0.2.0 o ERP só emite no modo normal. O doc 03 (RN-FAT-05, 08, 09 e 10, decisão do PO de 22/11, 06h21) põe a contingência na v0.2.1. Quando a SEFAZ da UF cai ou a autorização passa do tempo-limite, a filial precisa continuar faturando sem abrir buraco na numeração e sem perder a guarda do XML. O Manual traz quatro modalidades: SVC-AN e SVC-RS (on-line, a nota sai autorizada pela SEFAZ Virtual), EPEC (evento prévio no Ambiente Nacional, a nota vai à SEFAZ normal na volta) e FS-DA (formulário de segurança). Faltava decidir quais entram, quem decide a entrada e a saída, como a numeração e a guarda ficam, e o que cada pacote e módulo faz.

## Opções
- (a) **Só a SVC da UF.** Simples: a nota sai autorizada na hora. Mas a SVC também pode cair, e o PO pôs a EPEC na v1.
- (b) **SVC da UF e EPEC; FS-DA fora.** Duas saídas independentes (SEFAZ Virtual e Ambiente Nacional), sem papel especial.
- (c) As quatro, com FS-DA. Exige formulário de segurança e controle de papel: fora do escopo da v1 (doc 01).

## Decisão
**Opção (b).**

1. **Modalidades da v1** (`ModalidadeContingencia` do `@macuxierp/nfe-sefaz`): `svc-an` (tpEmis 6), `svc-rs` (tpEmis 7) e `epec` (tpEmis 4), além do normal (1). Ficam fora o 2, o 3, o 5 (FS-DA) e o 9. A SVC permitida é só a da UF da filial (`SVC_DA_UF`). A EPEC vai sempre ao Ambiente Nacional, então não tem tabela por UF: `EPEC_DA_UF` é derivada do `AUTORIZADOR_DA_UF`, porque a nota EPEC precisa de um autorizador normal na volta. Na v1, isso dá só o AM, e nenhuma UF é escrita à mão. `modalidadesContingencia(uf)` devolve as opções na ordem de sugestão: a SVC primeiro, porque a nota já sai autorizada, e depois a EPEC. Numa UF fora do `SVC_DA_UF` que tenha autorizador no ERP, sai só a EPEC. Numa UF sem autorizador no ERP, sai vazio.
   - **Fonte única da tabela UF → SVC:** `SVC_DA_UF` (`packages/nfe-sefaz/src/enderecos.ts`); situação na tabela de conferência (item 6). O faturamento não guarda cópia: a `modalidadeDaUf(uf, tabela)` recebe a tabela por parâmetro.
   - **Fonte única do prazo da EPEC e dos tpEmis:** `PRAZO_TRANSMISSAO_EPEC_HORAS` e `TP_EMIS_CONTINGENCIA` do pacote. Para o `domain` do faturamento, que também roda no BKO, o pacote ganha o subcaminho puro **`@macuxierp/nfe-sefaz/contingencia`**. Ele traz só constantes, tipos e a tabela, sem XML, assinatura, XSD ou módulo do Node. Pela regra 1 do CLAUDE.md, módulo importa `packages/*`, e o faturamento já importa `@macuxierp/nfe-emissor` no `domain`. O contrário (o pacote importar o domain) é proibido (`pacote-importa-modulo-ou-app`).
2. **Entrada e saída por filial emissora e ambiente, decididas pelo operador** (RN-FAT-05 e 09). O sistema só **sugere** a entrada quando o `statusServico` da UF devolve 108 ou 109, ou quando a autorização estoura o tempo-limite (`FalhaTransporteSefaz` retentável depois da consulta do protocolo, desenho T-0045 §3.3). Quem entra é o operador com perfil de faturamento: ele escolhe a modalidade entre as da UF e escreve a justificativa (15 a 256 caracteres, que é o limite do `xJust` no schema; o doc 03 pede no mínimo 15). O instante da entrada (`dhCont`) é gravado em UTC. A contingência é por **filial emissora e ambiente**: homologação real e produção são separadas, como na regra 7. A filial fica "em contingência" até o operador encerrar. Na volta, o sistema avisa quando o status da UF mostra 107, e o operador encerra.
3. **Numeração** (RN-FAT-01 e 08): a nota em contingência usa a **mesma série e a mesma sequência** da filial, sem buraco. Muda só o `tpEmis`, que entra na chave (posição 35). Uma nota montada em contingência e nunca autorizada (nem pela SVC, nem com EPEC registrada) pode ser remontada no modo normal com o **mesmo número** e outra chave. A nota com EPEC registrada fica presa à chave da EPEC (tpEmis 4) até ser autorizada. Buraco só por inutilização, e a SVC não inutiliza (`urls.inutilizacao = null`): a inutilização espera a volta da SEFAZ da UF.
4. **XML** (RN-FAT-08): com tpEmis diferente de 1, `dhCont` (com o fuso da filial) e `xJust` vão no `ide`, depois do `verProc`, na ordem do schema. Com tpEmis 1, os dois são proibidos. O emissor recusa a entrada fora disso (`ErroMontagemNFe`, citando o campo), e o simulador responde como a SEFAZ (556, 557 e 558).
5. **Guarda antes de tudo** (regra 7, RN-FAT-03 e 08): na SVC, o `nfeProc` com o protocolo da SVC é guardado antes de qualquer outra coisa, como no modo normal. Na EPEC, o **evento assinado e o `retEnvEvento`** são guardados antes de qualquer outra coisa. O pedido só conta como faturado depois da EPEC registrada (136). Na volta, o `nfeProc` da autorização normal também é guardado antes de tudo. O evento assinado é gravado antes de transmitir, para a retentativa sair idêntica (mesmo `dhEvento` e mesmo `idLote`), como nos outros eventos.
6. **Fila EPEC na volta** (RN-FAT-09): encerrada a contingência, as notas EPEC pendentes vão ao **autorizador normal** da UF (`escolherDestinoSefaz` com `modo: 'normal'`, que aceita tpEmis 1 e 4), em fila, uma de cada vez, com o **mesmo XML assinado** (mesma chave, mesmo número). A SEFAZ confere a nota com a EPEC (467 se divergir, 468 se não houver EPEC). Antes de reenviar, o worker consulta o protocolo pela chave (desenho T-0045 §3.3), para não dobrar a autorização. O prazo é `PRAZO_TRANSMISSAO_EPEC_HORAS`: 168 h **contadas da autorização do EPEC**, não da emissão nem do encerramento da contingência (item 4 da conferência). A nota autorizada pela SVC **não** é retransmitida na volta (item 5). A tela mostra o prazo que sobra, e o prazo vencido gera alerta vermelho ao administrador. A rejeição segue a RN-FAT-07.
7. **RN-FAT-10: filial simulada não entra em contingência.** O simulador não cai. Três travas:
   - `escolherDestinoSefaz` com `transporte: 'simulador'` e `modo` diferente de `normal` lança `SEFAZ_CONTINGENCIA_SIMULADA`;
   - `escolherDestinoEpec` com `transporte: 'simulador'` lança o mesmo erro (ou `SimuladorEmProducaoErro` em produção), e o `criarSeletorEpec` não tem fábrica de simulador;
   - a porta de estado do simulador no Postgres (a do worker) não guarda EPEC (`gravarEpec` lança `SEFAZ_CONTINGENCIA_SIMULADA`; `epecPorChave` devolve `null`, e a nota tpEmis 4 dá 468).

   O simulador ainda **responde** como SVC (autorização com tpEmis 6/7, num destino montado à mão) e como Ambiente Nacional (`epec`, 136), mas só para os testes, com a porta em memória (`apoio-teste.ts` do `sefaz-simulador`). Nenhum caminho do worker chega a isso.
8. **EPEC tem porta própria** (`SefazTransporteEpec`, com `epec(PedidoEvento)`). Fica fora do `SefazTransporte` porque o destino é outro: o Ambiente Nacional, `cOrgao` 91, e não o autorizador da UF. Assim os dublês atuais da porta não quebram. O destino (`DestinoEpec`, `tipo: 'epec'`) vem só do `escolherDestinoEpec`, com produção bloqueada enquanto o endereço estiver "a conferir" (`SEFAZ_ENDERECO_NAO_CONFERIDO`), como os endereços da T-0046.

## Contrato para o faturamento (pacotes; nomes do Manual)
- **Montagem** (`EmissorNFe.montar`, `NotaParaEmissao.ide`): `tpEmis: 1 | 4 | 6 | 7` (padrão 1); `dhCont?: string` (ISO 8601 em UTC com `Z`: o instante em que o operador entrou); `xJust?: string` (15 a 256, sem espaço nas pontas nem espaço duplo). Os dois são obrigatórios com tpEmis diferente de 1 e proibidos com 1. `dhCont` não pode ser depois de `dhEmi`. Com tpEmis 6 ou 7, só a SVC da UF do `cUF`. A chave sai com o tpEmis.
- **SVC:** `escolherDestinoSefaz({ filial_id, ambiente, uf, modo: 'svc-rs' | 'svc-an' }, { transporte: 'sefaz' })` ou o seletor com o mesmo `modo`. O transporte real recusa, antes de sair, a nota cujo tpEmis não é aceito pelo modo (`SEFAZ_CONTINGENCIA_INVALIDA`; tabela `TP_EMIS_ACEITOS`). Modalidade que não é da UF: `SEFAZ_CONTINGENCIA_INVALIDA`. Filial simulada: `SEFAZ_CONTINGENCIA_SIMULADA`.
- **EPEC:** `criarSeletorEpec({ transporte, sefaz: criarFabricaTransporteEpecSoap(...) })(filial, credencial)` dá o `SefazTransporteEpec`. `EmissorNFe.epec({ nfe, dhEvento, fusoMinutos, idLote? }, a1, transporteEpec)` monta o evento 110140 **da própria NF-e montada com tpEmis 4** (`montarEpec`), assina (`infEvento`) e envia. Volta o `RespostaEvento` (`cOrgao` 91, `C_ORGAO_AN`; evento 136 registrado) e o `assinado`. Na volta, `EmissorNFe.transmitir(xmlAssinadoDaNota, idLote, transporteNormal)`.
- **Apoio:** `modalidadesContingencia(uf)`, `SVC_DA_UF`, `EPEC_DA_UF`, `TP_EMIS_CONTINGENCIA`, `PRAZO_TRANSMISSAO_EPEC_HORAS` (os cinco também em `@macuxierp/nfe-sefaz/contingencia`, o subcaminho puro para o `domain`), `dadosEpecDaNFe` / `dadosEpecDoEvento` / `divergenciasEpec` (para conferir a nota contra a EPEC guardada antes de reenviar), `TIPO_EVENTO.epec = '110140'` e `DESC_EVENTO['110140'] = 'EPEC'`.

## Conferência do fiscal (22/11/2026, 07h12) e o que segue a conferir
Se algo divergir do Manual, vale o Manual, e o PO é avisado (doc 03). Os níveis são os do modulo-fiscal.

| # | Item | Nível | Fonte | Onde está no código |
|---|---|---|---|---|
| 1 | tpEmis 1, 4 (EPEC), 6 (SVC-AN) e 7 (SVC-RS); 2, 3, 5 e 9 excluídos | **CERTO** | XSD do PL_010g | `TpEmis`, `TP_EMIS_CONTINGENCIA` (`ambiente.ts`) |
| 2 | `dhCont` (B28) e `xJust` (B29, de 15 a 256) | **CERTO** | XSD do PL_010g | `Ide` do `nfe-emissor` (`entrada.ts`) |
| 3 | EPEC = evento 110140 ao Ambiente Nacional, `cOrgao` 91 | **FORTE** | NT 2013.004 | `C_ORGAO_AN`, `montarEpec` |
| 4 | Prazo da transmissão posterior: 168 h contadas da autorização do EPEC | **FORTE** | Ajuste SINIEF 07/05 | `PRAZO_TRANSMISSAO_EPEC_HORAS` |
| 5 | A SVC não precisa retransmitir na volta | **FORTE** | conferência do fiscal (a SVC autoriza on-line) | `TP_EMIS_ACEITOS.normal = [1, 4]` |
| 6 | UF → SVC | **a conferir, sem confirmação nas fontes oficiais em 22/11/2026** (a rede da sessão não chegou aos portais) | mapa do sped-nfe, commit `4596b89` | `SVC_DA_UF` só com AM → SVC-RS; as outras UFs ficam fora (nelas, só a EPEC) |
| 7 | URL da EPEC no AN (`ENDERECOS_EPEC`), WSDL `RecepcaoEvento` e operação `nfeRecepcaoEvento` (`OPERACAO_SOAP_EPEC`), e o cabeçalho `nfeCabecMsg`; pode ter migrado para o `NFeRecepcaoEvento4` | **a conferir** | mapa do sped-nfe (`RecepcaoEPEC` da sigla AN), commit `4596b89` | `ENDERECOS_EPEC`, com produção bloqueada por `conferido: false`; `OPERACAO_SOAP_EPEC` (`nfe-emissor/src/soap.ts`) |
| 8 | `cStat` do simulador: 136, 467, 468, 556, 557, 558 e 570, mais a regra "`dhCont` não depois de `dhEmi`" do emissor | **a conferir** | tabela de códigos do Manual | `MOTIVO` (`sefaz-simulador/src/contexto.ts`) |
| 9 | XSD da EPEC (`envEPEC_v1.00`, `leiauteEPEC_v1.00` e `retEnvEPEC_v1.00`) contra o ZIP oficial | **a conferir** (T-0046) | espelho do PL_010g, commit `4596b89` | `packages/nfe-sefaz/schemas/PL_010g/README.md` |

## Ligação com o faturamento (PR #269, head 764d2c7)
**Mapa de nomes.** A tradução fica no faturamento, na borda (API e worker), e o pacote não conhece os nomes da coluna:

| `faturamento.contingencia.modalidade` (0013/0032) | `ModalidadeContingencia` do pacote | tpEmis |
|---|---|---|
| `svc_an` | `svc-an` | 6 |
| `svc_rs` | `svc-rs` | 7 |
| `epec` | `epec` | 4 |

Os campos se ligam assim: `motivo` (coluna) vira `xJust`; `inicioEm` (`inicio_em`, UTC) vira `dhCont` (ISO com `Z`; o emissor aceita milissegundos e grava o XML com o fuso da filial). A `ConteudoNota.contingencia` (`tpEmis` 4, 6 ou 7, `dhCont`, `xJust`) vira os campos de mesmo nome do `ide` da `NotaParaEmissao`.

**Prazo.** `PRAZO_EPEC_HORAS` (domain do faturamento) e `PRAZO_TRANSMISSAO_EPEC_HORAS` (pacote) são o mesmo número (168), vindo de duas fontes. A fonte certa é a do pacote, junto dos outros dados do Manual. O domain do faturamento passa a importar de `@macuxierp/nfe-sefaz/contingencia`, o que a regra 1 permite (módulo importa `packages/*`), e apaga a constante própria. A tabela UF → SVC segue o mesmo caminho: a borda passa o `SVC_DA_UF` traduzido. O pedido vai ao modulo-faturamento por recado.

**Divergências achadas** (o domain e o doc são do modulo-faturamento; nada foi alterado aqui):
1. **`podeTransmitirNaVolta` aceita tpEmis 6 e 7.** O item 5 diz que a nota da SVC não é retransmitida, e o autorizador normal recusa 6 e 7 (`TP_EMIS_ACEITOS.normal = [1, 4]`, `SEFAZ_CONTINGENCIA_INVALIDA` antes de sair; 570 no simulador). Na volta, só a EPEC vai à fila. A nota SVC sem retorno se resolve por consulta do protocolo **na própria SVC**.
2. **`xJust`.** O domain recusa espaço nas pontas e o tamanho fora de 15 a 256, mas não recusa espaço duplo nem caractere de controle, que o `Texto` do emissor recusa (`ErroMontagemNFe`). Uma justificativa aceita na entrada pode quebrar todas as notas da contingência. O domain precisa da mesma regra.
3. **`dhCont` × `dhEmi`.** O domain aceita `inicioEm` até 5 min no futuro (`TOLERANCIA_INICIO_MS`), e o emissor recusa `dhCont` depois do `dhEmi`. Uma nota emitida nesses 5 min quebra na montagem. O domain deve gravar `inicio_em` = min(informado, agora), ou recusar o futuro sem tolerância.
4. **Comentário da `TabelaSvc`.** Ele cita "CE, PA e PI ficam fora do SVC", como se as outras UFs estivessem na tabela. A tabela única tem só o AM. Deve dizer "só AM → SVC-RS, a conferir; as outras UFs só com EPEC quando houver autorizador no ERP".
5. **`TipoEmissao` do `modules/faturamento/contracts`** segue `1 | 6 | 7` no #269 e precisa do 4 (a `ConteudoNota.contingencia` já tem).
6. **Sugestão (RN-FAT-05).** A `ConsultaStatus = 'indisponivel'` deve ser preenchida pela borda quando o `statusServico` devolver 108 ou 109, e não por qualquer falha de rede. O tempo-limite só conta depois da consulta do protocolo (desenho T-0045 §3.3). Isso não é divergência de código, e sim o que a borda precisa garantir.
7. **RN-FAT-08 (`contaComoFaturada`).** Bate com esta ADR: a EPEC com evento registrado (136) conta em qualquer status, menos cancelada, inutilizada e denegada. O comentário diz "vinculado/autorizado", mas o 136 é "registrado, ainda não vinculado". Sugiro "EPEC registrada (136)".

## Consequências
- A filial continua faturando com a SEFAZ da UF fora, sem buraco e com a guarda de sempre. A nota SVC sai autorizada na hora. A nota EPEC conta como faturada com a EPEC registrada e é autorizada na volta.
- O simulador não serve de atalho: a filial simulada nunca vê contingência (RN-FAT-10). Os testes cobrem SVC e EPEC pelo simulador em memória.
- Os dublês de `SefazTransporte` e `EmissorNFe` que já existem continuam compilando: a EPEC é uma porta nova, e o `epec` do `EmissorNFe` vem do `criarEmissorNFe` (quem espalha o emissor real ganha o método).
- O worker ganha uma fila nova (EPEC pendentes na volta) e o seletor da EPEC; produção segue bloqueada até a conferência dos endereços.

## Quem faz
| Dono | Tarefa | O quê |
|---|---|---|
| engenheiro-software | T-0021, lote 4, etapa 2 | Esta ADR; `nfe-emissor` (tpEmis 4/6/7, `dhCont`/`xJust`, `montarEpec`, `EmissorNFe.epec`, transporte SOAP da EPEC e trava de tpEmis); `nfe-sefaz` (modalidades, `escolherDestinoEpec`, `criarSeletorEpec`, `SefazTransporteEpec`, dados da EPEC, schemas EPEC, trava da RN-FAT-10); `sefaz-simulador` (SVC, EPEC 136, 467, 468, 556 a 558 e RN-FAT-10 na porta do Postgres). Depois: o seletor da EPEC e a fila EPEC no `apps/worker` |
| banco-dados | migração **0032** (reservada) | `faturamento.filial_contingencia` (filial, ambiente, modalidade, `dh_cont` UTC, `x_just`, quem entrou e quem encerrou, `encerrada_em`; uma aberta por filial e ambiente) e a guarda da EPEC (evento assinado, retorno, `n_prot`, prazo), com RLS e as colunas da regra 5 |
| modulo-faturamento | T-0021, lote 4 | `domain/contingencia.ts` (PR #269; acertar as divergências 1 a 5 acima e importar o prazo de `@macuxierp/nfe-sefaz/contingencia`); `TipoEmissao` com o 4; a tradução `svc_an`/`svc_rs`/`epec` na borda; o mapeamento para o `ide` (`tpEmis`, `dhCont`, `xJust`); a guarda antes de tudo; a fila EPEC na volta; tela com a filial em contingência em destaque e as pendentes com o prazo |
| modulo-fiscal | conferência | Os itens 6 a 9 da tabela de conferência (UF → SVC nas fontes oficiais, URL/WSDL/`nfeCabecMsg` da EPEC, `cStat` e XSD da EPEC); a marca de contingência no DANFE por modalidade (RN-FAT-08), com o design-de-marca |
| testes | T-0022 | Cenários de ponta a ponta: SVC (homologação real com dublê de rede), EPEC e volta, e a RN-FAT-10 com o simulador |
