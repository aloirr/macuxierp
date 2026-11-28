/**
 * Adaptador da porta `CalculoFiscal` do faturamento sobre o motor `fiscal.calculo@1` (T-0021): emitente (porta injetada), regras e IBPT na `tx` (RLS),
 * CFOP (domain/cfop.ts), motor, refinamento do CFOP pelo CST/CSOSN. Premissas, limites e o formato da entrada/saída: docs/modulos/fiscal/README.md.
 */
import type { Transacao } from '@macuxierp/platform-sdk';
import { Uf } from '@macuxierp/cadastros/contracts';
import { CalculoEntrada, CalculoSaida as CalculoSaidaSchema, type CalculoSaida, type ErroFiscal, type ItemCalculo, type ResultadoCalculoFiscal } from '../contracts';
import { calcularDocumento, cfopBase, cfopPeloIcms, destinatarioPeloIndIe, type EntradaCfop } from '../domain';
import type { ConsultaEmitenteFiscal, RepositorioFiscal } from './portas';
import { repositorioFiscalSql } from './sql';

export interface EntradaCalculoDoFiscal {
  ambiente?: string;
  filial_id: string;
  pedido: {
    pedido: {
      cliente_retrato: { tipo_pessoa: 'PF' | 'PJ'; ind_ie_dest: '1' | '2' | '9'; endereco: { uf: string } };
    };
  };
  /** AAAA-MM-DD, fuso do tenant (RN-FIS-04). */
  data_emissao: string;
  itens: {
    sequencia: number;
    produto_id?: string;
    ncm: string;
    origem: string;
    quantidade: number;
    preco_unitario_centavos: number;
    valor_centavos: number;
    desconto_centavos: number;
    frete_centavos: number;
    outras_centavos: number;
  }[];
}
export interface CalculoFiscalDoFiscal {
  calcular(tx: Transacao, entrada: EntradaCalculoDoFiscal): Promise<ResultadoCalculoFiscal>;
}

export interface DepsCalculoFiscal {
  emitentes: ConsultaEmitenteFiscal;
  /** Padrão: leitura SQL de `fiscal.regra_tributaria` e `fiscal.carga_aproximada`. */
  repositorio?: RepositorioFiscal;
}

const falha = (codigo: ErroFiscal['codigo'], mensagem: string, rn = 'RN-FIS-01'): ResultadoCalculoFiscal => ({ ok: false, erros: [{ rn, codigo, mensagem }] });

export function criarCalculoFiscal(deps: DepsCalculoFiscal): CalculoFiscalDoFiscal {
  const repo = deps.repositorio ?? repositorioFiscalSql;
  return {
    async calcular(tx, entrada) {
      const emitente = await deps.emitentes.emitente(tx, entrada.filial_id);
      if (!emitente) return falha('REGRA_INCOMPLETA', 'Filial emissora sem dados fiscais (UF e CRT).');
      const ufEmit = Uf.safeParse(emitente.uf);
      const retrato = entrada.pedido.pedido.cliente_retrato;
      const ufDest = Uf.safeParse(retrato.endereco.uf);
      if (!ufEmit.success || !ufDest.success) return falha('ENTRADA_INVALIDA', 'UF do emitente ou do destinatário inválida.');

      const ncms = [...new Set(entrada.itens.map((i) => i.ncm))];
      const [regras, cargas] = await Promise.all([
        repo.regras(tx, { data_emissao: entrada.data_emissao, uf_origem: ufEmit.data, uf_destino: ufDest.data, crt: emitente.crt, ncms }),
        repo.cargas(tx, { data_emissao: entrada.data_emissao, uf: ufEmit.data, ncms }),
      ]);

      const idsProdutos = [...new Set(entrada.itens.flatMap((i) => (i.produto_id ? [i.produto_id] : [])))];
      const fabricados = idsProdutos.length > 0 ? await deps.emitentes.producaoPropria(tx, idsProdutos) : new Set<string>();
      const dest = destinatarioPeloIndIe(retrato.ind_ie_dest);
      const ctxItem = (i: { produto_id?: string }): EntradaCfop => ({
        uf_emitente: ufEmit.data,
        uf_destino: ufDest.data,
        producao_propria: i.produto_id !== undefined && fabricados.has(i.produto_id),
        tipo_contribuinte: dest.tipo_contribuinte,
      });
      const ctxPorSeq = new Map(entrada.itens.map((i) => [i.sequencia, ctxItem(i)]));
      const montar = (cfops: Record<number, string>): ReturnType<typeof CalculoEntrada.safeParse> =>
        CalculoEntrada.safeParse({
          emitente: { uf: ufEmit.data, crt: emitente.crt, regime_pis_cofins: emitente.regime_pis_cofins, industrial_ipi: emitente.industrial_ipi ?? false },
          destinatario: {
            uf: ufDest.data,
            tipo_contribuinte: dest.tipo_contribuinte,
            consumidor_final: dest.consumidor_final,
            tipo_pessoa: retrato.tipo_pessoa,
          },
          operacao: { finalidade: 'normal', data_emissao: entrada.data_emissao },
          itens: entrada.itens.map(
            (i): Partial<ItemCalculo> => ({
              id: String(i.sequencia),
              ncm: i.ncm,
              cfop: cfops[i.sequencia],
              quantidade: i.quantidade,
              valor_unitario_centavos: i.preco_unitario_centavos,
              valor_bruto_centavos: i.valor_centavos,
              desconto_centavos: i.desconto_centavos,
              frete_centavos: i.frete_centavos,
              outras_despesas_centavos: i.outras_centavos,
              origem: i.origem as ItemCalculo['origem'],
              carga_aproximada: cargas.get(i.ncm),
            }),
          ),
          regras,
        });

      let cfops: Record<number, string> = Object.fromEntries(entrada.itens.map((i) => [i.sequencia, cfopBase(ctxPorSeq.get(i.sequencia)!)]));
      for (let passada = 0; passada < 2; passada++) {
        const e = montar(cfops);
        if (!e.success) return falha('ENTRADA_INVALIDA', `Entrada do cálculo inválida: ${e.error.issues[0]?.path.join('.') ?? ''}.`);
        const r = calcularDocumento(e.data);
        if (!r.ok) return { ok: false, erros: r.erros };
        const novos: Record<number, string> = {};
        for (const it of r.valor.itens) {
          const seq = Number(it.item_id);
          const ctx = ctxPorSeq.get(seq);
          if (!ctx) return { ok: false, erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_INCOMPLETA', item_id: it.item_id, mensagem: 'Item devolvido pelo motor não consta da entrada' }] };
          novos[seq] = cfopPeloIcms(ctx, it.icms.csosn ?? it.icms.cst);
        }
        const diverge = entrada.itens.find((i) => novos[i.sequencia] !== cfops[i.sequencia]);
        if (!diverge) {
          const saida: CalculoSaida = { ...r.valor, itens: r.valor.itens.map((it) => ({ ...it, cfop: cfops[Number(it.item_id)] })) };
          // A API revalida (RN-FIS-05, 63 A): calc_* só com regra_aplicada e total só se todos os itens têm regra.
          const v = CalculoSaidaSchema.safeParse(saida);
          if (!v.success) return falha('ENTRADA_INVALIDA', `Saída do cálculo incoerente: ${v.error.issues[0]?.message ?? ''}`, 'RN-FIS-05');
          return { ok: true, saida, cfops };
        }
        if (passada === 1) {
          return {
            ok: false,
            erros: [{ rn: 'RN-FIS-01', codigo: 'REGRA_INCOMPLETA', item_id: String(diverge.sequencia), mensagem: `CFOP ${cfops[diverge.sequencia]} CST incoerente` }],
          };
        }
        cfops = novos;
      }
      return falha('ENTRADA_INVALIDA', 'Cálculo não convergiu.');
    },
  };
}
