/**
 * Consulta de cadastros para o módulo fiscal (T-0021). O fiscal declara `ConsultaEmitenteFiscal` em
 * `modules/fiscal/api/portas.ts`; `EmitenteParaFiscal` é estruturalmente compatível com ela, sem o cadastros importar o
 * fiscal. Roda na transação do chamador (RLS do tenant) e devolve também a filial inativa (a decisão é do fiscal).
 * O CRT vem da filial emissora (RN-FIS-02) e sai numérico, como o `Crt` do fiscal; `regime_pis_cofins` só aparece quando informado (vale no CRT 3).
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import type { RegimePisCofins } from '../contracts';
import type { Repositorios } from './portas';
import { dadosFiscaisDaFilial, type CrtCadastros } from './util';

export interface EmitenteParaFiscal {
  uf: string;
  crt: CrtCadastros;
  regime_pis_cofins?: RegimePisCofins;
  industrial_ipi: boolean;
}

export interface ConsultaCadastrosParaFiscal {
  emitente(tx: Transacao, filial_id: string): Promise<EmitenteParaFiscal | null>;
  /** Ids (entre os pedidos) dos produtos fabricados pelo estabelecimento (CFOP 5101/6101 × 5102/6102). Id inexistente fica de fora. */
  producaoPropria(tx: Transacao, produto_ids: string[]): Promise<Set<string>>;
}

export function criarConsultaParaFiscal(repositorios: (tx: Transacao) => Repositorios): ConsultaCadastrosParaFiscal {
  return {
    async emitente(tx, filial_id) {
      const f = await repositorios(tx).filiais.obter(filial_id);
      if (!f) return null;
      const { crt, industrial_ipi, regime_pis_cofins } = dadosFiscaisDaFilial(f);
      return { uf: f.endereco.uf, crt, industrial_ipi, ...(regime_pis_cofins ? { regime_pis_cofins } : {}) };
    },
    async producaoPropria(tx, produto_ids) {
      const unicos = [...new Set(produto_ids)];
      if (unicos.length === 0) return new Set();
      const produtos = await repositorios(tx).produtos.porIds(unicos);
      return new Set(produtos.filter((p) => p.producao_propria).map((p) => p.id));
    },
  };
}
