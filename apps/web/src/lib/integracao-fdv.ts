/**
 * Vista da tela "Integração FDV" (T-0011), parte pura: junta as funções do módulo numa estrutura serializável para o componente.
 * A chave do conector não passa por aqui: o monitor só devolve o prefixo.
 */
import type { MonitorResposta } from '@macuxierp/integracao-fdv/contracts';
import {
  ROTULO_ENTIDADE, acoesDaTela, camposDaCredencial, entidadesParaRetomar, linhasDeConflitos, linhasDeErros, linhasDoMonitor, resumoDoSinal,
  type AcoesDaTela, type LinhaConflito, type LinhaErro, type LinhaMonitor, type ResumoSinal,
} from '@macuxierp/integracao-fdv/web';
import { ENTIDADES_HUB_F2, LIMITE_REGISTROS_LOTE } from '@macuxierp/integracao-fdv/contracts';
import type { Pendencia } from '@macuxierp/ui';
import type { Perfil } from '@macuxierp/platform-sdk';

export interface VistaIntegracaoFdv {
  acoes: AcoesDaTela;
  sinal: ResumoSinal;
  credencial: { tem: boolean; campos: { rotulo: string; valor: string }[]; conectorId: string; ambiente: 'teste' | 'producao' };
  linhas: LinhaMonitor[];
  pausadas: string[];
  /** Avisos da faixa do topo: cadastros pausados, erros e conflitos abertos. */
  pendencias: Pendencia[];
  erros: LinhaErro[];
  conflitos: LinhaConflito[];
  configuracao: { habilitadas: string[]; limite: number };
  cadastros: { id: string; rotulo: string }[];
  limiteMaximo: number;
  rotaLotes: string;
}

export function montarVista(m: MonitorResposta, perfil: Perfil, fuso: string, rotaLotes: string): VistaIntegracaoFdv {
  const cred = camposDaCredencial(m, fuso);
  const pausadas = entidadesParaRetomar(m);
  const erros = linhasDeErros(m);
  const pendencias: Pendencia[] = [];
  if (pausadas.length > 0) pendencias.push({ nivel: 'bloqueante', codigoRn: 'RN-INF-04', texto: `${pausadas.length} cadastro(s) com o envio pausado. Veja o motivo na tabela.` });
  if (erros.length > 0) pendencias.push({ nivel: 'aceitavel', codigoRn: 'RN-INF-04', texto: `${erros.length} erro(s) por registro aberto(s). Corrija no cadastro de origem.` });
  if (m.conflitos.length > 0) pendencias.push({ nivel: 'aceitavel', codigoRn: 'RN-INF-05', texto: `${m.conflitos.length} conflito(s) de chave aberto(s).` });
  return {
    acoes: acoesDaTela(perfil),
    sinal: resumoDoSinal(m, fuso),
    credencial: { ...cred, conectorId: m.credencial?.conector_id ?? '', ambiente: m.credencial?.ambiente ?? 'teste' },
    linhas: linhasDoMonitor(m, perfil, fuso),
    pausadas,
    pendencias,
    erros,
    conflitos: linhasDeConflitos(m, fuso),
    configuracao: { habilitadas: m.configuracao?.entidades_habilitadas ?? [], limite: m.configuracao?.limite_registros_lote ?? 500 },
    cadastros: ENTIDADES_HUB_F2.map((e) => ({ id: e, rotulo: ROTULO_ENTIDADE[e] })),
    limiteMaximo: LIMITE_REGISTROS_LOTE,
    rotaLotes,
  };
}
