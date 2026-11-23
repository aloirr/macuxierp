import { describe, expect, it } from 'vitest';
import type { RelatorioCarga } from '../contracts';
import { manifest } from '../manifest';
import {
  PAGINA_CARGA, acoesDaCarga, csvDosErros, csvDoResumo, errosPorArquivo, montarFormulario, problemasDaSelecao, resumoDoRelatorio, textoDeConfirmacao, totaisDoRelatorio,
} from './carga';

const resultado = (entidade: RelatorioCarga['entidades'][number]['entidade'], o: Partial<RelatorioCarga['entidades'][number]> = {}) => ({
  entidade, arquivo: `${entidade}.csv`, situacao: 'processado' as const, lidas: 2, inseridas: 1, atualizadas: 0, sem_mudanca: 0, recusadas: 1, colunas_ignoradas: [], avisos: [], ...o,
});
const rel: RelatorioCarga = {
  lote_id: '00000000-0000-4000-8000-000000000001', modo: 'validar', iniciado_em: '2026-11-21T15:00:00.000Z', concluido_em: '2026-11-21T15:00:01.000Z',
  entidades: [resultado('titulo', { situacao: 'ignorado', lidas: 0, inseridas: 0, recusadas: 0 }), resultado('cliente'), resultado('filial', { colunas_ignoradas: ['telefone'] })],
  erros: [{ arquivo: 'cliente.csv', linha: 3, campo: 'documento', codigo: 'RN-CAD-01', motivo: 'Documento inválido pelo dígito verificador' }],
  erros_omitidos: 0,
};

describe('página de carga do BKO', () => {
  // T-0058 (RN-CAD-10): a carga saiu do menu do BKO (é do /config, só superadmin); o descritor fica exportado enquanto o shell o importar.
  it('o menu NÃO está mais no manifesto; a rota é a do shell (slug do rótulo) e a ação é a da API (cadastros.carga.executar)', () => {
    expect(manifest.web?.menus).not.toContain(PAGINA_CARGA.menu);
    expect(PAGINA_CARGA.ver).toBe('cadastros.carga.executar');
    expect(PAGINA_CARGA.rota).toBe('/cadastros/carga-de-cadastros'); // `/<módulo>/<slug do rótulo>`; tests/ confere contra o shell (D-02)
    expect(acoesDaCarga('administrador')).toEqual({ abrir: true, validar: true, gravar: true });
    expect(acoesDaCarga('gerente').gravar).toBe(true);
    for (const p of ['faturista', 'fiscal', 'vendedor', 'leitura'] as const) expect(acoesDaCarga(p), p).toEqual({ abrir: false, validar: false, gravar: false });
  });
  it('a seleção é conferida no navegador: só .csv, até 16 arquivos e 10 MB', () => {
    expect(problemasDaSelecao([])).toHaveLength(1);
    expect(problemasDaSelecao([{ nome: 'cliente.csv', tamanho: 10 }, { nome: 'Filial.CSV', tamanho: 10 }])).toEqual([]);
    expect(problemasDaSelecao([{ nome: 'cliente.xlsx', tamanho: 10 }])).toHaveLength(1);
    expect(problemasDaSelecao([{ nome: 'a.csv', tamanho: PAGINA_CARGA.maxBytes + 1 }])).toHaveLength(1);
    expect(problemasDaSelecao(Array.from({ length: 17 }, (_, i) => ({ nome: `a${i}.csv`, tamanho: 1 })))).toHaveLength(1);
  });
  it('o envio é multipart com modo e os arquivos no campo arquivos; o Gravar pede confirmação', async () => {
    const f = montarFormulario('gravar', [{ nome: 'cliente.csv', conteudo: new Blob(['a;b\n']) }, { nome: 'filial.csv', conteudo: new Blob(['a;b\n']) }]);
    expect(f.get('modo')).toBe('gravar');
    expect(f.getAll('arquivos').map((x) => (x as File).name)).toEqual(['cliente.csv', 'filial.csv']);
    expect(textoDeConfirmacao(2)).toContain('2 arquivos');
  });
  it('o resumo segue a ordem de carga (D13), com os ignorados por último, e os totais somam as entidades', () => {
    expect(resumoDoRelatorio(rel).map((l) => l.entidade)).toEqual(['Filiais', 'Clientes', 'Títulos']);
    expect(totaisDoRelatorio(rel)).toMatchObject({ lidas: 4, inseridas: 2, recusadas: 2, erros: 1 });
  });
  it('erros por arquivo e CSV de erros: linha, campo e motivo, sem valor digitado', () => {
    expect(errosPorArquivo(rel)).toEqual([{ arquivo: 'cliente.csv', erros: rel.erros }]);
    const csv = csvDosErros(rel);
    expect(csv).toContain('Arquivo');
    expect(csv).toContain('cliente.csv');
    expect(csv).toContain('RN-CAD-01');
    expect(csvDoResumo(rel)).toContain('Filiais');
  });
});
