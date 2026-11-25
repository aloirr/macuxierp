/**
 * Porta `ConsultaCnpjParaCore` (T-0101): o `core` consulta o CNPJ da empresa pela mesma consulta do RF-CAD-02 (provedores,
 * reserva, cache de 24 h, IBGE oficial). Falha da fonte, CNPJ inválido e não encontrado voltam como valor, sem lançar.
 * Sem dado pessoal em log: nada é logado aqui, e o motivo da falha da fonte não é propagado.
 */
import { ErroApi } from '@macuxierp/platform-sdk';
import type { ConsultaCnpjParaCore } from '../contracts';
import { consultarCnpj } from './consultas';
import type { Dependencias } from './portas';

export interface DependenciasConsultaCnpjParaCore {
  repositorios: Dependencias['repositorios'];
  fontes: Dependencias['fontes'];
  relogio: { agora(): Date };
}

export function criarConsultaCnpjParaCore(d: DependenciasConsultaCnpjParaCore): ConsultaCnpjParaCore {
  return {
    async consultar(tx, _tenant, cnpjBruto) {
      try {
        const r = await consultarCnpj({ cnpj: cnpjBruto, agora: d.relogio.agora(), repos: d.repositorios(tx), fontes: d.fontes.cnpj });
        if (!r.ok) return { ok: false, motivo: 'cnpj_invalido' };
        const { sugestao, fonte, consultado_em } = r.resultado;
        return { ok: true, sugestao, fonte, consultado_em };
      } catch (e) {
        if (e instanceof ErroApi && e.status === 404) return { ok: false, motivo: 'nao_encontrado' };
        return { ok: false, motivo: 'fonte_indisponivel' };
      }
    },
  };
}
