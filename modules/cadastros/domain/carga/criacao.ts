import type { EnderecoDaLinha, EntidadeCarga, LinhasCarga } from '../../contracts';
import { validarFiscalProduto, type FatosFiscaisProduto } from '../produto';
import { erroDeViolacao, erroLinha, type ErroLinha } from './erros';

export type ResultadoCriacao<E extends EntidadeCarga> = { ok: true; linha: LinhasCarga[E] } | { ok: false; erros: ErroLinha[] };

const falta = (linha: number, campo: string, rn = 'CARGA_OBRIGATORIO', motivo = 'Obrigatório para criar o cadastro'): ErroLinha =>
  erroLinha(linha, campo, rn, motivo);

/** D6: padrões que valem só na criação. Devolve a linha completada ou os campos que faltam para criar. */
export function prepararCriacao<E extends EntidadeCarga>(entidade: E, linha: LinhasCarga[E]): ResultadoCriacao<E> {
  const erros: ErroLinha[] = [];
  const avisos = [...linha.avisos];
  const n = linha.linha;
  const l = structuredClone(linha) as LinhasCarga[EntidadeCarga];
  switch (entidade) {
    case 'filial': {
      const f = l as LinhasCarga['filial'];
      if (f.dados.crt === undefined) erros.push(falta(n, 'crt', 'CARGA_OBRIGATORIO', 'Acrescente a coluna crt para criar a filial'));
      if (f.dados.cnpj === undefined) erros.push(falta(n, 'cnpj'));
      break;
    }
    case 'vendedor': {
      const v = l as LinhasCarga['vendedor'];
      if (v.dados.codigo === undefined) {
        if (v.external_id.length <= 20) v.dados.codigo = v.external_id;
        else erros.push(falta(n, 'codigo', 'CARGA_TAMANHO', 'external_id acima de 20 caracteres: informe a coluna codigo'));
      }
      if (v.dados.nome === undefined) erros.push(falta(n, 'nome'));
      if (v.refs.filial === undefined) avisos.push('Vendedor sem filial: informe filial_external_id');
      break;
    }
    case 'condicao_pagamento': {
      const p = l as LinhasCarga['condicao_pagamento'];
      const d = p.dados;
      if (d.codigo === undefined) erros.push(falta(n, 'codigo'));
      if (d.forma_tpag === undefined) erros.push(falta(n, 'forma_codigo'));
      if (d.descricao === undefined && d.forma_nome !== undefined && d.prazos_dias !== undefined) {
        d.descricao = `${d.forma_nome} ${d.prazos_dias.join('/')}`.slice(0, 60);
      }
      if (d.descricao === undefined) erros.push(falta(n, 'descricao'));
      if (d.prazos_dias === undefined) erros.push(falta(n, 'parcelas_dias', 'RN-CAD-15', 'Parcelas obrigatórias: dias separados por /, à vista 0'));
      if (d.prazo_medio_dias === undefined) erros.push(falta(n, 'prazo_medio_dias', 'RN-CAD-15', 'Prazo médio (dias) obrigatório para criar o prazo'));
      break;
    }
    case 'produto': {
      const p = l as LinhasCarga['produto'];
      if (p.dados.ncm === undefined) erros.push(falta(n, 'ncm', 'RN-CAD-04', 'NCM obrigatório: acrescente a coluna ncm'));
      if (p.dados.grupo_tributacao === undefined) {
        p.dados.grupo_tributacao = 'PADRAO';
        avisos.push('grupo_tributacao vazio: gravado como PADRAO');
      }
      break;
    }
    case 'cliente': {
      const c = l as LinhasCarga['cliente'];
      if (c.dados.documento === undefined) erros.push(falta(n, 'documento'));
      if (c.dados.razao_social === undefined) erros.push(falta(n, 'razao_social'));
      // T-0058: o endereço principal sai da linha `principal` do grupo (a carga promove a 1ª linha quando não há).
      const e = c.enderecos.find((x) => x.tipo === 'principal')?.dados;
      for (const campo of ['logradouro', 'bairro', 'municipio_ibge', 'uf', 'cep'] as const) {
        if (e?.[campo] === undefined) erros.push(falta(n, `endereco.${campo}`, 'RN-CAD-03', 'Endereço principal obrigatório para criar o cliente'));
      }
      if (e && e.numero === undefined) e.numero = 'S/N';
      if (c.dados.ind_ie_dest === undefined) c.dados.ind_ie_dest = '9';
      break;
    }
    case 'produto_unidade': {
      const u = l as LinhasCarga['produto_unidade'];
      if (u.dados.unidade === undefined) erros.push(falta(n, 'unidade'));
      if (u.dados.fator === undefined) erros.push(falta(n, 'fator'));
      break;
    }
    default:
      break;
  }
  l.avisos = avisos;
  return erros.length > 0 ? { ok: false, erros } : { ok: true, linha: l as LinhasCarga[E] };
}

/** RN-CAD-04: NCM e CEST do lote conferidos contra as tabelas oficiais (os fatos vêm da API, que os busca de uma vez). */
export function validarFiscalLinhaProduto(linha: number, fatos: FatosFiscaisProduto): ErroLinha[] {
  return validarFiscalProduto(fatos).map((v) => erroDeViolacao(linha, v));
}

/** T-0058: endereço novo do cliente (entrega, cobrança ou o principal que o grupo promoveu): campos obrigatórios e `numero` padrão `S/N`. */
export function prepararEnderecoNovo(e: EnderecoDaLinha): { ok: true; dados: EnderecoDaLinha['dados'] } | { ok: false; erros: ErroLinha[] } {
  const erros: ErroLinha[] = [];
  for (const campo of ['logradouro', 'bairro', 'municipio_ibge', 'uf', 'cep'] as const) {
    if (e.dados[campo] === undefined) erros.push(falta(e.linha, `endereco.${campo}`, campo === 'municipio_ibge' || campo === 'uf' ? 'RN-CAD-03' : 'CARGA_OBRIGATORIO', 'Obrigatório para criar o endereço do cliente'));
  }
  return erros.length > 0 ? { ok: false, erros } : { ok: true, dados: { ...e.dados, numero: e.dados.numero ?? 'S/N' } };
}
