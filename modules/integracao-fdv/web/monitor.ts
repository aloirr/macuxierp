/**
 * Tela "Integração FDV" do BKO como dados e funções puras (RF-INF-04 e RF-INF-05): o shell (`apps/web`) lê `GET /monitor`,
 * desenha as seções e chama as ações pelo `cliente.ts`. Aqui ficam os textos (curtos, sem jargão), o horário de Manaus, o
 * que cada perfil vê e a validação dos formulários; a API revalida tudo (a proteção real é a dela). A chave do conector nunca
 * passa por aqui depois do envio: o monitor só devolve o prefixo.
 */
import { pode, type Perfil } from '@macuxierp/platform-sdk';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import type { ColunaCsv } from '@macuxierp/platform-sdk/listas';
import { CredencialEntrada, ConfiguracaoEntrada, type EntidadeHub, type MonitorResposta } from '../contracts';
import { MENSAGEM_ENTIDADES_HABILITADAS, MENSAGEM_LIMITE_LOTE, validarConfiguracao } from '../domain/configuracao';
import { ROTULO_AMBIENTE, ROTULO_ENTIDADE } from './rotulos';

export const FUSO_PADRAO = 'America/Manaus';
const SEM_ENVIO = 'Ainda não enviou';

const hora = (iso: string | null, fuso: string, vazio = SEM_ENVIO): string => (iso ? formatarDataHora(iso, fuso) : vazio);

export interface AcoesDaTela {
  /** Vê o monitor, os envios e os erros. */
  ver: boolean;
  /** Mexe na configuração (trocar a credencial, testar, carga completa, tentar de novo): só o administrador. */
  configurar: boolean;
}

/** Só esconde botão: a API checa o perfil de novo em cada rota. */
export function acoesDaTela(perfil: Perfil): AcoesDaTela {
  return { ver: pode(perfil, 'integracao-fdv.ver'), configurar: pode(perfil, 'integracao-fdv.configurar') };
}

export interface LinhaMonitor {
  entidade: EntidadeHub;
  rotulo: string;
  situacao: 'Funcionando' | 'Pausada' | 'Desligada';
  tom: 'ok' | 'aviso' | 'neutro';
  ultimoEnvio: string;
  ultimoSucesso: string;
  pendentes: string;
  erros: number;
  /** Texto do catálogo para o motivo da pausa; vazio se não está pausada. */
  motivoPausa: string;
  podeRetomar: boolean;
  podeCargaCompleta: boolean;
}

export function linhasDoMonitor(m: MonitorResposta, perfil: Perfil, fuso: string = FUSO_PADRAO): LinhaMonitor[] {
  const acoes = acoesDaTela(perfil);
  return m.entidades.map((e) => {
    const pausada = e.situacao === 'pausada';
    return {
      entidade: e.entidade,
      rotulo: ROTULO_ENTIDADE[e.entidade],
      situacao: !e.habilitada ? 'Desligada' : pausada ? 'Pausada' : 'Funcionando',
      tom: !e.habilitada ? 'neutro' : pausada ? 'aviso' : 'ok',
      ultimoEnvio: hora(e.ultimo_envio_em, fuso),
      ultimoSucesso: hora(e.ultimo_sucesso_em, fuso),
      pendentes: e.pendentes.toLocaleString('pt-BR'),
      erros: e.erros_abertos,
      motivoPausa: e.pausada_mensagem ?? '',
      podeRetomar: acoes.configurar && pausada,
      podeCargaCompleta: acoes.configurar && e.habilitada,
    };
  });
}

/** Entidades pausadas, para o botão geral "Tentar de novo" (uma chamada por entidade). */
export function entidadesParaRetomar(m: MonitorResposta): EntidadeHub[] {
  return m.entidades.filter((e) => e.situacao === 'pausada').map((e) => e.entidade);
}

/** A carga completa sempre pede confirmação. */
export const textoDeConfirmacaoCargaCompleta = (entidade: EntidadeHub): string =>
  `Enviar ${ROTULO_ENTIDADE[entidade].toLowerCase()} ao FDV de novo, tudo de uma vez? Pode demorar.`;

const FRASE_VERSAO_NAO_ACEITA = 'Versão do FDV não aceita. Atualize o Macuxi FDV.';

export interface ResumoSinal {
  texto: string;
  tom: 'ok' | 'aviso' | 'neutro';
  /** RD-1070: só a frase de versão não aceita, quando o conector está parado por versão; senão null. */
  politica: string | null;
}

export function resumoDoSinal(m: MonitorResposta, fuso: string = FUSO_PADRAO): ResumoSinal {
  const s = m.sinal;
  const politica = s?.parado_por_versao ? FRASE_VERSAO_NAO_ACEITA : null;
  if (!s?.ultimo_aceito_em) return { texto: 'Ainda não falou com o FDV', tom: s?.parado_por_versao ? 'aviso' : 'neutro', politica };
  return {
    texto: `Última resposta do FDV em ${formatarDataHora(s.ultimo_aceito_em, fuso)}`,
    tom: s.parado_por_versao ? 'aviso' : 'ok',
    politica,
  };
}

export function camposDaCredencial(m: MonitorResposta, fuso: string = FUSO_PADRAO): { tem: boolean; campos: { rotulo: string; valor: string }[] } {
  const c = m.credencial;
  if (!c) return { tem: false, campos: [] };
  return {
    tem: true,
    campos: [
      { rotulo: 'Código do conector', valor: c.conector_id },
      { rotulo: 'Ambiente', valor: ROTULO_AMBIENTE[c.ambiente] },
      { rotulo: 'Chave', valor: `${c.chave_prefixo}…` },
      { rotulo: 'Cadastrada em', valor: formatarDataHora(c.criada_em, fuso) },
      { rotulo: 'Último uso', valor: hora(c.ultimo_uso_em, fuso, 'Ainda não usada') },
    ],
  };
}

export interface LinhaErro {
  cadastro: string;
  registro: string;
  campo: string;
  codigo: string;
  mensagem: string;
}

export const linhasDeErros = (m: MonitorResposta): LinhaErro[] =>
  m.erros.map((e) => ({ cadastro: ROTULO_ENTIDADE[e.entidade], registro: e.registro_external_id, campo: e.campo ?? '', codigo: e.codigo, mensagem: e.mensagem }));

export const colunasDeErros: readonly ColunaCsv<LinhaErro>[] = [
  { titulo: 'Cadastro', valor: (e) => e.cadastro },
  { titulo: 'Registro', valor: (e) => e.registro },
  { titulo: 'Campo', valor: (e) => e.campo },
  { titulo: 'Código', valor: (e) => e.codigo },
  { titulo: 'Mensagem', valor: (e) => e.mensagem },
];

export interface LinhaConflito {
  cadastro: string;
  chave: string;
  mensagem: string;
  detectadoEm: string;
}

export const linhasDeConflitos = (m: MonitorResposta, fuso: string = FUSO_PADRAO): LinhaConflito[] =>
  m.conflitos.map((c) => ({ cadastro: ROTULO_ENTIDADE[c.entidade], chave: c.chave, mensagem: c.mensagem, detectadoEm: formatarDataHora(c.detectado_em, fuso) }));

// ---- formulários ----

export type ResultadoFormulario<T> = { ok: true; corpo: T } | { ok: false; erros: Record<string, string> };

/** Mensagens em português por campo; nunca devolvem o valor digitado (a chave não pode voltar à tela nem ao log). */
export function validarFormularioCredencial(v: { conector_id: string; chave: string; ambiente: string }): ResultadoFormulario<CredencialEntrada> {
  const r = CredencialEntrada.safeParse({ conector_id: v.conector_id.trim(), chave: v.chave.trim(), ambiente: v.ambiente });
  if (r.success) return { ok: true, corpo: r.data };
  const erros: Record<string, string> = {};
  for (const i of r.error.issues) {
    const campo = String(i.path[0]);
    erros[campo] ??=
      campo === 'conector_id' ? 'Use só letras, números, hífen e sublinhado (até 64 caracteres)'
      : campo === 'chave' ? 'Cole a chave inteira, sem espaços (de 32 a 512 caracteres)'
      : 'Escolha teste ou produção';
  }
  return { ok: false, erros };
}

export function validarFormularioConfiguracao(v: { entidades_habilitadas: readonly string[]; limite_registros_lote: string | number }): ResultadoFormulario<ConfiguracaoEntrada> {
  const limite = typeof v.limite_registros_lote === 'number' ? v.limite_registros_lote : /^\d+$/.test(v.limite_registros_lote.trim()) ? Number(v.limite_registros_lote.trim()) : Number.NaN;
  const entrada = { entidades_habilitadas: [...v.entidades_habilitadas], limite_registros_lote: limite };
  // a regra e os textos são os do domain (a mesma que a API aplica: entidades da lista, sem repetir; limite de 1 a 5.000)
  const violacoes = validarConfiguracao(entrada);
  if (violacoes.length > 0) return { ok: false, erros: Object.fromEntries(violacoes.map((x) => [x.campo, x.mensagem])) };
  const r = ConfiguracaoEntrada.safeParse(entrada);
  if (r.success) return { ok: true, corpo: r.data };
  return { ok: false, erros: { entidades_habilitadas: MENSAGEM_ENTIDADES_HABILITADAS, limite_registros_lote: MENSAGEM_LIMITE_LOTE } };
}
