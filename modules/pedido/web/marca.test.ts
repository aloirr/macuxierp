/** Ressalvas do design-de-marca (T-0015, lote 3c): máscara de documento, mensagens, voz, decisão vigente e total. */
import { describe, expect, it } from 'vitest';
import type { Pedido } from '../contracts';
import { cabecalhoDoPedido, linhasDeHistorico, resumoDaDecisao } from './detalhe';
import { formularioVazio, totalDoFormulario, validarFormulario, type Formulario } from './formulario';
import { rotuloDoCliente } from './fontes';
import { ROTULO_ORIGEM } from './lista';
import { chaveDoCampo, mensagemDaIssue } from './erros';
import { validarAprovacao, validarMotivo } from './acoes';

const U1 = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const FRASE = /^[A-ZÀ-Ú][^.]*\.( [A-ZÀ-Ú].*\.)?$/;

describe('documento com máscara', () => {
  it('detalhe formata CNPJ e CPF; vendedor segue sem documento', () => {
    const base = { numero: 1, status: 'aprovado', origem: 'bko', emitido_em: '2026-11-21T12:00:00.000Z', observacao: null, total_centavos: 0, valor_faturado_centavos: 0 };
    const com = (documento: string | null) => cabecalhoDoPedido({ ...base, cliente_retrato: { razao_social: 'X', documento } } as unknown as Pedido, 'America/Manaus').documento;
    expect(com('11444777000161')).toBe('11.444.777/0001-61');
    expect(com('52998224725')).toBe('529.982.247-25');
    expect(com(null)).toBeNull();
  });
  it('rótulo da fonte de clientes: razão · documento formatado; sem documento para o vendedor', () => {
    const c = { razao_social: 'Bar do Zé', documento: '11444777000161' };
    expect(rotuloDoCliente(c, 'gerente')).toBe('Bar do Zé · 11.444.777/0001-61');
    expect(rotuloDoCliente(c, 'vendedor')).toBe('Bar do Zé');
    expect(rotuloDoCliente({ razao_social: 'Bar do Zé', documento: null }, 'gerente')).toBe('Bar do Zé');
  });
});

describe('mensagens: problema + ação, com ponto final', () => {
  const vazio = validarFormulario(formularioVazio());
  it('erros do formulário por campo do item, sem juntar numa frase', () => {
    expect(vazio.ok).toBe(false);
    if (vazio.ok) return;
    expect(vazio.erros.filial_id).toBe('Escolha a filial.');
    expect(vazio.erros['itens.0.preco']).toBe('Preço inválido. Digite em reais, ex.: 12,50.');
    for (const m of Object.values(vazio.erros)) expect(m, m).toMatch(FRASE);
    for (const m of Object.values(vazio.erros)) expect(m).not.toContain(';');
  });
  it('quantidade e desconto acima do valor também seguem o padrão', () => {
    const f: Formulario = { ...formularioVazio(), itens: [{ produto_id: U1, quantidade: '0', preco: '10,00', desconto: '' }, { produto_id: U1, quantidade: '1', preco: '10,00', desconto: '10,01' }] };
    const r = validarFormulario(f);
    if (r.ok) throw new Error('deveria falhar');
    expect(r.erros['itens.0.quantidade']).toBe('Informe a quantidade maior que zero, com até 4 casas.');
    expect(r.erros['itens.1.desconto']).toBe('Desconto maior que o valor do item. Reduza o desconto.');
    for (const m of Object.values(r.erros)) expect(m, m).toMatch(FRASE);
  });
  it('erros.ts e as ações usam o mesmo padrão', () => {
    const m = validarMotivo('cancelar', { motivo_codigo: '', motivo_texto: '' });
    const a = validarAprovacao(true, '');
    for (const r of [m, a]) {
      if (r.ok) throw new Error('deveria falhar');
      for (const x of Object.values(r.erros)) expect(x, x).toMatch(FRASE);
    }
    expect(chaveDoCampo(['itens', 0, 'quantidade'])).toBe('itens.0.quantidade');
    expect(mensagemDaIssue({ code: 'invalid_type', expected: 'string', received: 'undefined', path: ['x'], message: '' })).toMatch(FRASE);
  });
});

describe('voz', () => {
  it('origem: Macuxi FDV e Manual', () => {
    expect(ROTULO_ORIGEM).toEqual({ fdv: 'Macuxi FDV', bko: 'Manual' });
  });
  it('ator: rótulo do perfil quando conhecido, Sistema para o sistema, o mesmo termo na decisão', () => {
    const historico = [
      { de: null, para: 'em_analise', ator_tipo: 'sistema', ator_id: null, motivo_codigo: null, motivo_texto: null, ocorrido_em: '2026-11-21T12:00:00.000Z' },
      { de: 'em_analise', para: 'aprovado', ator_tipo: 'usuario', ator_id: U1, motivo_codigo: null, motivo_texto: null, ocorrido_em: '2026-11-21T13:00:00.000Z' },
    ] as Pedido['historico'];
    const decisao = { decisao: 'aprovado', automatica: false, decidido_por: U1, perfil: 'administrador', pendencias_aceitas: [], justificativa: null, motivo_codigo: null, motivo_texto: null, decidido_em: '2026-11-21T13:00:00.000Z' } as Pedido['decisao'];
    const h = linhasDeHistorico({ historico, decisao }, 'America/Manaus');
    expect(h.map((x) => x.ator)).toEqual(['Sistema', 'Administrador']);
    expect(resumoDaDecisao({ decisao }, 'America/Manaus')?.quem).toBe('Administrador');
    expect(linhasDeHistorico({ historico }, 'America/Manaus')[1]?.ator).toBe('Usuário');
  });
});

describe('decisão vigente reflete o status final', () => {
  const aprovada = { decisao: 'aprovado', automatica: true, decidido_por: null, perfil: null, pendencias_aceitas: [], justificativa: null, motivo_codigo: null, motivo_texto: null, decidido_em: '2026-11-21T12:00:00.000Z' } as Pedido['decisao'];
  const historico = [
    { de: 'em_analise', para: 'aprovado', ator_tipo: 'sistema', ator_id: null, motivo_codigo: null, motivo_texto: null, ocorrido_em: '2026-11-21T12:00:00.000Z' },
    { de: 'aprovado', para: 'cancelado', ator_tipo: 'usuario', ator_id: U1, motivo_codigo: 'sem_estoque', motivo_texto: null, ocorrido_em: '2026-11-21T14:00:00.000Z' },
  ] as Pedido['historico'];
  it('aprovado: segue a aprovação', () => {
    expect(resumoDaDecisao({ status: 'aprovado', decisao: aprovada, historico: historico.slice(0, 1) }, 'America/Manaus')).toMatchObject({ decisao: 'Aprovado', quem: 'Automática (sem pendência)' });
  });
  it('cancelado: "Cancelado · motivo · quando" a partir do último evento de cancelamento', () => {
    const r = resumoDaDecisao({ status: 'cancelado', decisao: aprovada, historico }, 'America/Manaus');
    expect(r).toMatchObject({ decisao: 'Cancelado', motivo: 'Produto sem estoque', quando: '21/11/2026 10:00', texto: 'Cancelado · Produto sem estoque · 21/11/2026 10:00' });
  });
  it('cancelado de pedido do FDV (sem aprovação) também mostra o cancelamento', () => {
    const r = resumoDaDecisao({ status: 'cancelado', decisao: null, origem: 'fdv', aprovado_origem_em: '2026-11-21T11:00:00.000Z', historico }, 'America/Manaus');
    expect(r?.decisao).toBe('Cancelado');
    expect(r?.texto).toBe('Cancelado · Produto sem estoque · 21/11/2026 10:00');
  });
  it('FDV aprovado segue "Aprovado no Macuxi FDV"', () => {
    expect(resumoDaDecisao({ status: 'aprovado', decisao: null, origem: 'fdv', aprovado_origem_em: null }, 'America/Manaus')).toMatchObject({ decisao: 'Aprovado no Macuxi FDV' });
  });
});

describe('total antes de lançar', () => {
  it('soma as linhas válidas com calcularTotal e formata em R$', () => {
    const f: Formulario = { ...formularioVazio(), itens: [{ produto_id: U1, quantidade: '2,5', preco: '10,00', desconto: '1,00' }, { produto_id: '', quantidade: '', preco: '', desconto: '' }] };
    expect(totalDoFormulario(f.itens)).toEqual({ centavos: 2400, texto: 'R$ 24,00' });
    expect(totalDoFormulario([])).toEqual({ centavos: 0, texto: 'R$ 0,00' });
  });
});
