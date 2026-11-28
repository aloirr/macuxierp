/**
 * Descritores de tela do shell (T-0015). O renderizador genérico só conhece estes tipos: cada módulo adapta os descritores
 * dele (`modules/<m>/web`) para eles em `apps/web/src/lib/telas/<modulo>.ts`. Parte pura, segura para 'use client'.
 * Sem dado pessoal em log; horários em texto para pessoas saem no fuso do tenant (Manaus).
 */
import type { Acao, Perfil, PaginaLista } from '@macuxierp/platform-sdk';
import type { ItemLinha } from '@macuxierp/ui';
import type { ZodTypeAny } from 'zod';

/** Fonte de opções de seletor (cliente, vendedor, filial, condição, produto): caminho da lista no cadastros (`/v1/cadastros/clientes`). */
export type FonteOpcoes = string;

export interface FiltroTela {
  /** Chave da URL e da consulta da API (a mesma do `filtros` do `PaginaLista`, ou `busca`). */
  chave: string;
  rotulo: string;
  tipo: 'texto' | 'data' | 'selecao' | 'cadastro';
  /** Dica de largura na linha de filtros, em colunas da grade de 12 (1 a 12). Opcional: sem ela o shell reparte a linha. */
  colunas?: number;
  /** `selecao`: valores fixos (ex.: status). */
  opcoes?: readonly { valor: string; rotulo: string }[];
  /** `cadastro`: de onde ler as opções (cadastros). */
  fonte?: FonteOpcoes;
  /** `data` que a API recebe como instante (ISO completo): o dia civil vira o início ou o fim do dia no fuso do tenant (ex.: `de` e `ate` da auditoria). */
  instante?: 'inicio' | 'fim';
  /** `selecao`: texto da opção em branco, quando "Todos" não serve (ex.: "Só ativos"). */
  vazio?: string;
}

export type Linha = Readonly<Record<string, unknown>>;

/** Selo de célula ou de título (tom do módulo já mapeado para as classes do shell); `dica` vira o tooltip. */
export interface SeloVista { texto: string; tom: 'ok' | 'aviso' | 'erro' | 'neutro'; dica?: string }
/** Escrita que a tela pode fazer: método e caminho (com `:id` onde o UUID do registro entra). O servidor só aceita as declaradas. */
export type Escrita = {
  metodo: AcaoVista['metodo'];
  caminho: string;
  /** Campo da resposta que vale uma vez só (senha provisória, RN-CORE-10): o shell o mostra uma única vez e não o guarda. */
  segredo?: string;
};

/** Leitura (GET) que o diálogo de uma ação pode pedir ao servidor: `caminho` com `:id` (UUID) e o schema que valida a resposta (fica no servidor). */
export interface Leitura { caminho: string; schema: ZodTypeAny }
/** Item do diálogo de nota parcial, já em texto para pessoas: `descricao` é a crua do pedido ('' se não houver; vai ao `formularioParcial`) e `rotulo` o texto da tela ("1 - Café…"); `saldo` em qtd4 (10000 = 1 un). */
export interface ItemDoDialogo { sequencia: number; descricao: string; rotulo: string; saldo: number; saldoTexto: string; saldoCampo: string }
/** Item do diálogo de nota parcial com a quantidade que a pessoa digitou (texto pt-BR). */
export interface ItemEscolhido { sequencia: number; descricao: string; saldo: number; quantidade: string }
export type AmbienteVista = { texto: string; tom: 'neutro' | 'alerta' | 'ok' | 'erro' };

/** O que toda tela com ações declara: a validação do diálogo (e o corpo), as escritas permitidas e o gerador da Idempotency-Key. */
export interface ExecutorDeAcoes {
  /** Validação do diálogo da ação e corpo do envio, pela regra do módulo (a API revalida). */
  validarAcao: (acao: AcaoVista, entrada: EntradaAcao) => ResultadoAcao;
  /** Escritas que esta tela pode fazer; `:id` (e `:baixa_id`) é o UUID do registro. O servidor só aceita estas. */
  escritas: readonly Escrita[];
  /** Gera a Idempotency-Key. */
  novaChave: () => string;
  /** Leituras (GET) que os diálogos das ações podem pedir; o servidor só atende as declaradas. */
  leituras?: readonly Leitura[];
  /** Itens do diálogo (entrada `itens`) a partir da resposta da leitura da ação. */
  itensDaLeitura?: (dados: unknown) => readonly ItemDoDialogo[];
  /** Linha "Ambiente" a partir da resposta de `ambientePorFilial` (null = filial sem configuração legível). */
  ambienteDaLeitura?: (dados: unknown) => AmbienteVista | null;
}

/** Ação da barra da lista (não é de uma linha): ex.: "Inutilizar números" na lista de notas. */
export interface AcaoDaBarra extends ExecutorDeAcoes {
  acao: (perfil: Perfil) => AcaoVista | null;
}

/** Ação por linha (ex.: "Emitir nota" no pedido a faturar), já filtrada por perfil e status pelo módulo. */
export interface AcaoDaLinha extends ExecutorDeAcoes {
  acao: (linha: Linha, perfil: Perfil) => AcaoVista | null;
  /** Outras ações da mesma linha (ex.: "Emitir nota parcial"), depois da principal. */
  maisAcoes?: (linha: Linha, perfil: Perfil) => readonly AcaoVista[];
}

/** Arquivo para baixar pelo proxy do shell (XML e DANFE): `href` é caminho da API; `desabilitado` traz o motivo. */
export type DownloadVista = { rotulo: string; href: string; desabilitado?: string; principal?: boolean };

export interface TelaLista {
  tipo: 'lista';
  pagina: PaginaLista;
  filtrosTela: readonly FiltroTela[];
  /** Colunas da tabela para o perfil (id e título). */
  colunas: (perfil: Perfil, fuso: string) => readonly { id: string; rotulo: string; tipo?: 'texto' | 'numero' | 'dinheiro' | 'data' | 'status' }[];
  /** Linha pronta para exibir (texto por id de coluna), no fuso do tenant. */
  linha: (item: Linha, fuso: string) => Readonly<Record<string, string>>;
  /** Botão "Novo", quando houver; some se o perfil não puder `criar`. */
  novo?: { rota: string; rotulo: string; criar?: Acao };
  /** Rota do detalhe de uma linha. */
  rotaDaLinha?: (linha: Linha) => string;
  /** Rótulo acessível da linha clicável (ex.: "Abrir pedido 123"). */
  rotuloDaLinha?: (linha: Linha) => string;
  /** Rótulo do campo `busca` (a página aceita `busca`). */
  rotuloBusca?: string;
  /** Selos por coluna (ex.: ambiente de homologação); a coluna sem selo mostra o texto de `linha`. */
  selos?: (item: Linha, fuso: string) => Readonly<Record<string, readonly SeloVista[]>>;
  /** Ação na barra da lista, ao lado do "Exportar CSV". */
  acaoDaBarra?: AcaoDaBarra;
  /** Ação por linha. */
  acaoDaLinha?: AcaoDaLinha;
}

/** `linhaInteira`: o campo ocupa a linha toda da grade (valores longos, como a chave de acesso); `numerico`: números tabulares. */
export interface CampoVista { rotulo: string; valor: string; linhaInteira?: boolean; numerico?: boolean }
export interface ColunaVista { id: string; rotulo: string; numerica?: boolean; tipo?: 'texto' | 'numero' | 'dinheiro' | 'data' | 'status'; /** Largura mínima da coluna (ex.: '3rem'). */ largura?: string }
export interface TabelaVista { titulo: string; colunas: readonly ColunaVista[]; linhas: readonly Readonly<Record<string, string>>[] }
/** Pendência para a faixa da ui: `codigoRn` e texto vêm do módulo. */
export interface PendenciaVista { texto: string; bloqueante: boolean; codigoRn: string }
export interface EventoVista { quando: string; texto: string }

/** Campo do diálogo de edição (`entrada: 'campos'`): `valor` é o valor atual do registro. */
export interface CampoDialogo { nome: string; rotulo: string; tipo: 'texto' | 'selecao'; valor: string; opcoes?: readonly { valor: string; rotulo: string }[] }

/** Ação do detalhe, já filtrada por perfil e status pelo módulo. Só dados: a validação do diálogo é `TelaDetalhe.validarAcao`. */
export interface AcaoVista {
  id: string;
  rotulo: string;
  metodo: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Caminho na API, `/v1/<modulo>/...`; tem de casar com um de `TelaDetalhe.escritas`. */
  caminho: string;
  /**
   * `justificativa`: texto livre (aprovar com pendência não bloqueante); `motivo`: diálogo com catálogo; `nenhum`: envia direto;
   * `confirmar`: diálogo só de confirmação (título e aviso do módulo); `baixa`: valor em reais e data (baixa de título);
   * `faixa`: filial, número inicial, número final e justificativa (inutilizar números);
   * `itens`: carrega os itens de `leitura` e pede uma quantidade por item (nota parcial);
   * `campos`: formulário curto de edição com os `campos` do módulo (texto e seleção), já com o valor atual.
   */
  entrada: 'nenhum' | 'justificativa' | 'motivo' | 'confirmar' | 'baixa' | 'faixa' | 'itens' | 'campos';
  /** Em `campos`: o que a pessoa edita no diálogo. */
  campos?: readonly CampoDialogo[];
  /** Aviso que acompanha o valor de uso único da resposta (a escrita declara `segredo`): ex.: "Anote esta senha agora". */
  avisoSegredo?: string;
  /** Em `itens`: caminho GET (UUID já preenchido) dos itens do registro. */
  leitura?: string;
  /** Em `faixa`: modelo GET com `:id` = filial escolhida (ex.: `/v1/faturamento/filiais/:id/configuracao`) para a linha de ambiente. */
  ambientePorFilial?: string;
  /** Botão que fecha o diálogo sem agir (ex.: "Manter a nota"); sem ele, "Cancelar". */
  rotuloFechar?: string;
  /** Ação que não se desfaz. Na v1 não muda a cor (o vermelho fica para a próxima versão): o botão de confirmar usa o estilo principal e o texto explícito da ação. */
  destrutivo?: boolean;
  /** Em `faixa`: filiais para escolher (preenchidas pela lista a partir do cadastro). */
  filiais?: readonly { valor: string; rotulo: string }[];
  /** Título do diálogo, quando difere do rótulo do botão (ex.: "Cancelar a nota 12/1?"). */
  tituloDialogo?: string;
  /** Rótulo do campo de texto, quando difere de "Justificativa" (ex.: "Texto da correção"). */
  rotuloTexto?: string;
  /** Rótulo do botão de confirmar do diálogo (ex.: "Cancelar a nota"). */
  rotuloConfirmar?: string;
  /** Texto do botão enquanto a API responde (ex.: "Emitindo…"). */
  textoCarregando?: string;
  /** Em `baixa`: saldo em texto (R$), valor inicial e a data de hoje no fuso do tenant (AAAA-MM-DD). */
  baixa?: { saldo: string; valorInicial: string; hoje: string };
  /** Em `justificativa`: o texto é obrigatório? (dado do módulo) */
  justificativaObrigatoria?: boolean;
  /** Em `motivo`: catálogo (`GET /motivos`) já resolvido. */
  motivos?: readonly { codigo: string; rotulo: string }[];
  /** Aviso fixo do módulo a mostrar no diálogo (ex.: LGPD do texto livre). */
  aviso?: string;
  /** Linha "Ambiente: ..." das confirmações fiscais (RN-FAT-04); `alerta` em produção ou quando o ambiente é desconhecido. */
  ambiente?: { texto: string; tom: 'neutro' | 'alerta' | 'ok' | 'erro' };
  /** Limites do texto (cancelar, CC-e, inutilizar): mostra o contador do módulo abaixo do campo. */
  limitesTexto?: { min: number; max: number };
  /** Ação que só navega (ex.: "Editar" abre a tela de edição): o clique leva a esta rota, sem diálogo nem escrita. */
  rota?: string;
  /** Botão visível porém desabilitado, com o motivo (ex.: aprovar com pendência bloqueante). */
  desabilitada?: string;
  /** Ação principal da tela (uma só): as demais saem como botão secundário. */
  principal?: boolean;
  /** Versão do registro (If-Match). */
  versao?: string;
  /** Dados do registro (ids, saldo) que o módulo usa para validar e montar o corpo; o shell só os repassa. */
  dados?: Readonly<Record<string, string>>;
}

/** O que a pessoa informou no diálogo. */
export interface EntradaAcao {
  motivo?: string;
  texto: string;
  /** Em `baixa`: valor digitado em reais e a data civil. */
  valor?: string;
  data?: string;
  /** Em `faixa`: filial e números digitados. */
  filial?: string;
  inicial?: string;
  final?: string;
  /** Em `campos`: valor digitado por nome de campo. */
  campos?: Readonly<Record<string, string>>;
  /** Em `itens`: quantidade digitada por item (texto pt-BR) e o saldo (qtd4) que o diálogo mostrou. */
  itens?: readonly ItemEscolhido[];
  /** Idempotency-Key da tentativa, para o módulo montar corpos que a levam (ex.: emitir). Na validação do diálogo pode faltar. */
  chave?: string;
}
/** Erro de um campo em partes: `mensagem` pronta para aparecer sozinha na tela (o texto inteiro, para o leitor de tela, vem em `erros`). */
export type ErroEmPartes = { rotulo: string; mensagem: string };
/** Resultado da validação do módulo: corpo pronto para a API ou a mensagem de erro (regra e texto do módulo). */
export type ResultadoAcao = { ok: true; corpo?: unknown } | { ok: false; erro: string; /** Erro por campo (chave = sequência do item), para mostrar junto do campo; sem ele, `erro` é geral. */ erros?: Readonly<Record<number, string>>; /** Mesmo erro em partes (do módulo): `mensagem` pronta para aparecer sozinha; a tela mostra só a `mensagem`. */ errosPartes?: Readonly<Record<number, ErroEmPartes>> };

export interface DetalheVista {
  titulo: string;
  selo?: SeloVista;
  cabecalho: readonly CampoVista[];
  tabelas: readonly TabelaVista[];
  pendencias: readonly PendenciaVista[];
  /** Ausente = a tela não mostra a seção (o módulo ainda não traz eventos). */
  historico?: readonly EventoVista[];
  /** Faixa fixa no topo do detalhe (ex.: nota de homologação, sem valor fiscal). */
  faixa?: string;
  /** Arquivos do registro (XML e DANFE), pelo proxy do shell. */
  downloads?: readonly DownloadVista[];
  /** Quem decidiu, quando e por quê (texto já em Manaus). */
  decisao?: readonly CampoVista[];
  acoes: readonly AcaoVista[];
}

export interface TelaDetalhe extends ExecutorDeAcoes {
  tipo: 'detalhe';
  /** Caminho GET do registro. */
  api: (id: string) => string;
  /** Monta a vista a partir da resposta já validada (`ler`), do perfil e do fuso do tenant. `motivos` é o corpo do catálogo. */
  montar: (dados: unknown, perfil: Perfil, fuso: string, motivos: unknown, eventos?: unknown) => DetalheVista;
  /** Parse da resposta da API (Zod `.parse`). */
  ler: (corpo: unknown) => unknown;
  /** Catálogo de motivos (`GET`), quando houver ação com motivo. */
  motivosApi?: string;
  /** Histórico em endpoint próprio (`GET`), quando o detalhe não o traz (nota: `/notas/:id/eventos`). Acessório: se falhar, o detalhe abre sem a seção. */
  eventosApi?: (id: string) => string;
  /** Parse da resposta de `eventosApi` (Zod `.parse`). */
  lerEventos?: (corpo: unknown) => unknown;
  /** Rota de volta para a lista. */
  voltar: string;
}

export type TipoCampo = 'texto' | 'area' | 'data' | 'numero' | 'selecao' | 'cadastro';
/** Colunas permitidas por campo na grade de 12. */
export type ColunasCampo = 1 | 2 | 3 | 4 | 6 | 8 | 12;
export interface CampoFormulario {
  nome: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio?: boolean;
  fonte?: FonteOpcoes;
  opcoes?: readonly { valor: string; rotulo: string }[];
  ajuda?: string;
  /** Largura do campo na grade de 12 colunas do formulário (regra 11). Ausente = a heurística de larguraDoCampo. */
  colunas?: ColunasCampo;
  /** Largura que depende do que foi digitado (ex.: IPI da Filial ocupa 6 com CRT ≠ 3, quando o vizinho some); sem ela vale `colunas`. Roda no navegador a cada digitação. */
  colunasSe?: (valores: Readonly<Record<string, string>>) => ColunasCampo;
  /** Começa linha nova na grade (coluna 1), mesmo que a linha anterior tenha sobra (ex.: CEP quando o PIS/COFINS some). Ausente = segue o fluxo. */
  inicioLinha?: boolean;
  /** Mostra o campo só quando a condição vale (ex.: regime de PIS/COFINS só com CRT 3). É função: roda no navegador, nunca atravessa do servidor como dado. */
  mostrarSe?: (valores: Readonly<Record<string, string>>) => boolean;
}
export type ValoresFormulario = Readonly<Record<string, string>>;
/** Linha de itens em texto digitado, no formato do módulo. */
export interface ItemFormulario { produto_id: string; quantidade: string; preco: string; desconto?: string }
export type ErrosFormulario = Readonly<Record<string, string>>;

export interface TelaFormulario {
  tipo: 'formulario';
  campos: readonly CampoFormulario[];
  /** Itens (produto, quantidade, preço): ausente = formulário sem itens. */
  itens?: {
    fonte: FonteOpcoes;
    rotuloProduto: string;
    /** Linha vazia da tela (a chave é local). */
    novoItem: (chave: string) => ItemLinha;
    /** Total da linha em centavos, pela regra do módulo. */
    calcularTotal: (item: ItemLinha) => number;
    /** Mensagem de campo quando a linha tem valor que o cálculo não aceita (ex.: fora do inteiro seguro); null = ok. */
    erroItem?: (item: ItemLinha) => string | null;
    /** Linha da tela para o texto que o módulo valida. */
    paraTexto: (item: ItemLinha) => ItemFormulario;
    /** Inverso de `paraTexto`: linha da tela a partir do texto do módulo (abre a edição com os itens preenchidos). */
    daTexto?: (item: ItemFormulario, chave: string) => ItemLinha;
    formatarCentavos: (centavos: number) => string;
    /** Total do pedido já formatado, pela regra do módulo, mostrado acima do botão de envio. */
    totalTexto?: (itens: readonly ItemFormulario[]) => string;
  };
  /** Campos que dependem do perfil (ex.: limite de crédito só a quem tem a ação): quando presente, vale no lugar de `campos`. A API revalida. */
  camposDoPerfil?: (perfil: Perfil) => readonly CampoFormulario[];
  /** Validação local (a API sempre revalida). Devolve erros por campo (`itens` = erro geral dos itens). `perfil` vem do shell. */
  validar: (valores: ValoresFormulario, itens: readonly ItemFormulario[], perfil?: Perfil) => ErrosFormulario;
  /** Corpo do POST, a partir dos valores. */
  montar: (valores: ValoresFormulario, itens: readonly ItemFormulario[], perfil?: Perfil) => unknown;
  /**
   * Edição do registro em `api/:id`: a tela abre com os valores do registro. Por padrão envia `PATCH` só com o que mudou; com
   * `metodo: 'PUT'` envia o corpo inteiro de `montar`, com `If-Match` = `versao` do registro aberto. Ausente = formulário de criação.
   */
  edicao?: {
    /** Padrão `PATCH`. `PUT` troca o corpo inteiro (de `montar`) e leva a `versao` no `If-Match`. */
    metodo?: 'PATCH' | 'PUT';
    /** Rota para onde Cancelar volta, a partir do id; ausente = `voltar`. */
    voltarPara?: (id: string) => string;
    /** Texto do botão que recarrega o registro quando a versão ficou velha (`falha(...).recarregar`). */
    rotuloRecarregar?: string;
    /** Falha do envio em texto para a tela e se ela oferece recarregar. Ausente = a mensagem da API. */
    falha?: (r: { status?: number; codigo?: string; mensagem: string; desatualizado?: boolean }) => { mensagem: string; recarregar: boolean };
    /** Caminho GET do registro. */
    ler: (id: string) => string;
    /** Valores iniciais e o registro original (para o diff), a partir da resposta da API. */
    abrir: (corpo: unknown) => { valores: ValoresFormulario; original: unknown; /** `If-Match` do `PUT`. */ versao?: string; /** Itens do registro, em texto do módulo. */ itens?: readonly ItemFormulario[] };
    /** Corpo do PATCH com só o que mudou; `null` = nada mudou (nada a enviar). */
    montarPatch: (valores: ValoresFormulario, original: unknown, perfil: Perfil) => unknown | null;
  };
  /** POST de criação. */
  api: string;
  /** Campo da resposta do POST que vale uma vez só (senha provisória): a tela o mostra antes de seguir. */
  segredo?: string;
  /** Aviso mostrado junto do `segredo` (RN-CORE-10). */
  avisoSegredo?: string;
  /** Rota do detalhe, a partir do `id` devolvido pela API. */
  depois: (id: string) => string;
  voltar: string;
  enviar: string;
  /** Gera a Idempotency-Key. */
  novaChave: () => string;
}

/**
 * Página com componente próprio (quadro de perfis, ambiente fiscal, bandeira por filial): não é lista, detalhe nem formulário, mas
 * pode ter ações (a bandeira liga e desliga) que passam pelo mesmo executor, com validação do módulo e Idempotency-Key.
 */
export interface TelaQuadro extends ExecutorDeAcoes {
  tipo: 'quadro';
}

export type TelaDescrita = TelaLista | TelaDetalhe | TelaFormulario | TelaQuadro;
