/**
 * Log do cadastro no BKO (T-0086 §4, D-4) como dados e funções puras: o shell (`apps/web`) lê
 * `GET /v1/integracao-fdv/entidades/:entidade/log` e desenha com `packages/ui` (TabelaDensa, Chip, Botao). Aqui ficam as
 * colunas (registro, nome curto, campo, motivo, ação e "Corrigir"), os textos dos estados e o caminho do CSV. Motivo e ação
 * vêm do catálogo da API (voz A0), nunca da mensagem do Hub. A permissão só esconde botão: a proteção real é a da API.
 */
import { CAMINHOS_INTEGRACAO_FDV_TENANT, type ClienteRecebidoFdv, type EnvioLogFdv, type EntidadeEnvioFdv, type LogCadastroFdvTenant, type OrigemEnvioFdv } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { paraCsv, type ColunaCsv } from '@macuxierp/platform-sdk/listas';
import { motivoDaRecusaCliente } from '../domain/recebidos-log';
import { FUSO_PADRAO } from './monitor';
import { ROTULO_RETORNO_CLIENTE, ROTULO_SITUACAO_CLIENTE_RECEBIDO, TEXTO_SEM_VALOR } from './rotulos';

/** Textos dos três estados da tela (voz A0: frase curta, sem jargão, diz o que fazer). */
export const TEXTO_ESTADO_LOG = Object.freeze({
  carregando: 'Carregando o Log…',
  vazio: 'Nenhum erro aberto neste cadastro.',
  vazioEnvios: 'Nenhum envio ainda.',
  erro: 'Não foi possível carregar o Log. Tente de novo.',
});

export const ROTULO_BAIXAR_ERROS = 'Baixar erros (.csv)';
export const ROTULO_CORRIGIR = 'Corrigir cadastro';

/** Legenda da seção de erros do Log: o registro com erro não chegou ao FDV. */
export const TEXTO_LEGENDA_ERROS_LOG = 'Estes registros não foram enviados ao FDV.';

/* TODO: fonte única dos rótulos e cores de origem e situação no packages/platform-sdk (pedido ao engenheiro-software);
   até lá estas cópias seguem as cores de apps/web/src/lib/config/operacao-fdv.ts (ROTULO_ORIGEM_ENVIO e ROTULO_SITUACAO_ENVIO). */
export const ROTULO_ORIGEM_LOG: Readonly<Record<OrigemEnvioFdv, string>> = { ciclo: 'Ciclo normal', reprocessar: 'Reprocessar', zerar: 'Zerar (inativação)' };
export const ROTULO_SITUACAO_LOG: Readonly<Record<EnvioLogFdv['situacao'], { texto: string; tom: 'sucesso' | 'aviso' | 'erro' | 'neutro' }>> = {
  enviando: { texto: 'Enviando…', tom: 'neutro' },
  concluido: { texto: 'Concluído', tom: 'sucesso' },
  com_erros: { texto: 'Com erros', tom: 'aviso' },
  falhou: { texto: 'Falhou', tom: 'erro' },
};

export interface LinhaErroLog {
  registro: string;
  nome: string;
  campo: string;
  motivo: string;
  acao: string;
  /** Tela do cadastro no BKO; nulo quando o registro foi apagado (Zerar): a tela não mostra o link. */
  corrigirHref: string | null;
}

export interface LinhaEnvioLog {
  quando: string;
  origem: string;
  situacao: string;
  tom: 'sucesso' | 'aviso' | 'erro' | 'neutro';
  registros: number;
  comErro: number;
}

export const linhasDeErrosLog = (l: LogCadastroFdvTenant): LinhaErroLog[] =>
  l.erros.map((e) => ({ registro: e.registro_external_id, nome: e.nome_curto ?? '', campo: e.campo ?? '', motivo: e.motivo_texto, acao: e.acao_texto, corrigirHref: e.corrigir_href }));

export const linhasDeEnviosLog = (l: LogCadastroFdvTenant, fuso: string = FUSO_PADRAO): LinhaEnvioLog[] =>
  l.envios.map((e) => ({ quando: formatarDataHora(e.em, fuso), origem: ROTULO_ORIGEM_LOG[e.origem], situacao: ROTULO_SITUACAO_LOG[e.situacao].texto, tom: ROTULO_SITUACAO_LOG[e.situacao].tom, registros: e.registros, comErro: e.com_erro }));

export interface ColunaLog {
  id: keyof LinhaErroLog;
  titulo: string;
}

/** Colunas da tabela de erros, na ordem da tela; "Corrigir" é a última e só tem link quando `corrigirHref` existe. */
export const colunasDeErrosLog: readonly ColunaLog[] = [
  { id: 'registro', titulo: 'Registro' },
  { id: 'nome', titulo: 'Nome' },
  { id: 'campo', titulo: 'Campo' },
  { id: 'motivo', titulo: 'Motivo' },
  { id: 'acao', titulo: 'O que fazer' },
  { id: 'corrigirHref', titulo: ROTULO_CORRIGIR },
];

/** Erros abertos que a lista não mostra (o teto da tela); o resto vem no CSV. */
export const errosForaDaListaLog = (l: LogCadastroFdvTenant): number => Math.max(0, l.total_erros - l.erros.length);

export const textoErrosForaDaLista = (n: number): string => (n === 1 ? 'Mais 1 erro não aparece aqui. Baixe o arquivo para ver todos.' : `Mais ${n} erros não aparecem aqui. Baixe o arquivo para ver todos.`);

/** Caminho do CSV do cadastro (relativo à origem da API, com `/v1`); o navegador baixa direto e a API aplica o perfil. */
export const caminhoDoLogCsv = (entidade: EntidadeEnvioFdv): string =>
  `/v1${CAMINHOS_INTEGRACAO_FDV_TENANT.logCsv.replace(':entidade', encodeURIComponent(entidade))}`;

export const nomeDoCsvDoLog = (entidade: EntidadeEnvioFdv): string => `erros-${entidade}.csv`;

// ---- Recebidos do FDV (RN-INF-09; T-0110): pré-cadastros aceitos, recusados e reenviados. Documento só mascarado (LGPD). ----

export const TITULO_SECAO_RECEBIDOS_LOG = 'Recebidos do FDV';
export const TEXTO_VAZIO_RECEBIDOS_LOG = 'Nenhum pré-cadastro recebido ainda.';
export const NOME_CSV_RECEBIDOS_LOG = 'recebidos-fdv.csv';

export interface LinhaRecebidoLog {
  situacao: string;
  cliente: string;
  documento: string;
  vendedor: string;
  recebidoEm: string;
  revisao: number;
  /** Motivo legível da recusa pelo catálogo (vendedor inexistente ou inativo, por exemplo); vazio se não recusado. */
  motivo: string;
  retorno: string;
}

/** Motivo da linha: nos erros por campo, o texto do catálogo pelo código; recusado sem erro, o genérico. Nunca o texto cru do FDV. */
export const motivoDoRecebidoLog = (c: ClienteRecebidoFdv): string => {
  if (c.situacao !== 'recusado') return '';
  return c.erros.length > 0 ? [...new Set(c.erros.map((e) => motivoDaRecusaCliente(e.codigo)))].join(' ') : motivoDaRecusaCliente(null);
};

export const linhasDeRecebidosLog = (recebidos: readonly ClienteRecebidoFdv[], fuso: string = FUSO_PADRAO): LinhaRecebidoLog[] =>
  recebidos.map((c) => ({
    situacao: ROTULO_SITUACAO_CLIENTE_RECEBIDO[c.situacao],
    cliente: c.razao_social,
    documento: c.documento_mascarado ?? TEXTO_SEM_VALOR,
    vendedor: c.vendedor_external_id ?? TEXTO_SEM_VALOR,
    recebidoEm: formatarDataHora(c.recebido_em, fuso),
    revisao: c.revisao,
    motivo: motivoDoRecebidoLog(c),
    retorno: c.retorno ? ROTULO_RETORNO_CLIENTE[c.retorno] : '',
  }));

export const colunasDeRecebidosLog: readonly { id: keyof LinhaRecebidoLog; titulo: string }[] = [
  { id: 'situacao', titulo: 'Situação' },
  { id: 'cliente', titulo: 'Cliente' },
  { id: 'documento', titulo: 'Documento' },
  { id: 'vendedor', titulo: 'Vendedor' },
  { id: 'recebidoEm', titulo: 'Recebido em' },
  { id: 'revisao', titulo: 'Revisão' },
  { id: 'motivo', titulo: 'Motivo' },
  { id: 'retorno', titulo: 'Retorno' },
];

/** CSV dos recebidos: as mesmas colunas e textos da tela, com a data no fuso do tenant. */
export const csvDeRecebidosLog = (recebidos: readonly ClienteRecebidoFdv[], fuso: string = FUSO_PADRAO): string => {
  const colunas: readonly ColunaCsv<LinhaRecebidoLog>[] = colunasDeRecebidosLog.map((c) => ({ titulo: c.titulo, valor: (l) => l[c.id] }));
  return paraCsv(colunas, linhasDeRecebidosLog(recebidos, fuso));
};
