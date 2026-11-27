/**
 * Tela "Integração FDV" do BKO como dados e funções puras, SÓ DE LEITURA (RF-INF-04): o shell (`apps/web`) lê `GET /monitor`
 * e desenha as seções. Aqui ficam os textos (curtos, sem jargão) e o horário de Manaus. Credencial, configuração, carga
 * completa e retomada são do portal `/config` (ADR 0013); a API revalida tudo (a proteção real é a dela).
 */
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import type { ColunaCsv } from '@macuxierp/platform-sdk/listas';
import type { EntidadeHub, MonitorResposta } from '../contracts';
import { ROTULO_ENTIDADE, hora } from './rotulos';

export const FUSO_PADRAO = 'America/Manaus';
const SEM_ENVIO = 'Ainda não enviou';


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
}

export function linhasDoMonitor(m: MonitorResposta, fuso: string = FUSO_PADRAO): LinhaMonitor[] {
  return m.entidades.map((e) => {
    const pausada = e.situacao === 'pausada';
    return {
      entidade: e.entidade,
      rotulo: ROTULO_ENTIDADE[e.entidade],
      situacao: !e.habilitada ? 'Desligada' : pausada ? 'Pausada' : 'Funcionando',
      tom: !e.habilitada ? 'neutro' : pausada ? 'aviso' : 'ok',
      ultimoEnvio: hora(fuso, SEM_ENVIO)(e.ultimo_envio_em),
      ultimoSucesso: hora(fuso, SEM_ENVIO)(e.ultimo_sucesso_em),
      pendentes: e.pendentes.toLocaleString('pt-BR'),
      erros: e.erros_abertos,
      motivoPausa: e.pausada_mensagem ?? '',
    };
  });
}

const FRASE_VERSAO_NAO_ACEITA = 'Versão do FDV não aceita. Atualize o Macuxi FDV.';

export interface ResumoSinal {
  texto: string;
  tom: 'ok' | 'aviso' | 'neutro';
  /** RD-1070: só a frase de versão não aceita, quando o conector está parado por versão; senão null. */
  politica: string | null;
}

// A `versao` do Monitor é a VERSAO_CONECTOR_HUB: o conector é o próprio ERP, então a versão do conector é a do ERP.
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
