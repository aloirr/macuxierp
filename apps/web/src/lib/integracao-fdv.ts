/**
 * Vista SÓ LEITURA da Integração FDV no BKO (T-0056, ADR 0013), parte pura: do `StatusIntegracaoFdvTenant` às linhas da tela.
 * Por cadastro: Ligado ou Desligado, último envio (no fuso da empresa) e a falha com o motivo e a ação sugerida.
 */
import { ROTULO_ENTIDADE } from '@macuxierp/integracao-fdv/web';
import { formatarDataHora } from '@macuxierp/platform-sdk/formatar';
import type { StatusIntegracaoFdvTenant } from '@macuxierp/platform-sdk';
import type { AcaoSugeridaFdv, EntidadeEnvioFdv, MotivoFalhaEnvioFdv } from '@macuxierp/platform-sdk';
import type { ColunaTabela } from '@macuxierp/ui';
import { createElement } from 'react';
import { TEXTO_MOTIVO_FDV, acaoNoBko } from './integracao-fdv-textos';

/** Parte comum de um cadastro, nos dois formatos da API (status do BKO e integração do /config). */
interface CadastroFdvBase {
  entidade: EntidadeEnvioFdv;
  ligada: boolean;
  ultimo_envio_em: string | null;
  falha: { motivo: MotivoFalhaEnvioFdv; acao: AcaoSugeridaFdv } | null;
  /** Só nas pausas por credencial ou licença do FDV (sondagem de 30 min). */
  proxima_tentativa_em?: string | null;
}

/** Linha "Próxima tentativa" das duas células (Falha e sob o nome); sem data, nada aparece. */
const elementoProximaTentativa = (texto: string | null) => (texto ? createElement('span', { className: 'apoio bloco-proxima' }, texto) : null);

/** Colunas e células iguais no BKO e no /config (RD-1138): rótulo, ligada, último envio e falha. */
export interface LinhaBaseFdv {
  entidade: EntidadeEnvioFdv;
  rotulo: string;
  ligada: boolean;
  ultimoEnvio: string;
  falha: { motivo: string; acao: string } | null;
  /** "Próxima tentativa: 27/11/2026 11:30"; nulo quando a API não manda a data. */
  proximaTentativa: string | null;
}

export const textoProximaTentativa = (instante: string, fuso: string): string => `Próxima tentativa: ${formatarDataHora(instante, fuso)}`;

export function linhaBaseFdv(c: CadastroFdvBase, fuso: string, acao: (a: AcaoSugeridaFdv) => string): LinhaBaseFdv {
  return {
    entidade: c.entidade,
    rotulo: ROTULO_ENTIDADE[c.entidade],
    ligada: c.ligada,
    ultimoEnvio: c.ultimo_envio_em ? formatarDataHora(c.ultimo_envio_em, fuso) : '—',
    falha: c.falha ? { motivo: TEXTO_MOTIVO_FDV[c.falha.motivo], acao: acao(c.falha.acao) } : null,
    proximaTentativa: c.proxima_tentativa_em ? textoProximaTentativa(c.proxima_tentativa_em, fuso) : null,
  };
}

/** `falhaSobreNome`: no BKO, em tela estreita (CSS) a falha sobe para uma linha sob o nome e a coluna Falha some. */
export function colunasStatusFdv<T extends LinhaBaseFdv>(opcoes: { falhaSobreNome?: boolean } = {}): ColunaTabela<T>[] {
  return [
    {
      id: 'rotulo',
      titulo: 'Cadastro',
      celula: (l) => (opcoes.falhaSobreNome && l.falha ? createElement('span', null, l.rotulo, createElement('span', { className: 'falha-sob-nome' }, `${l.falha.motivo} ${l.falha.acao}`.trim(), elementoProximaTentativa(l.proximaTentativa))) : l.rotulo),
    },
    { id: 'situacao', titulo: 'Situação', tipo: 'status', celula: (l) => createElement('span', { className: l.ligada ? 'selo selo-ativo' : 'selo selo-inativo' }, l.ligada ? 'Ligado' : 'Desligado') },
    { id: 'ultimoEnvio', titulo: 'Último envio', tipo: 'data', celula: (l) => l.ultimoEnvio },
    {
      id: 'falha',
      titulo: 'Falha',
      celula: (l) => (l.falha ? createElement('span', null, l.falha.acao ? `${l.falha.motivo} ` : l.falha.motivo, l.falha.acao ? createElement('span', { className: 'apoio' }, l.falha.acao) : null, elementoProximaTentativa(l.proximaTentativa)) : createElement('span', { className: 'apoio' }, '—')),
    },
  ];
}

/** Alerta do BKO: plural de verdade, sem "cadastro(s)". */
export const textoAlertaFalha = (n: number): string => (n === 1 ? '1 cadastro não chegou ao FDV. Veja o motivo na tabela.' : `${n} cadastros não chegaram ao FDV. Veja o motivo na tabela.`);

export type LinhaStatusFdv = LinhaBaseFdv;

export interface VistaStatusFdv {
  sinal: { texto: string; tom: 'ok' | 'aviso' };
  linhas: LinhaStatusFdv[];
  comFalha: number;
}

export function montarVistaStatus(s: StatusIntegracaoFdvTenant, fuso: string): VistaStatusFdv {
  const linhas = s.cadastros.map((c): LinhaStatusFdv => linhaBaseFdv(c, fuso, acaoNoBko));
  const u = s.ultimo_sinal;
  const sinal: VistaStatusFdv['sinal'] = !s.conector_id
    ? { texto: 'sem conector configurado. Fale com a Macuxi para ligar a integração.', tom: 'aviso' }
    : u?.parado_por_versao
      ? { texto: 'envio parado: a versão do conector não é mais aceita. Fale com a Macuxi.', tom: 'aviso' }
      : u?.ultimo_envio_em
        ? { texto: `último sinal do conector em ${formatarDataHora(u.ultimo_envio_em, fuso)}.`, tom: 'ok' }
        : { texto: 'ainda sem sinal do conector.', tom: 'aviso' };
  return {
    sinal,
    linhas,
    comFalha: linhas.filter((l) => l.falha).length,
  };
}
