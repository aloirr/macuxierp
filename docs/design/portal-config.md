# Portal de configuração `/config` (T-0050, E5)

Spec de tela do designer-ux. Contratos da E1 (ADR 0012, `packages/platform-sdk/src/portal-config.ts` e `plataforma-rotas.ts`). Componentes do `@macuxierp/ui`: `TabelaDensa`, `DialogoMotivo`, `FaixaPendencias`, `RegiaoErros`, `.mx-botao` (principal, um por tela) e `.mx-botao-secundario`, mais o `SeloPlataforma`. Texto curto: o problema e a ação.

**O superadmin nunca vê dado de negócio.** Nenhuma tela mostra pedido, cliente, nota ou usuário da empresa. Do 1º admin só aparece o estado (`ativo`, `bloqueado`); nem e-mail nem nome voltam na leitura. Sem impersonação: não existe botão "Entrar como".

## Shell "Plataforma" (PROPOSTA para o `design-de-marca` validar)
- Topo em `grafite` (`#16202A`), não azul-noite, para ninguém confundir com o ERP de uma empresa. Conteúdo sobre `perola`, como o BKO.
- Assinatura: "A negativo grafite sobre fundo grafite (§5, linha do menu lateral), aplicado ao topo do portal /config". Altura 20 a 32 px, com o `SeloPlataforma` ao lado, **fora da área de proteção da A**: fora da área de proteção (assinatura-erp §4). Ativo: só o SVG oficial `docs/marca/ativos/2026-11-22-v1/macuxi-erp-a-negativo-grafite.svg`, já em `@macuxierp/ui/marca` (`assinaturaANegativoGrafite`, com `SHA256_ASSINATURA_A_NEGATIVO_GRAFITE`); uso: `<AssinaturaErp fundo="grafite" />`. A linha nova na §5 será registrada pelo `design-de-marca` depois do "aprovo" do Alexandre, e o print do topo volta à marca antes do lote.
- Foco em fundo escuro: contêiner do topo com `.mx-fundo-escuro` (foco branco).
- Texto de tela e título: `Plataforma` em todo `<title>` e h1 de login ("Plataforma Macuxi ERP").

## SeloPlataforma
Texto "Plataforma", sem hook. Fundo transparente, borda 1px sólida `azulClaro` (`#9AA3B0`) e texto `branco`: contraste do texto **16,48:1** (mínimo 4,5:1) e da borda **6,47:1** sobre o topo grafite (mínimo 3:1). O `solClaro` não é fundo de selo (parecer da marca). Tamanho `selo` (12 px), peso 600, canto 10 px e `padding: 1px 7px`.

manter?: o canto, o tamanho e o nowrap repetem o `.selo` do shell; proposta futura: `.mx-selo` gerado no CSS do pacote, para o shell reusar.

## Telas
Estados comuns: **carregando** = texto "Carregando..." na região (sem esqueleto); **erro** = `RegiaoErros` + mensagem do problema e da ação junto do campo (MC-0015); falha de rede = "Não foi possível carregar. Tente de novo." com botão secundário "Tentar de novo". 401 volta ao login.

### 1. Login da plataforma (`/config/entrar`)
Cartão com a C positivo sobre pérola, 100 px ou mais (`<AssinaturaErp variante="C" fundo="perola" altura={100} />`), e o título "Plataforma". Campos: E-mail e Senha (`EntrarPlataformaEntrada`). Principal: "Entrar". Sem "esqueci a senha" (a recuperação é pelo operador). Separado do login da empresa: sem seletor de empresa, sem link para ele além de "Sou de uma empresa" (secundário, vai a `/login`). Erros: credencial errada, e também conta travada, sempre a mesma mensagem única "E-mail ou senha inválidos." (ADR 0012 §6: não revela se o e-mail existe nem se a conta está travada; a trava vence sozinha em 15 min); 429 `MUITAS_TENTATIVAS` "Muitas tentativas. Aguarde 15 minutos e tente de novo." Com segundo fator ligado (ADR 0012, versão seguinte): segundo passo "Código de 6 dígitos" ou de recuperação. `deve_trocar_senha`: tela única "Defina uma senha nova" com os campos "Senha provisória atual" (`senha_atual`) e "Senha nova" (`senha_nova`) (`TrocarSenhaPlataformaEntrada`, mínimo 14 caracteres: "Use ao menos 14 caracteres.").

### 2. Lista de empresas (`/config`)
h1 "Empresas". Principal: "Criar empresa". Busca por slug (filtro na URL, `?busca=`, até 80 caracteres; a lista pagina por `proximo_cursor`, com o botão "Carregar mais"). `TabelaDensa` com colunas: **Slug** (linha clicável, rótulo "Abrir empresa <slug>"), **Nome**, **Situação** (selo `ativo`/`suspenso`/`encerrado`; texto sempre junto da cor), **Módulos** (lista dos `modulos` com `ativo`, em ordem de `MODULOS`; o core não entra na lista). `referencia` nunca aparece. Vazio: "Nenhuma empresa ainda. Crie a primeira." com o botão principal. Busca sem resultado: "Nenhuma empresa com esse slug. Limpe a busca."

### 3. Criar empresa (`/config/empresas/nova`)
Campos (`CriarEmpresaEntrada`): **Slug** (obrigatório; ajuda "2 a 40 letras minúsculas, dígitos ou hífen, começando por letra ou dígito"; vira o endereço da empresa), **Nome** (2 a 120), **Fuso** (padrão `America/Manaus`). Erros do contrato, junto do campo: slug fora do padrão "Slug fora do padrão. Veja a regra acima."; slug reservado (`referencia`, `config`, `plataforma`) "Slug reservado. Escolha outro."; slug repetido (409 `CONFLITO`; o texto vem do contexto da tela) "Já existe uma empresa com esse slug. Escolha outro."; nome vazio "Informe o nome da empresa (2 a 120 caracteres)." Principal "Criar empresa"; secundário "Cancelar". Envia com Idempotency-Key (só a criação tem chave). Sucesso leva à empresa, com o aviso "Empresa criada com o core ligado. Ligue os módulos e crie o 1º administrador."

### 4. Empresa (`/config/empresas/:id`)
Cabeçalho: nome, slug, selo de situação. Blocos na ordem: **Módulos**, **1º administrador**, **Situação**. Uma ação principal por bloco só quando há o que fazer; a tela inteira não tem mais de um botão principal visível (o do bloco que falta: Módulos "Salvar módulos").

**Módulos** (`AlterarModulosEntrada`; RN-CORE-02): lista de caixas de seleção, uma por módulo de `MODULOS`. O core fica marcado e desabilitado, com o texto "Sempre ligado". Regras na tela (a API revalida e devolve 422 com `RN-CORE-02` por `modulos.<módulo>`):
- Módulo cuja dependência está desligada fica **desabilitado**, com o motivo ao lado: "Exige Cadastros", ou "Exige Fiscal e Cadastros" se faltar mais de um (motivo vem do `depende` do manifesto, nunca escrito à mão).
- Desligar um módulo de que outros dependem abre `DialogoMotivo` de confirmação (sem lista de motivos, sem texto): título "Desligar Fiscal?", corpo "Também serão desligados: Faturamento.", lista dos dependentes, `rotuloConfirmar` "Desligar", `rotuloFechar` "Manter ligado", `destrutivo`. Confirmar envia todos numa só chamada.
- "Salvar módulos" fica desabilitado sem mudança. Erro da API (422): `FaixaPendencias` bloqueante com "O módulo Faturamento exige o módulo Fiscal ligado. Ligue o Fiscal ou desligue o Faturamento."

**1º administrador** (`PrimeiroAdminEntrada`):
- Sem admin (`primeiro_admin` nulo): campos E-mail e Nome (padrão "Administrador"; 2 a 80 caracteres, `PrimeiroAdminEntrada`); principal "Criar administrador". Erro "E-mail inválido. Confira o endereço." Se a empresa já tem admin (409 `CONFLITO`, texto pelo contexto): "Esta empresa já tem administrador. Redefina a senha dele."
- Com admin: mostra só "Ativo" ou "Bloqueado" e o botão secundário "Redefinir senha" (confirma antes: `DialogoMotivo` "Redefinir a senha do administrador?", `rotuloConfirmar` "Redefinir", `rotuloFechar` "Cancelar"; zera a trava e encerra as sessões dele).
- **Senha provisória exibida UMA vez** (criação e redefinição, `PrimeiroAdminResposta`): painel destacado logo abaixo do botão, com a senha em fonte de código (`--mx-fonte-codigo`), botão "Copiar" (confirma com "Copiado" em região `role="status"`) e o aviso fixo: **"Esta senha não volta a aparecer. Entregue ao administrador por canal seguro."** O painel fica até a pessoa sair da tela ou clicar "Já entreguei"; ao sair, a senha some da memória da tela. Nunca vai à URL, ao armazenamento do navegador, a log nem a recado; a resposta traz `cache-control: no-store`. Reenvio da mesma Idempotency-Key na criação da empresa não mostra a senha: "A senha já foi exibida. Redefina para gerar outra." O `POST …/primeiro-admin/senha` não tem chave.

**Situação** (`SituacaoEmpresaEntrada`): botão secundário "Suspender empresa" (ativa) ou "Reativar empresa" (suspensa). Abre `DialogoMotivo`: título "Suspender <nome>?" ou "Reativar <nome>?"; texto obrigatório "Motivo" (3 a 200 caracteres; erro "Informe o motivo (3 a 200 caracteres)."); **`aviso` fixo: "Não escreva dado pessoal no motivo: ele fica registrado na auditoria."**; suspender é `destrutivo`, `rotuloConfirmar` "Suspender", `rotuloFechar` "Manter ativa"; reativar "Reativar" e "Cancelar". Efeito escrito no diálogo: "Os usuários da empresa deixam de entrar." (suspender). Encerrar não existe no portal na v0.3.0.

## Acessibilidade e texto
- Uma `RegiaoErros` por tela (região única, sem `role="alert"`); Erro de campo: MC-0015 (componentes-pedido.md).
- Foco volta ao botão que abriu o diálogo; o painel da senha recebe foco ao aparecer.
- Estado nunca só por cor: "Ativo", "Suspenso", "Bloqueado" em texto.
- Textos sem sigla de regra na tela (`RN-CORE-02` só em `data-regra`).
