import { describe, expect, it } from 'vitest';
import { ENTIDADES_CARGA, type RelatorioCarga } from '@macuxierp/cadastros/contracts';
import { PERFIS, pode } from '@macuxierp/platform-sdk';
import { acoesDaCarga } from '@macuxierp/cadastros/web';
import {
  BOTOES_CARGA, caminhoDoModelo, dependenciasPorArquivo, enderecoDoModelo, entidadeDoModelo, errosDaTabela,
  formularioDaEntidade, modeloPermitido, podeGravar, problemaDoArquivo,
} from './carga-entidade';
import { MANIFESTOS } from './manifestos';
import { montarMenu } from './menu';

const ent = (entidade: string, extra = {}) => ({ entidade, arquivo: `${entidade}.csv`, situacao: 'processado', lidas: 3, inseridas: 2, atualizadas: 1, sem_mudanca: 0, recusadas: 0, colunas_ignoradas: [], avisos: [], ...extra });
const relatorio = (extra: Partial<RelatorioCarga> = {}): RelatorioCarga => ({
  lote_id: '00000000-0000-4000-8000-000000000001', modo: 'validar', iniciado_em: '2026-11-23T12:00:00.000Z', concluido_em: '2026-11-23T12:00:01.000Z',
  entidades: [ent('preco')], erros: [], erros_omitidos: 0, ...extra,
} as RelatorioCarga);
const DEP = (linha: number, campo: string | null = 'produto_external_id', ...resto: [string | null | undefined] | []) => { const entidade_faltante = resto.length ? resto[0] : 'produto'; return ({ arquivo: 'preco.csv', linha, campo, codigo: 'CARGA_DEPENDENCIA', motivo: 'Faltam produtos: carregue produto.csv antes.', ...(entidade_faltante === undefined ? {} : { entidade_faltante }) }); };

describe('botões da carga (T-0051)', () => {
  it('seguem a ordem do D13', () => {
    expect(BOTOES_CARGA.map((b) => b.entidade)).toEqual([...ENTIDADES_CARGA]);
    expect(BOTOES_CARGA.every((b) => b.rotulo.length > 0)).toBe(true);
    expect(BOTOES_CARGA[5]?.arquivo).toBe('produto_unidade.csv');
  });
});

describe('proxy do modelo: lista fechada', () => {
  it('aceita só /v1/cadastros/cargas/modelos/<entidade da lista>', () => {
    for (const e of ENTIDADES_CARGA) {
      expect(modeloPermitido(caminhoDoModelo(e))).toBe(true);
      expect(entidadeDoModelo(caminhoDoModelo(e))).toBe(e);
    }
    expect(decodeURIComponent(enderecoDoModelo('preco'))).toBe('/baixar-modelo?caminho=/v1/cadastros/cargas/modelos/preco');
  });
  it.each([
    '/v1/cadastros/cargas/modelos/transportadora', '/v1/cadastros/cargas/modelos/', '/v1/cadastros/cargas/modelos/preco/', '/v1/cadastros/cargas/modelos/preco?x=1',
    '/v1/cadastros/cargas/modelos/../clientes', '/v1/cadastros/cargas/modelos/../../x/preco', '/v1/cadastros/cargas', '/v1/cadastros/clientes', '', 'https://x.invalid/v1/cadastros/cargas/modelos/preco',
    '/v1/cadastros/cargas/modelos/PRECO',
  ])('recusa %s', (c) => expect(modeloPermitido(c)).toBe(false));
});

describe('arquivo do botão', () => {
  it('só <entidade>.csv, dentro do limite', () => {
    expect(problemaDoArquivo('preco', { nome: 'preco.csv', tamanho: 10 })).toBeNull();
    expect(problemaDoArquivo('preco', { nome: 'produto.csv', tamanho: 10 })).toBe('Envie só o arquivo preco.csv neste botão.');
    expect(problemaDoArquivo('preco', undefined)).toBe('Escolha o arquivo .csv.');
    expect(problemaDoArquivo('preco', { nome: 'preco.csv', tamanho: 11 * 1024 * 1024 })).toContain('10 MB');
  });
  it('o formulário leva modo, entidade e um arquivo só, com o nome da entidade', () => {
    const f = formularioDaEntidade('validar', 'produto_unidade', new Blob(['a;b']));
    expect(f.get('modo')).toBe('validar');
    expect(f.get('entidade')).toBe('produto_unidade');
    const a = f.getAll('arquivos');
    expect(a).toHaveLength(1);
    expect((a[0] as File).name).toBe('produto_unidade.csv');
  });
});

describe('CARGA_DEPENDENCIA', () => {
  it('forma_external_id com entidade_faltante forma_pagamento aponta Formas de pagamento; null ou ausente não aponta nada', () => {
    const f = dependenciasPorArquivo(relatorio({ erros: [DEP(1, 'forma_external_id', 'forma_pagamento')] as RelatorioCarga['erros'] }));
    expect(f[0]?.faltam).toEqual(['forma_pagamento']);
    expect(dependenciasPorArquivo(relatorio({ erros: [DEP(1, 'forma_external_id', null)] as RelatorioCarga['erros'] }))[0]?.faltam).toEqual([]);
    expect(dependenciasPorArquivo(relatorio({ erros: [DEP(1, 'forma_external_id', undefined)] as RelatorioCarga['erros'] }))[0]?.faltam).toEqual([]);
  });
  it('agrupa por arquivo, sem repetir motivo nem entidade, na ordem do D13; o resto fica na tabela', () => {
    const r = relatorio({
      erros: [DEP(5), DEP(6), DEP(7, 'filial_external_id', 'filial'), { arquivo: 'preco.csv', linha: 9, campo: 'preco_cents', codigo: 'CARGA_FORMATO', motivo: 'Valor inválido.' }, { ...DEP(2, null, null), arquivo: 'estoque.csv' }] as RelatorioCarga['erros'],
    });
    const d = dependenciasPorArquivo(r);
    expect(d).toEqual([
      { arquivo: 'preco.csv', motivos: ['Faltam produtos: carregue produto.csv antes.'], faltam: ['filial', 'produto'] },
      { arquivo: 'estoque.csv', motivos: ['Faltam produtos: carregue produto.csv antes.'], faltam: [] },
    ]);
    expect(errosDaTabela(r)).toEqual([{ arquivo: 'preco.csv', erros: [expect.objectContaining({ linha: 9, codigo: 'CARGA_FORMATO' })] }]);
  });
});

describe('Gravar só depois de validação sem erro', () => {
  it('liga só com modo validar, entidade processada, sem erro e sem omitidos', () => {
    expect(podeGravar(relatorio(), 'preco')).toBe(true);
    expect(podeGravar(null, 'preco')).toBe(false);
    expect(podeGravar(relatorio({ modo: 'gravar' }), 'preco')).toBe(false);
    expect(podeGravar(relatorio({ erros: [DEP(5)] as RelatorioCarga['erros'] }), 'preco')).toBe(false);
    expect(podeGravar(relatorio({ erros_omitidos: 2 }), 'preco')).toBe(false);
    expect(podeGravar(relatorio({ entidades: [ent('preco', { situacao: 'recusado' })] as RelatorioCarga['entidades'] }), 'preco')).toBe(false);
    expect(podeGravar(relatorio(), 'produto')).toBe(false);
  });
});

describe('perfis (RN-CORE-09)', () => {
  const eu = [{ id: 'cadastros' as const, menus: ['Carga de cadastros', 'Clientes'] }];
  it('a ação e o menu seguem a matriz do SDK: abre se e só se pode(perfil, cadastros.carga.executar)', () => {
    for (const p of PERFIS) {
      const vê = pode(p, 'cadastros.carga.executar');
      expect(acoesDaCarga(p).abrir).toBe(vê);
      expect(montarMenu(eu, MANIFESTOS, p).flatMap((g) => g.itens.map((i) => i.rotulo)).includes('Carga de cadastros')).toBe(vê);
    }
  });
  it('leitura e vendedor não abrem a carga', () => {
    for (const p of ['leitura', 'vendedor'] as const) {
      expect(acoesDaCarga(p).abrir).toBe(false);
      expect(montarMenu(eu, MANIFESTOS, p).flatMap((g) => g.itens.map((i) => i.rotulo))).not.toContain('Carga de cadastros');
    }
  });
  it.skipIf(!(PERFIS as readonly string[]).includes('analista_implantacao'))('o analista de implantação vê a carga', () => {
    expect(pode('analista_implantacao' as never, 'cadastros.carga.executar')).toBe(true);
    expect(acoesDaCarga('analista_implantacao' as never).abrir).toBe(true);
  });
});
