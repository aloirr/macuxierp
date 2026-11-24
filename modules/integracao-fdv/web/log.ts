/**
 * Log do cadastro no BKO (T-0086 §4, D-4) como dados e funções puras: o shell (`apps/web`) lê
 * `GET /v1/integracao-fdv/entidades/:entidade/log` e desenha com `packages/ui` (TabelaDensa, Chip, Botao). Aqui ficam as
 * colunas (registro, nome curto, campo, motivo, ação e "Corrigir"), os textos dos estados e o caminho do CSV. Motivo e ação
 * vêm do catálogo da API (voz A0), nunca da mensagem do Hub. A permissão só esconde botão: a proteção real é a da API.
 */
import type { EnvioLogFdv, EntidadeEnvioFdv, LogCadastroFdvTenant, OrigemEnvioFdv } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import { FUSO_PADRAO } from './monitor';

/** Textos dos três estados da tela (voz A0: frase curta, sem jargão, diz o que fazer). */
export const TEXTO_ESTADO_LOG = Object.freeze({
  carregando: 'Carregando o Log…',
  vazio: 'Nenhum erro aberto neste cadastro.',
  vazioEnvios: 'Nenhum envio ainda.',
  erro: 'Não foi possível carregar o Log. Tente de novo.',
  semPermissao: 'Você não tem permissão para ver o Log.',
});

export const ROTULO_BAIXAR_ERROS = 'Baixar erros (.csv)';
export const ROTULO_CORRIGIR = 'Corrigir';

export const ROTULO_ORIGEM_LOG: Readonly<Record<OrigemEnvioFdv, string>> = { ciclo: 'Ciclo normal', reprocessar: 'Reprocessar', zerar: 'Zerar (inativação)' };
export const ROTULO_SITUACAO_LOG: Readonly<Record<EnvioLogFdv['situacao'], { texto: string; tom: 'ok' | 'aviso' | 'neutro' }>> = {
  enviando: { texto: 'Enviando…', tom: 'neutro' },
  concluido: { texto: 'Concluído', tom: 'ok' },
  com_erros: { texto: 'Com erros', tom: 'aviso' },
  falhou: { texto: 'Falhou', tom: 'aviso' },
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
  tom: 'ok' | 'aviso' | 'neutro';
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
  `/v1/integracao-fdv/entidades/${encodeURIComponent(entidade)}/log.csv`;

export const nomeDoCsvDoLog = (entidade: EntidadeEnvioFdv): string => `erros-${entidade}.csv`;
