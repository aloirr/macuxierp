import {
  celulaBooleana, celulaCentavos, celulaData, celulaDecimal, celulaInteiro, celulaLista, normalizarDocumento, type CelulaConvertida,
} from '@macuxierp/platform-sdk';
import {
  LinhaCliente, LinhaCondicaoPagamento, LinhaEstoque, LinhaFilial, LinhaPreco,
  LinhaProduto, LinhaProdutoUnidade, LinhaVendedor, TipoEndereco, type EntidadeCarga, type LinhasCarga,
} from '../../contracts';
import { MAX_DIAS } from '../../contracts';
import { MOTIVO_PRAZO_MEDIO } from '../condicao';
import { tipoPessoaDoDocumento, validarDocumentoCliente } from '../documento';
import { sugerirIndIeDest, validarIe, validarIndIeDest, type IndIeDest } from '../ie';
import { violacaoFracao } from '../fracao';
import { validarMunicipio } from '../municipio';
import { validarVigenciaTabela } from '../preco';
import { LIMITES_SEQ_ENDERECO, derivarExternalIdEndereco } from './cliente-grupo';
import { erroDeViolacao, erroLinha, errosDeZod, type ErroLinha } from './erros';
import { LIMITES, PADRAO_UF } from './layout';
import { resolverMunicipio, type MunicipioOficial } from './municipio-por-nome';

/** Linha já lida pelo leitor CSV: cabeçalho em minúsculas → texto aparado (vazio = célula vazia). */
export type Registro = Readonly<Record<string, string>>;

export interface ContextoMapeamento {
  /** Municípios vigentes da UF (a API carrega uma vez por lote). */
  municipiosDaUf(uf: string): readonly MunicipioOficial[];
}

export type ResultadoMapeamento<E extends EntidadeCarga> =
  | { ok: true; linha: LinhasCarga[E] }
  | { ok: false; erros: ErroLinha[] };

/**
 * Dicionário da forma de pagamento (D12, RN-CAD-09): `codigo` sem diferença de maiúsculas → tPag da NF-e.
 * Só Dinheiro, PIX, Cartão e Boleto são aceitos; o resto (cheque, depósito, transferência, desconhecido) vira o tPag
 * `TPAG_RECUSADO`, que a gravação recusa com RN-CAD-09 (e inativa as condições antigas ligadas à forma).
 */
export const DICIONARIO_TPAG: Readonly<Record<string, string>> = {
  DINHEIRO: '01', PIX: '17', CARTAO: '03', CARTAO_CREDITO: '03', CARTAO_DEBITO: '04', BOLETO: '15',
};
export const TPAG_RECUSADO = '99';
/** tPag da forma pelo `codigo` (sem diferença de maiúsculas); fora do dicionário = `TPAG_RECUSADO` (RN-CAD-09). */
export const tpagDaForma = (codigo: string): string => DICIONARIO_TPAG[codigo.toUpperCase()] ?? TPAG_RECUSADO;

class Leitor {
  readonly erros: ErroLinha[] = [];
  readonly avisos: string[] = [];
  constructor(private readonly reg: Registro, readonly linha: number) {}

  cel(nome: string): string | undefined {
    const v = (this.reg[nome] ?? '').trim();
    return v === '' ? undefined : v;
  }
  erro(campo: string | null, codigo: string, motivo: string): void {
    this.erros.push(erroLinha(this.linha, campo, codigo, motivo));
  }
  texto(nome: string, max: number, destino = nome): string | undefined {
    const v = this.cel(nome);
    if (v !== undefined && v.length > max) {
      this.erro(destino, 'CARGA_TAMANHO', `Texto acima de ${max} caracteres`);
      return undefined;
    }
    return v;
  }
  id(nome: string): string | undefined {
    return this.texto(nome, LIMITES.id_externo);
  }
  conv<T>(nome: string, f: (c: string) => CelulaConvertida<T>): T | undefined {
    const v = this.cel(nome);
    if (v === undefined) return undefined;
    const r = f(v);
    if (!r.ok) {
      this.erro(nome, 'CARGA_FORMATO', r.motivo);
      return undefined;
    }
    return r.valor;
  }
  ativo(): boolean | undefined {
    return this.conv('ativo', celulaBooleana);
  }
  cep(nome: string): string | undefined {
    const v = this.cel(nome);
    if (v === undefined) return undefined;
    const d = v.replace(/\D/g, '');
    if (d.length !== 8) {
      this.erro(nome, 'CARGA_FORMATO', 'CEP deve ter 8 dígitos');
      return undefined;
    }
    return d;
  }
  uf(nome: string): string | undefined {
    const v = this.cel(nome)?.toUpperCase();
    if (v !== undefined && !PADRAO_UF.test(v)) {
      this.erro(nome, 'CARGA_FORMATO', 'UF deve ter 2 letras');
      return undefined;
    }
    return v;
  }
  /** RN-CAD-03: `municipio_ibge` vence o nome; sem ele, cidade + UF pelo nome vigente. */
  municipio(ctx: ContextoMapeamento, colCidade: string, colUf: string, colIbge: string, uf: string | undefined): string | undefined {
    const ibge = this.cel(colIbge);
    if (ibge !== undefined) {
      if (uf === undefined) {
        this.erro(colUf, 'RN-CAD-03', 'Informe a UF junto do município');
        return undefined;
      }
      const m = validarMunicipio(ibge, uf);
      if (!m.ok) {
        this.erros.push(erroDeViolacao(this.linha, m.violacao, colIbge));
        return undefined;
      }
      return ibge;
    }
    const cidade = this.cel(colCidade);
    if (cidade === undefined) return undefined;
    if (uf === undefined) {
      this.erro(colUf, 'RN-CAD-03', 'Informe a UF junto da cidade');
      return undefined;
    }
    const r = resolverMunicipio(cidade, ctx.municipiosDaUf(uf));
    if (!r.ok) {
      this.erro(colCidade, 'RN-CAD-03', r.motivo);
      return undefined;
    }
    return r.ibge;
  }
  endereco(ctx: ContextoMapeamento, p: string): Record<string, string> | undefined {
    const uf = this.uf(`${p}uf`);
    const e: Record<string, string | undefined> = {
      logradouro: this.texto(`${p}logradouro`, LIMITES.texto60),
      numero: this.texto(`${p}numero`, LIMITES.texto60),
      complemento: this.texto(`${p}complemento`, LIMITES.texto60),
      bairro: this.texto(`${p}bairro`, LIMITES.texto60),
      cep: this.cep(`${p}cep`),
      uf,
      municipio_ibge: this.municipio(ctx, `${p}cidade`, `${p}uf`, `${p}municipio_ibge`, uf),
    };
    return limpar(e);
  }
}

function limpar<T extends Record<string, unknown>>(o: T): { [K in keyof T]: NonNullable<T[K]> } | undefined {
  const r = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return Object.keys(r).length === 0 ? undefined : (r as { [K in keyof T]: NonNullable<T[K]> });
}
const limparDados = (o: Record<string, unknown>): Record<string, unknown> => limpar(o) ?? {};

/** Passa o resultado pelo Zod do contrato; falha vira `CARGA_FORMATO` com o campo e sem o valor. */
function fechar<E extends EntidadeCarga>(
  l: Leitor,
  schema: { safeParse(v: unknown): { success: true; data: LinhasCarga[E] } | { success: false; error: { issues: { path: PropertyKey[]; code: string; received?: unknown }[] } } },
  bruto: Record<string, unknown>,
): ResultadoMapeamento<E> {
  const r = schema.safeParse({ ...bruto, linha: l.linha, avisos: l.avisos });
  if (!r.success) {
    for (const e of errosDeZod(l.linha, r.error.issues)) if (!l.erros.some((x) => x.campo === e.campo)) l.erros.push(e); // a célula já tem o erro específico
  }
  return l.erros.length > 0 || !r.success ? { ok: false, erros: l.erros } : { ok: true, linha: r.data };
}

function documento(l: Leitor, nome: string, tipo: 'PJ' | 'PF'): string | undefined {
  const v = l.cel(nome);
  if (v === undefined) return undefined;
  const r = validarDocumentoCliente(tipo, v);
  if (!r.ok) {
    l.erros.push(erroDeViolacao(l.linha, r.violacao, nome));
    return undefined;
  }
  return r.documento;
}

/** RN-CAD-15 e RN-CAD-16: prazo médio em dias, inteiro de 0 a MAX_DIAS. */
const celulaPrazoMedio = (c: string): CelulaConvertida<number> => {
  const r = celulaInteiro(c, { min: 0, max: MAX_DIAS });
  return r.ok ? r : { ok: false as const, motivo: MOTIVO_PRAZO_MEDIO };
};

const MAPEADORES: { [E in EntidadeCarga]: (l: Leitor, ctx: ContextoMapeamento) => ResultadoMapeamento<E> } = {
  filial(l, ctx) {
    const cnpj = documento(l, 'cnpj', 'PJ');
    const uf = l.uf('uf');
    let ie: string | undefined;
    const ieBruta = l.cel('ie');
    if (ieBruta !== undefined && uf !== undefined) {
      const r = validarIe(uf, ieBruta);
      if (r.ok) ie = r.ie;
      else l.erros.push(erroDeViolacao(l.linha, r.violacao, 'ie'));
    }
    const crt = l.cel('crt');
    // RN-FIS-02: CRT diferente de 3 com a célula do regime vazia zera o regime (normaliza em vez de travar em 422 por um regime antigo).
    const regime = l.cel('regime_pis_cofins')?.toLowerCase() ?? (crt !== undefined && crt !== '3' ? null : undefined);
    return fechar<'filial'>(l, LinhaFilial, {
      external_id: l.id('external_id'),
      ativo: l.ativo(),
      dados: limparDados({ cnpj, ie, crt, industrial_ipi: l.conv('industrial_ipi', celulaBooleana), regime_pis_cofins: regime, razao_social: l.texto('nome', LIMITES.texto60, 'razao_social') }),
      endereco: l.endereco(ctx, ''),
    });
  },
  vendedor(l) {
    return fechar<'vendedor'>(l, LinhaVendedor, {
      external_id: l.id('external_id'),
      ativo: l.ativo(),
      dados: limparDados({ nome: l.texto('nome', LIMITES.nome80), codigo: l.texto('codigo', LIMITES.codigo20) }),
      refs: limparDados({ filial: l.id('filial_external_id') }),
    });
  },
  condicao_pagamento(l) {
    const codigoForma = l.texto('forma_codigo', LIMITES.codigo_forma);
    let tpag = l.cel('forma_tpag');
    if (tpag === undefined && codigoForma !== undefined) {
      tpag = tpagDaForma(codigoForma);
    }
    // RN-CAD-15: as parcelas são os dias digitados (`30/60/90`; à vista `0`), sem a notação "Nx". A regra (1 a 24 parcelas, 0 a 365 dias) é do domain e do contrato.
    const bruto = l.cel('parcelas_dias');
    let prazos: number[] | undefined;
    if (bruto !== undefined) {
      const lista = celulaLista(bruto);
      const itens = lista.ok ? (lista.valor ?? []).map((x) => celulaInteiro(x)) : [];
      if (lista.ok && itens.every((i) => i.ok)) prazos = itens.flatMap((i) => (i.ok && i.valor !== undefined ? [i.valor] : []));
      else l.erro('parcelas_dias', 'CARGA_FORMATO', 'Parcelas: números inteiros de dias separados por /, por exemplo 30/60/90 (à vista 0)');
    }
    return fechar<'condicao_pagamento'>(l, LinhaCondicaoPagamento, {
      external_id: l.id('external_id'),
      ativo: l.ativo(),
      dados: limparDados({
        codigo: l.texto('codigo', LIMITES.codigo20), descricao: l.texto('descricao', LIMITES.texto60), prazos_dias: prazos, prazo_medio_dias: l.conv('prazo_medio_dias', celulaPrazoMedio),
        forma_external_id: l.id('forma_external_id'), forma_codigo: codigoForma, forma_nome: l.texto('forma_nome', LIMITES.texto60), forma_tpag: tpag,
      }),
    });
  },
  produto(l) {
    const pct = l.conv('desconto_maximo_pct', (c) => {
      const r = celulaDecimal(c, 2);
      return r.ok && (r.valor ?? 0) > 10_000 ? { ok: false as const, motivo: 'Desconto de 0 a 100' } : r;
    });
    const unidade = l.texto('unidade', LIMITES.unidade6)?.toUpperCase();
    const ncm = l.cel('ncm')?.replace(/[.\-\s]/g, '');
    const cest = l.cel('cest')?.replace(/[.\-\s]/g, '');
    return fechar<'produto'>(l, LinhaProduto, {
      external_id: l.id('external_id'),
      ativo: l.ativo(),
      dados: limparDados({
        codigo: l.texto('sku', LIMITES.texto60, 'codigo'),
        descricao: l.texto('nome', LIMITES.descricao120, 'descricao'),
        unidade_comercial: unidade,
        ean: l.cel('ean'),
        marca: l.texto('marca', LIMITES.texto60),
        custo_centavos: l.conv('custo_cents', celulaCentavos),
        ncm,
        cest,
        origem: l.cel('origem'),
        grupo_tributacao: l.texto('grupo_tributacao', LIMITES.grupo30),
        producao_propria: l.conv('producao_propria', celulaBooleana),
      }),
      desconto_maximo_bp: pct,
    });
  },
  produto_unidade(l) {
    // Mesmo parser do saldo (até 4 casas, ×10^4); a faixa (Qtd4.min(1)) é do contrato da rota, aplicada em `fechar`
    const fator = l.conv('fator', (c) => celulaDecimal(c, 4));
    const unidade = l.texto('unidade', LIMITES.unidade6)?.toUpperCase();
    // RN-CAD-17: fator fracionário só em KG e M (a mesma regra da rota de unidades)
    const fracao = fator === undefined ? null : violacaoFracao('fator', unidade, fator);
    if (fracao) l.erros.push(erroDeViolacao(l.linha, fracao));
    return fechar<'produto_unidade'>(l, LinhaProdutoUnidade, {
      external_id: l.id('external_id'),
      ativo: l.ativo(),
      dados: limparDados({ unidade, fator, ean: l.cel('ean') }),
      refs: limparDados({ produto: l.id('produto_external_id') }),
    });
  },
  preco(l) {
    const inicio = l.conv('vigencia_inicio', celulaData);
    const fim = l.conv('vigencia_fim', celulaData);
    if (inicio !== undefined && fim !== undefined) {
      const v = validarVigenciaTabela(inicio, fim);
      if (!v.ok) l.erros.push(erroDeViolacao(l.linha, v.violacao));
    }
    return fechar<'preco'>(l, LinhaPreco, {
      external_id: l.id('external_id'),
      ativo: l.ativo(),
      tabela: { external_id: l.id('tabela_external_id'), nome: l.texto('tabela_nome', LIMITES.texto60), vigencia_inicio: inicio, vigencia_fim: fim ?? null },
      preco_centavos: l.conv('preco_cents', celulaCentavos),
      unidade: l.texto('unidade', LIMITES.unidade6),
      refs: limparDados({ produto: l.id('produto_external_id'), filial: l.id('filial_external_id') }),
    });
  },
  estoque(l) {
    return fechar<'estoque'>(l, LinhaEstoque, {
      external_id: l.id('external_id'),
      saldo: l.conv('saldo', (c) => celulaDecimal(c, 4, { negativo: true })),
      refs: limparDados({ produto: l.id('produto_external_id'), filial: l.id('filial_external_id') }),
    });
  },
  cliente(l, ctx) {
    const bruto = l.cel('documento');
    let tipo: 'PJ' | 'PF' | undefined;
    let doc: string | undefined;
    if (bruto !== undefined) {
      const n = normalizarDocumento(bruto);
      tipo = tipoPessoaDoDocumento(n) ?? undefined;
      if (tipo === undefined) l.erro('documento', 'RN-CAD-01', 'Documento deve ter 11 (CPF) ou 14 caracteres (CNPJ)');
      else doc = documento(l, 'documento', tipo);
    }
    const end = l.endereco(ctx, 'endereco.');
    // T-0058: cada linha traz um endereço (`tipo_endereco`, `seq`); sem a coluna, o endereço da linha é o principal.
    let tipoEnd = l.cel('tipo_endereco')?.toLowerCase() as (typeof TipoEndereco)['options'][number] | undefined;
    if (tipoEnd !== undefined && !TipoEndereco.options.includes(tipoEnd)) {
      l.erro('tipo_endereco', 'CARGA_FORMATO', 'Tipo de endereço deve ser principal, entrega ou cobranca');
      tipoEnd = undefined;
    }
    const seq = l.conv('seq', (c) => {
      const r = celulaInteiro(c, LIMITES_SEQ_ENDERECO);
      return r.ok ? r : { ok: false as const, motivo: 'seq: inteiro de 1 a 999' };
    });
    const tipoDaLinha = tipoEnd ?? 'principal';
    // A UF do endereço principal é que vale para a IE (RN-CAD-02): em linha de entrega ou cobrança a IE só é normalizada na gravação.
    const ufIe = tipoDaLinha === 'principal' ? end?.uf : undefined;
    const ieBruta = l.cel('inscricao_estadual');
    let ie: string | undefined;
    let ind = l.cel('ind_ie_dest') as IndIeDest | undefined;
    if (ind !== undefined && !['1', '2', '9'].includes(ind)) {
      l.erro('ind_ie_dest', 'CARGA_FORMATO', 'Indicador deve ser 1, 2 ou 9');
      ind = undefined;
    }
    if (ieBruta !== undefined && ufIe !== undefined) {
      const r = validarIe(ufIe, ieBruta);
      if (r.ok) ie = r.ie;
      else l.erros.push(erroDeViolacao(l.linha, r.violacao, 'inscricao_estadual'));
    } else if (ieBruta !== undefined) {
      // Sem UF do principal na linha: a API valida pela UF do endereço principal do grupo ou do já gravado (RN-CAD-02).
      ie = ieBruta.toUpperCase();
    }
    if (ie !== undefined || ind !== undefined) ind = ind ?? sugerirIndIeDest(ie ?? null);
    if (ind !== undefined && ufIe !== undefined && (ieBruta === undefined || ie !== undefined)) {
      const v = validarIndIeDest({ ind_ie_dest: ind, ie: ie ?? null, uf: ufIe });
      if (!v.ok) l.erros.push(erroDeViolacao(l.linha, v.violacao, 'ind_ie_dest'));
    }
    const externo = l.id('external_id');
    const enderecos: Record<string, unknown>[] = [];
    if (end !== undefined || tipoEnd !== undefined) {
      const derivado = externo === undefined ? undefined : derivarExternalIdEndereco(externo, tipoDaLinha, seq);
      if (derivado !== undefined && derivado.length > LIMITES.id_externo) {
        l.erro('external_id', 'CARGA_TAMANHO', `external_id do endereço acima de ${LIMITES.id_externo} caracteres: use um external_id menor`);
      } else if (derivado !== undefined) enderecos.push({ linha: l.linha, external_id: derivado, tipo: tipoDaLinha, seq, dados: end ?? {} });
    }
    return fechar<'cliente'>(l, LinhaCliente, {
      external_id: externo,
      ativo: l.ativo(),
      dados: limparDados({
        tipo_pessoa: tipo,
        documento: doc,
        ie,
        ind_ie_dest: ind,
        razao_social: l.texto('razao_social', LIMITES.texto60),
        nome_fantasia: l.texto('nome_fantasia', LIMITES.texto60),
        email_nfe: l.cel('email'),
        limite_credito_centavos: l.conv('limite_credito_cents', celulaCentavos),
        prazo_medio_dias: l.conv('prazo_medio_dias', celulaPrazoMedio),
      }),
      enderecos,
      refs: limparDados({
        filial: l.id('filial_external_id'),
        vendedor: l.id('vendedor_external_id'),
        tabela_preco: l.id('tabela_preco_external_id'),
        condicao_pagamento: l.id('condicao_pagamento_external_id'),
      }),
    });
  },
};

/** Converte uma linha do arquivo no patch do contrato e a revalida (RN-CAD-01/02/03/06, Zod). Célula vazia = `undefined` (D6). */
export function mapearLinha<E extends EntidadeCarga>(entidade: E, registro: Registro, numeroLinha: number, ctx: ContextoMapeamento): ResultadoMapeamento<E> {
  const l = new Leitor(registro, numeroLinha);
  if (l.cel('external_id') === undefined) {
    l.erro('external_id', 'CARGA_OBRIGATORIO', 'external_id é obrigatório');
    return { ok: false, erros: l.erros };
  }
  return (MAPEADORES[entidade] as (l: Leitor, c: ContextoMapeamento) => ResultadoMapeamento<E>)(l, ctx);
}
