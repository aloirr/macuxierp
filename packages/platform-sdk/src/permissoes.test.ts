import { describe, expect, it } from 'vitest';
import { MODULOS, PERFIS, PERFIS_V1, ROTULOS_PERFIL, type Perfil } from './modulo';
import { moduloDaAcao, pode, PERMISSOES, type Acao } from './permissoes';

const quem = (acao: Acao) => PERFIS.filter((p) => pode(p, acao));

describe('PERMISSOES (matriz do doc 03, D3)', () => {
  it('RN-CORE-01, RN-CORE-05 e RN-CAD-09: empresa, usuários, licenças, A1, filial, troca do external_id e desativar condições recusadas só o administrador', () => {
    for (const a of ['core.empresa.editar', 'core.usuario.gerir', 'core.licenca.ver', 'core.certificado.gerir', 'cadastros.filial.editar', 'cadastros.external_id.trocar', 'cadastros.condicao_pagamento.desativar_recusadas'] as const) {
      expect(quem(a)).toEqual(['administrador']);
    }
  });

  it('clientes e produtos: administrador, gerente e faturista; preços e crédito: administrador e gerente', () => {
    expect(quem('cadastros.cliente.editar')).toEqual(['administrador', 'gerente', 'faturista']);
    expect(quem('cadastros.produto.editar')).toEqual(['administrador', 'gerente', 'faturista']);
    expect(quem('cadastros.preco.editar')).toEqual(['administrador', 'gerente']);
    expect(quem('cadastros.cliente.credito')).toEqual(['administrador', 'gerente']);
  });

  it('carga de CSV (T-0026, D8; RN-CORE-09): administrador, gerente e analista de implantação; o arquivo de filial ainda pede cadastros.filial.editar', () => {
    expect(quem('cadastros.carga.executar')).toEqual(['administrador', 'gerente', 'analista_implantacao']);
    expect(pode('gerente', 'cadastros.carga.executar') && !pode('gerente', 'cadastros.filial.editar')).toBe(true);
    for (const p of ['faturista', 'fiscal', 'vendedor', 'leitura'] as const) expect(pode(p, 'cadastros.carga.executar')).toBe(false);
  });

  it('RN-CAD-07: saldo negativo só administrador e gerente', () => {
    expect(quem('cadastros.estoque.negativo')).toEqual(['administrador', 'gerente']);
  });

  it('regras fiscais, aprovar pedido e emitir nota seguem a matriz', () => {
    expect(quem('fiscal.regra.editar')).toEqual(['administrador', 'fiscal']);
    expect(quem('pedido.pedido.aprovar')).toEqual(['administrador', 'gerente']);
    expect(quem('faturamento.nota.emitir')).toEqual(['administrador', 'faturista', 'fiscal']);
  });

  it('pedido manual (T-0013 §4.1): lançar com administrador, gerente e faturista; cancelar com administrador e gerente', () => {
    expect(quem('pedido.pedido.lancar')).toEqual(['administrador', 'gerente', 'faturista']);
    expect(quem('pedido.pedido.cancelar')).toEqual(['administrador', 'gerente']);
  });

  it('RN-FAT-06: baixar título com administrador, gerente e faturista (matriz do doc 03); fiscal, vendedor e leitura não', () => {
    expect(quem('faturamento.titulo.baixar')).toEqual(['administrador', 'gerente', 'faturista']);
    expect(moduloDaAcao('faturamento.titulo.baixar')).toBe('faturamento');
  });

  it('RN-FAT-04: configurar o faturamento da filial (bandeira "faturamento real com NF-e simulada") só o administrador', () => {
    expect(quem('faturamento.configurar')).toEqual(['administrador']);
    expect(moduloDaAcao('faturamento.configurar')).toBe('faturamento');
  });

  it('RN-CORE-08: trocar ambiente fiscal só o administrador (o recado do Alexandre é conferido no core)', () => {
    expect(quem('core.ambiente.trocar')).toEqual(['administrador']);
  });

  it('"ver tudo" vale para todos os perfis da empresa, menos o analista de implantação (o vendedor é filtrado pela carteira no módulo)', () => {
    for (const a of ['pedido.ver', 'fiscal.ver', 'faturamento.ver', 'core.empresa.ver', 'core.perfil.ver'] as const) {
      expect(quem(a)).toEqual([...PERFIS_V1]);
    }
    expect(quem('cadastros.ver')).toEqual([...PERFIS]);
  });

  it('RN-CORE-09: perfil fora dos 6 da v1 (hoje só o analista de implantação) só tem as ações listadas para ele: consulta dos cadastros e carga; nada herdado de "ver tudo"', () => {
    const V1: readonly Perfil[] = PERFIS_V1;
    const EXPLICITAS: Partial<Record<Perfil, readonly Acao[]>> = {
      analista_implantacao: ['cadastros.ver', 'cadastros.carga.executar'],
    };
    const fora = PERFIS.filter((p) => !V1.includes(p));
    expect(fora.length).toBeGreaterThan(0);
    for (const p of fora) {
      const acoes = (Object.keys(PERMISSOES) as Acao[]).filter((a) => pode(p, a));
      expect(EXPLICITAS[p], `perfil ${p} sem lista explícita de ações neste teste`).toBeDefined();
      expect(acoes).toEqual(EXPLICITAS[p]);
    }
  });

  it('RN-CORE-01: todo perfil tem rótulo para pessoas', () => {
    for (const p of PERFIS) expect(ROTULOS_PERFIL[p].length).toBeGreaterThan(1);
    expect(ROTULOS_PERFIL.analista_implantacao).toBe('Analista de implantação');
  });

  it('integração FDV (T-0011, T-0056): no BKO só ver (administrador, gerente e leitura); a escrita é do portal (ADR 0013)', () => {
    expect(quem('integracao-fdv.ver')).toEqual(['administrador', 'gerente', 'leitura']);
    expect(Object.keys(PERMISSOES).filter((a) => a.startsWith('integracao-fdv.'))).toEqual(['integracao-fdv.ver']);
  });

  it('toda ação começa com um módulo conhecido e só lista perfis da RN-CORE-01', () => {
    for (const [acao, perfis] of Object.entries(PERMISSOES)) {
      expect(MODULOS).toContain(moduloDaAcao(acao as Acao));
      for (const p of perfis) expect(PERFIS).toContain(p as Perfil);
    }
  });
});
