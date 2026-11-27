# Entrada do cenário B no /config e no BKO (v0.3.11, ADR 0014 §3 a §5 e §14)

Desenho das telas, textos e estados. O código é do `engenheiro-apps`; sem componente novo em `packages/ui` (só `Dialogo`, `TabelaDensa`, `Chip`, `AlertaBloqueante`, `.mx-botao*`; `FaixaPendencias` e `CaixaResumo` não entram). Padrões: `docs/design/portal-config.md` (senha mostrada uma vez, estados comuns), `docs/design/alerta-bloqueante/README.md`, `docs/design/componentes-pedido.md`. Cores só por token; sem cor nova. Prints (escala 2x, dados fictícios): `config-integracao-1280x900.png`, `config-integracao-390x1600.png` (a tabela em 390 px, rolagem horizontal), `chave-uma-vez-1280x800.png`, `fechar-sem-copiar-1280x800.png`, `trava-30-1280x800.png`, `bko-cadastro-cliente-1280x800.png`, `bko-integracao-1280x800.png`.

## A) /config, aba "Integração"
Ordem, de cima para baixo: (1) grupo **Entrada de dados do cliente**: duas colunas **Integração via Conector** e **Integração via API**, lado a lado, uma só coluna abaixo de **900 px** (`grid-template-columns: repeat(2, minmax(0,1fr))`, vão de 24 px); (2) bloco **Cadastros recebidos do cliente** (C), largura total; (3) o bloco **Macuxi FDV** atual, sem mudança. Cada coluna é um `.bloco`.
- **Código do conector** (`conector_id`): `[A-Za-z0-9._-]{1,100}`. Editável só enquanto não há chave; com chave fica somente leitura, com a ajuda "Não muda com a troca da chave." Ajuda sem chave: "Letras, números, ponto, hífen e sublinhado. Até 100." Erros embaixo do campo (`.erro-campo`, `aria-invalid`, `aria-describedby`): vazio "Informe o código do conector."; fora da regra (400) "Use só letras, números, ponto, hífen e sublinhado, até 100 caracteres."; repetido (409 `conector_id_em_uso`) "Este código já está em uso. Escolha outro." Seguem a classe `.erro-campo` de `apps/web/src/app/globals.css` (cor `--mx-cor-erro-texto`, no `label.campo`).
- **Ficha** (`.ficha`): Chave (prefixo de 8 caracteres + "…", fonte de código), Versão, Último sinal (data e hora no fuso do tenant, `formatarDataHora`, com "(Manaus)" só quando o fuso é Manaus; sem sinal: "ainda sem sinal"; sem versão: "—") e **Criada em** <data e hora> (mesma formatação do Último sinal).
- **Sem credencial:** no lugar da ficha, "Nenhuma chave gerada. Informe o código e gere a chave." e o botão **Gerar chave**. Com credencial: **Trocar chave**.
- **Trocar chave:** `DialogoMotivo` (`semTexto`, `destrutivo`): título "Trocar a chave de Integração via Conector?" (ou "…via API?"); aviso fixo: **"A chave atual para de funcionar agora. Quem usa a chave antiga fica sem enviar até receber a nova."**; botões "Trocar chave" / "Cancelar". Gerar a primeira chave não pede confirmação.
- **503 `pepper_ausente`:** `ResultadoAcao` tom `erro` abaixo do **Gerar chave**/**Trocar chave**: `pepper_ausente`: **"O servidor ainda não está preparado para gerar chaves. Avise o responsável pelo servidor."** Os botões seguem ativos; a tela não tenta explicar o nome da variável.
- **Falha de rede ao gerar:** `ResultadoAcao` tom `erro`: **"Não foi possível confirmar a chave. Gere de novo: a chave nova substitui a anterior."** A geração não é idempotente (cada POST gera chave nova e invalida a anterior). Nesse caso o botão aparece como "Gerar chave", sem a confirmação de troca.
- **Módulo sem licença / sem permissão:** como já está na aba (faixa de aviso do portal).

## B) Chave mostrada uma vez (`chave-uma-vez-1280x800.png`)
`Dialogo` (não é painel inline, para o foco ficar preso na chave): título "Chave de Integração via Conector"; `tomAviso="aviso"`, `aviso` **"Esta chave não aparece de novo. Guarde agora."**; corpo: "Cole a chave no Conector da empresa." (via API: "Use a chave no cabeçalho de autorização das chamadas."), a chave em `--mx-fonte-codigo` com `word-break: break-all` e fundo pérola (selecionável; não é `input`), botão secundário **Copiar** e, ao copiar, região `role="status"` com **"Copiada"** (falha de clipboard: "Não foi possível copiar. Selecione a chave e copie à mão."). Rodapé: **Já copiei** (principal, único botão).
- **Fechar (decisão):** o fundo e o Esc chamam o mesmo `aoFechar`. Se a pessoa ainda não usou "Copiar", abre uma confirmação por cima (`DialogoMotivo`, destrutivo): título "Fechar sem copiar a chave?", aviso "A chave não aparece de novo. Você terá de trocá-la.", botões "Fechar sem copiar" / "Voltar"; "Voltar" devolve o foco ao "Copiar". Depois de "Copiar", Esc e fundo fecham direto. Justificativa: Esc que não fecha é armadilha de teclado (WCAG 2.1.2) e fechar sem aviso perde a chave sem volta; a confirmação resolve os dois. "Já copiei" fecha sempre.
- Print da confirmação por cima do diálogo da chave: `fechar-sem-copiar-1280x800.png`.
- Foco inicial no "Copiar"; ao fechar, a tela mostra só o prefixo novo. Sigilo da chave: como a senha mostrada uma vez de `portal-config.md`.

## C) Cadastros recebidos do cliente (`config-integracao-1280x900.png`)
`TabelaDensa`, legenda "Dono e situação da entrada por cadastro". Os 10 cadastros da F2, na ordem do `ROTULO_ENTIDADE` do módulo de integração: Filiais, Vendedores, Formas de pagamento, Condições de pagamento, Produtos, Unidades do produto, Preços, Estoque, Clientes, Endereços de clientes.
- **Dono:** seletor com **Macuxi ERP** (padrão) e **Servidor do cliente**, `aria-label` "Dono de <cadastro>"; muda na hora de escolher, depois da confirmação abaixo. **Endereços de clientes** mostra "Segue Clientes" e **Unidades do produto** "Segue Produtos", texto de apoio, sem seletor. Elas mantêm as próprias colunas de lote, erros e situação.
- **Último lote** (data no fuso do tenant, "—" sem lote), **Erros abertos** (número, à direita), **Situação** (`Chip` com texto): "Em dia" (sucesso), "Com erros" (aviso), "Aguardando confirmação" (aviso, com o botão secundário **Revisar inativação** ao lado, que abre D), e, quando o dono é Macuxi ERP, "—" (sem Chip). Nunca só cor.
- **Confirmação da troca (`DialogoMotivo`, `semTexto`):**
  - erp para cliente. Título "Passar <Cadastro> para o servidor do cliente?"; aviso: **"Pede uma carga completa do Conector. Se ela inativar mais de 30% dos registros, a inativação fica parada até você confirmar aqui."**; confirma "Passar para o cliente", fecha "Cancelar". Para Clientes e Produtos acrescenta uma linha de apoio: "Endereços de clientes passa junto." / "Unidades do produto passa junto."
  - cliente para erp. Título "Passar <Cadastro> para o Macuxi ERP?"; aviso: **"Os registros ficam e passam a ser editáveis no BKO. O Conector deixa de poder enviar este cadastro."**; confirma "Passar para o ERP", fecha "Cancelar".
  - Nenhuma das duas é vermelha (não apaga dado). Resultado no `ResultadoAcao` (tom `sucesso`) abaixo do botão: erp para cliente com `carga_completa_pedida`: "Dono de <Cadastro> alterado. Carga completa pedida ao Conector."; sem a flag: "Dono de <Cadastro> alterado." Erro: `ResultadoAcao` tom `erro`, com o motivo.
  - **Seletor desligado** quando há `confirmacao_pendente` OU lote em andamento na entidade ou no pai. Apoio (`aria-describedby`), um por caso: pendente, "Resolva a inativação pendente antes de trocar o dono."; em andamento, "Há uma carga do servidor do cliente em andamento neste cadastro."
  - **409 `entrada_em_andamento`** (corrida: o lote começou com a tela aberta): `ResultadoAcao` tom `erro`, "Não foi possível trocar o dono: há uma carga do servidor do cliente em andamento. Tente quando ela terminar."
  - **Último lote:** "<data e hora> · <gravadas> de <recebidas>"; com `com_erro` > 0 acrescenta ", <com_erro> com erro". Sem lote: "—".

## D) Trava de 30% (`trava-30-1280x800.png`)
`Dialogo` destrutivo (`tomAviso="erro"`, vermelho do #426), título "Confirmar inativação de <Cadastro>?". O aviso usa o mesmo molde da carga de CSV (`apps/web/src/lib/config/cargas.ts`), genérico por cadastro, com o nome em minúsculas:
- "Vai inativar 18 de 40 clientes (45%) e 5 endereços." (só Clientes, com endereços)
- "Vai inativar 5 endereços e nenhum cliente."
- "Vai inativar 120 de 266 produtos (45%)." (demais cadastros)
- "Não há clientes para inativar." (nada a fazer; o botão "Inativar" fica desabilitado)

Apoio: "Confirme até <data e hora>. Depois disso, o cliente precisa enviar a carga de novo." (prazo de 7 dias, no fuso do tenant). Botões **Inativar** (`.mx-botao-destrutivo`), **Recusar lote** (secundário, `decisao: 'recusar'`, sem segunda confirmação) e **Cancelar** (foco inicial; só fecha: o lote continua "Aguardando confirmação"). Só o superadmin decide; a auditoria registra. Faixas: confirmar, "Inativação confirmada."; recusar, "Lote recusado. Nada foi inativado." 410 `confirmacao_expirada`: `AlertaBloqueante`, título "Prazo vencido", corpo "O pedido de inativação venceu. Peça ao cliente que envie a carga completa de novo pelo Conector."; a tela recarrega.

## E) BKO, só leitura (`bko-cadastro-cliente-1280x800.png`, `bko-integracao-1280x800.png`)
Rota única, só leitura: `GET /v1/cadastros/entrada/situacao`. Por cadastro: `dono`, `ultimo_lote{em, recebidas, gravadas, com_erro}`, `erros`, `confirmacao_pendente` (boolean). Sem chave, prefixo nem números da trava. O Chip e o modo só leitura vêm do `dono`.
- **Cadastro com dono cliente:** `Chip` neutro **"Vem do servidor do cliente"** ao lado do título; campos `readOnly` com `aria-readonly` (não `disabled`, para continuarem focáveis e copiáveis) e fundo pérola; sem botão Salvar nem Editar. A carga de arquivo: botão **Carregar arquivo** desabilitado, ligado por `aria-describedby` ao texto **"Indisponível: envie pelo Conector."**
- **Linha de status** abaixo do título (texto de apoio, estático, sem `role="status"`): "Último lote <dd/mm HHhMM>: <gravadas> de <recebidas> gravados" + (`com_erro` > 0) ", <com_erro> com erro". Sem lote: "Nenhum lote recebido ainda." Com erros abertos acrescenta " · <n> erros abertos"; com `confirmacao_pendente` acrescenta " · Inativação aguardando confirmação." Data no fuso do tenant; sem a palavra "superadmin" no BKO. Exemplo no print: "Último lote 24/11 05h12: 40 de 42 gravados, 2 com erro · Inativação aguardando confirmação."
- **Página Integração do BKO**, ao lado do status FDV: bloco **"Entrada do cliente"** com a tabela de C sem seletor: Cadastro, Dono (texto), Último lote, Erros abertos, Situação com os mesmos Chips ("—" quando o dono é Macuxi ERP). `confirmacao_pendente` = Chip "Aguardando confirmação", sem botão.
- **409 `dono_cliente`** (corrida: o dono mudou com a tela aberta, ou escrita por outra via): `AlertaBloqueante`, título **"Alteração não salva"**, corpo **"Este cadastro vem do servidor do cliente. Altere lá; o Conector traz a mudança."** Vale para a edição e para a carga de CSV. A tela recarrega o dono atual.

## F) Estados comuns e foco
Estados comuns e foco: como em `portal-config.md` (Telas). Lista sem dados: "Nenhum cadastro."

## G) Dúvidas para o `engenheiro-apps`
Respondidas:
1. Idempotência da geração de chave: não é idempotente; cada POST gera chave nova e invalida a anterior (ver falha de rede em A).
2. Recusar lote: existe (7 dias); botão "Recusar lote" em D.
3. Seletor de dono: desligado com `confirmacao_pendente` ou lote em andamento (entidade ou pai); textos e 409 `entrada_em_andamento` em C.
4. Rota do BKO: `GET /v1/cadastros/entrada/situacao`, só leitura; linha de status e bloco "Entrada do cliente" em E.

Abertas:
1. O ADR diz que a lista fica na coluna "via Conector"; desenhei **abaixo das duas colunas, em largura total**, porque o dono vale para as duas vias e a tabela de 5 colunas aperta em meia largura. Confirmar.
2. O comentário de `aba-integracao.tsx` fala em empilhar abaixo de 768 px; este desenho usa 900 px. Ajustar o `.integracao-colunas`.
3. A "Situação" é derivada na web? "Em dia" × "Com erros" = erros abertos zero ou não?
