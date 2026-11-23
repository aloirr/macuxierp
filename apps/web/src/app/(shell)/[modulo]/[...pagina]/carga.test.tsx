import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RelatorioCarga } from '@macuxierp/cadastros/contracts';
import { PreviaDaCarga, TelaCarga, textoErrosOmitidos } from './carga';

const ent = { entidade: 'preco', arquivo: 'preco.csv', situacao: 'processado', lidas: 5, inseridas: 1, atualizadas: 2, sem_mudanca: 0, recusadas: 2, colunas_ignoradas: [], avisos: ['Coluna extra ignorada.'] };
const erro = (linha: number | null, campo: string | null, codigo: string, motivo: string) => ({ arquivo: 'preco.csv', linha, campo, codigo, motivo });
const r = (extra: object = {}) => ({ lote_id: '00000000-0000-4000-8000-000000000001', modo: 'validar', iniciado_em: '2026-11-23T12:00:00.000Z', concluido_em: '2026-11-23T12:00:01.000Z', entidades: [ent], erros: [], erros_omitidos: 0, ...extra }) as unknown as RelatorioCarga;

describe('TelaCarga', () => {
  const h = renderToStaticMarkup(<TelaCarga api="/envio-carga" />);
  it('mostra os 10 cartões na ordem, cada um com Baixar modelo e Enviar <entidade>.csv', () => {
    const ordem = [...h.matchAll(/<legend>([^<]+)<\/legend>/g)].map((m) => m[1]);
    expect(ordem).toEqual(['Filiais', 'Vendedores', 'Formas de pagamento', 'Prazos de pagamento', 'Produtos', 'Unidades do produto', 'Preços', 'Estoque', 'Clientes', 'Endereços de clientes']);
    expect(h.match(/Baixar modelo/g)).toHaveLength(10);
    expect(h).toContain('href="/baixar-modelo?caminho=%2Fv1%2Fcadastros%2Fcargas%2Fmodelos%2Fproduto_unidade"');
    expect(h).toContain('Enviar cliente_endereco.csv');
  });
  it('Validar é secundário', () => {
    expect(h.match(/<button class="mx-botao-secundario"[^>]*>Validar<\/button>/g)).toHaveLength(10);
  });
  it('o Gravar nasce desligado em todos os cartões', () => {
    const gravar = [...h.matchAll(/<button[^>]*>Gravar<\/button>/g)];
    expect(gravar).toHaveLength(10);
    for (const g of gravar) expect(g[0]).toContain('disabled');
  });
});

describe('PreviaDaCarga', () => {
  it('mostra o resumo e os erros por linha (linha, campo, motivo) com "e mais N erros"', () => {
    const h = renderToStaticMarkup(<PreviaDaCarga relatorio={r({ erros: [erro(3, 'preco_cents', 'CARGA_FORMATO', 'Valor inválido.'), erro(null, null, 'PERFIL_SEM_PERMISSAO', 'Só o administrador carrega filial e limite de crédito.')], erros_omitidos: 7 })} />);
    expect(h).toContain('Validação');
    expect(h).toMatch(/<td[^>]*>Preços<\/td><td[^>]*>Processado<\/td><td[^>]*>5<\/td><td[^>]*>1<\/td><td[^>]*>2<\/td><td[^>]*>0<\/td><td[^>]*>2<\/td><td[^>]*>Coluna extra ignorada\.<\/td>/);
    expect(h).toMatch(/<td[^>]*>3<\/td><td[^>]*>preco_cents<\/td><td[^>]*>Valor inválido\.<\/td>/);
    expect(h).toMatch(/<td[^>]*>—<\/td><td[^>]*>—<\/td><td[^>]*>Só o administrador carrega filial e limite de crédito\.<\/td>/);
    expect(h).toContain('Há mais 7 erros que não aparecem aqui. Corrija estes e valide de novo.');
  });
  it('as tabelas usam a TabelaDensa: números à direita e algarismos tabulares', () => {
    const h = renderToStaticMarkup(<PreviaDaCarga relatorio={r({ erros: [erro(3, 'preco_cents', 'CARGA_FORMATO', 'Valor inválido.')] })} />);
    expect(h).toMatch(/<td[^>]*text-align:right[^>]*tabular-nums[^>]*>5<\/td>|<td[^>]*tabular-nums[^>]*text-align:right[^>]*>5<\/td>/);
    expect(h).toMatch(/<td[^>]*(text-align:right|tabular-nums)[^>]*>3<\/td>/);
    expect(h).toContain('Erros de preco.csv');
  });
  it('a concordância dos omitidos: 1 erro no singular, N erros no plural', () => {
    expect(textoErrosOmitidos(1)).toBe('Há mais 1 erro que não aparece aqui. Corrija estes e valide de novo.');
    expect(textoErrosOmitidos(3)).toBe('Há mais 3 erros que não aparecem aqui. Corrija estes e valide de novo.');
  });
  it('agrupa a dependência por arquivo, com o motivo da API e o atalho para a entidade que falta', () => {
    const dep = (l: number) => ({ ...erro(l, 'produto_external_id', 'CARGA_DEPENDENCIA', 'Faltam produtos: carregue produto.csv antes.'), entidade_faltante: 'produto' });
    const h = renderToStaticMarkup(<PreviaDaCarga relatorio={r({ erros: [dep(5), dep(6)] })} />);
    expect(h.match(/Faltam produtos: carregue produto\.csv antes\./g)).toHaveLength(1);
    expect(h).toContain('preco.csv — Faltam produtos: carregue produto.csv antes.');
    expect(h).toContain('href="#carga-produto">Ir para Produtos</a>');
    expect(h).not.toContain('<caption>');
  });
  it('sem erro: "Nenhum erro."', () => {
    expect(renderToStaticMarkup(<PreviaDaCarga relatorio={r()} />)).toContain('Nenhum erro.');
  });
});

describe('Escolher arquivo', () => {
  const h = renderToStaticMarkup(<TelaCarga api="/envio-carga" />);
  it('cada cartão tem label ligada ao input, botão secundário e o nome do arquivo ao lado', () => {
    expect(h.match(/Escolher arquivo<\/label>/g)).toHaveLength(10);
    expect(h.match(/<label for="([^"]+)" class="mx-botao-secundario">/g)).toHaveLength(10);
    const ids = [...h.matchAll(/<input id="([^"]+)" type="file"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(10);
    for (const id of ids) expect(h).toContain(`for="${id}"`);
    expect(h.match(/Nenhum arquivo escolhido/g)).toHaveLength(10);
  });
  it('o foco do input escondido aparece no botão', async () => {
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(`${__dirname}/../../../globals.css`, 'utf8')).toMatch(/input\[type='file'\]:focus-visible \+ \.mx-botao-secundario \{ outline/);
  });
});
