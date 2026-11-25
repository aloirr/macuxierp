/**
 * Porta `ConsultaCnpjParaCore` (T-0101): o `core` consulta o CNPJ da empresa pela mesma consulta do RF-CAD-02 (provedores,
 * reserva, cache de 24 h, IBGE oficial). Falha da fonte, CNPJ inválido e não encontrado voltam como valor, sem lançar.
 * Sem dado pessoal em log: nada é logado aqui, e o motivo da falha da fonte não é propagado.
 */
import { ErroApi } from '@macuxierp/platform-sdk';
import type { ConsultaCnpjParaCore } from '../contracts';
import { validarDocumentoCliente } from '../domain';
import { completarIbge, sugestaoCnpj, sugestaoComCache } from './consultas';
import type { Dependencias } from './portas';
import { dataIso } from './util';

export interface DependenciasConsultaCnpjParaCore {
  repositorios: Dependencias['repositorios'];
  fontes: Dependencias['fontes'];
  relogio: { agora(): Date };
}

export function criarConsultaCnpjParaCore(d: DependenciasConsultaCnpjParaCore): ConsultaCnpjParaCore {
  return {
    async consultar(tx, _tenant, cnpjBruto) {
      const v = validarDocumentoCliente('PJ', cnpjBruto);
      if (!v.ok) return { ok: false, motivo: 'cnpj_invalido' };
      const cnpj = v.documento;
      const r = d.repositorios(tx);
      const agora = d.relogio.agora();
      try {
        const res = await sugestaoComCache({
          tipo: 'cnpj', chave: cnpj, agora, repo: r.consultaExterna, fontes: d.fontes.cnpj,
          montar: (fonte, bruto) => completarIbge(sugestaoCnpj(fonte, bruto, cnpj), (uf) => r.oficiais.municipiosDaUf(uf, dataIso(agora))),
        });
        return { ok: true, sugestao: res.sugestao, fonte: res.fonte, consultado_em: res.consultado_em };
      } catch (e) {
        if (e instanceof ErroApi && e.status === 404) return { ok: false, motivo: 'nao_encontrado' };
        return { ok: false, motivo: 'fonte_indisponivel' };
      }
    },
  };
}
