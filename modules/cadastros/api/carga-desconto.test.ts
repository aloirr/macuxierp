import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { RelatorioCarga } from '../contracts';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { criarPluginCadastros } from './index';
import { dependenciasEmMemoria } from './memoria';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
const fixture = (n: string) => readFileSync(join(pasta, n), 'utf8');
const adm = sessaoDe('administrador');
const CAB = 'external_id;sku;nome;unidade;alterado_em;ativo;ean;marca;custo_cents;preco_venda_cents;desconto_maximo_pct;ncm;cest;origem;grupo_tributacao';
const produtos = (d1: string, d2: string) =>
  `${CAB}\nP-EX-01;SKU-EX-01;Produto Exemplo 01;UN;;sim;;Marca Exemplo;500;1000;${d1};21069030;;0;BEBIDAS\nP-EX-02;SKU-EX-02;Produto Exemplo 02;CX;;sim;;Marca Exemplo;900;1800;${d2};21069030;;0;\n`;

function montar() {
  const m = dependenciasEmMemoria();
  m.repos.oficiais.ncms.add('21069030');
  m.repos.oficiais.municipiosPorUf.set('AM', [{ ibge: '1302603', nome: 'Manaus' }]);
  const amb = criarAmbiente(criarPluginCadastros(m.deps));
  const carregar = async (...arqs: [string, string][]) => {
    const r = await amb.chamar('POST', '/cargas', { sessao: adm, corpo: { modo: 'gravar' }, arquivos: arqs.map(([nome, conteudo]) => ({ nome, conteudo })) });
    expect(r.status).toBe(200);
    return r.corpo as RelatorioCarga;
  };
  const filial: [string, string] = ['filial.csv', fixture('filial.csv')];
  const preco: [string, string] = ['preco.csv', fixture('preco.csv')];
  const itens = () => (m.repos.tabelasPreco.itensPreco as { produto_id: string; desconto_maximo_bp: number }[]);
  const idDe = (ext: string) => m.repos.produtos.linhas.find((p) => p.external_id === ext)!.id;
  const descontoItem = (ext: string) => itens().find((i) => i.produto_id === idDe(ext))!.desconto_maximo_bp;
  const eventosPreco = () => amb.eventos.filter((e) => e.nome === 'cadastros.preco.alterado@1');
  return { ...m, ...amb, carregar, filial, preco, descontoItem, eventosPreco, idDe, itens };
}
const arq = (r: RelatorioCarga, e: string) => r.entidades.find((x) => x.entidade === e)!;

describe('RN-CAD-11: desconto máximo do produto em qualquer ordem de carga (T-0058)', () => {
  it('RN-CAD-11: produto e depois preço em lotes separados: o item herda o desconto do produto, sem aviso', async () => {
    const t = montar();
    await t.carregar(t.filial, ['produto.csv', fixture('produto.csv')]);
    const rel = await t.carregar(t.preco);
    expect(t.descontoItem('P-EX-01')).toBe(1250);
    expect(arq(rel, 'preco').avisos.join()).not.toContain('1250');
  });

  it('RN-CAD-11: preço e depois produto em lotes separados: os itens herdados são atualizados e republicados; o desconto próprio fica', async () => {
    const t = montar();
    await t.carregar(t.filial, ['produto.csv', produtos('', '')]);
    await t.carregar(t.preco);
    expect(t.itens().map((i) => i.desconto_maximo_bp)).toEqual([0, 0]);
    // desconto próprio do P-EX-02, gravado pelo PUT
    const tab = t.repos.tabelasPreco.linhas[0]!.id as string;
    const filialId = t.repos.filiais.linhas[0]!.id as string;
    const put = await t.chamar('PUT', `/tabelas-preco/${tab}/itens`, { sessao: adm, corpo: { itens: [{ filial_id: filialId, produto_id: t.idDe('P-EX-02'), preco_centavos: 1800, desconto_maximo_bp: 300 }] } });
    expect(put.status).toBe(200);
    const antes = t.eventosPreco().length;
    const rel = await t.carregar(['produto.csv', produtos('12,5', '20')]);
    expect(arq(rel, 'produto')).toMatchObject({ atualizadas: 2, sem_mudanca: 0 });
    expect(t.descontoItem('P-EX-01')).toBe(1250);
    expect(t.descontoItem('P-EX-02')).toBe(300);
    const novos = t.eventosPreco().slice(antes);
    expect(novos).toHaveLength(1);
    expect(novos[0]!.payload).toMatchObject({ external_id: 'PR-EX-01' });
    // regravar o mesmo produto não muda nem republica
    const de = t.eventos.length;
    const outra = await t.carregar(['produto.csv', produtos('12,5', '20')]);
    expect(arq(outra, 'produto')).toMatchObject({ atualizadas: 0, sem_mudanca: 2 });
    expect(t.eventos).toHaveLength(de);
  });

  it('RN-CAD-11: aviso só quando nem o produto nem o preço têm desconto', async () => {
    const t = montar();
    await t.carregar(t.filial, ['produto.csv', produtos('12,5', '')]);
    const rel = await t.carregar(t.preco);
    expect(arq(rel, 'preco').avisos).toEqual(['1 item(ns) de preço sem desconto máximo (nem no produto nem no preço)']);
    expect(rel.entidades.find((e) => e.entidade === 'produto')).toBeUndefined();
  });

  it('RN-CAD-11: produto e preço no mesmo lote continuam funcionando', async () => {
    const t = montar();
    const rel = await t.carregar(t.filial, ['produto.csv', fixture('produto.csv')], t.preco);
    expect(rel.erros).toEqual([]);
    expect(t.descontoItem('P-EX-01')).toBe(1250);
    expect(t.descontoItem('P-EX-02')).toBe(0);
    expect(arq(rel, 'preco').avisos).toEqual([]);
  });
});
