import { describe, expect, it } from 'vitest';
import { MODULOS, PERFIS, type Perfil } from './modulo';
import { moduloDaAcao, pode, PERMISSOES, type Acao } from './permissoes';

const quem = (acao: Acao) => PERFIS.filter((p) => pode(p, acao));

describe('PERMISSOES (matriz do doc 03, D3)', () => {
  it('RN-CORE-01: empresa, usuários, ver licenças e A1 só o administrador', () => {
    for (const a of ['core.empresa.editar', 'core.usuario.gerir', 'core.licenca.ver', 'core.certificado.gerir', 'cadastros.filial.editar'] as const) {
      expect(quem(a)).toEqual(['administrador']);
    }
  });

  it('clientes e produtos: administrador, gerente e faturista; preços e crédito: administrador e gerente', () => {
    expect(quem('cadastros.cliente.editar')).toEqual(['administrador', 'gerente', 'faturista']);
    expect(quem('cadastros.produto.editar')).toEqual(['administrador', 'gerente', 'faturista']);
    expect(quem('cadastros.preco.editar')).toEqual(['administrador', 'gerente']);
    expect(quem('cadastros.cliente.credito')).toEqual(['administrador', 'gerente']);
  });

  it('RN-CAD-07: saldo negativo só administrador e gerente', () => {
    expect(quem('cadastros.estoque.negativo')).toEqual(['administrador', 'gerente']);
  });

  it('regras fiscais, aprovar pedido e emitir nota seguem a matriz', () => {
    expect(quem('fiscal.regra.editar')).toEqual(['administrador', 'fiscal']);
    expect(quem('pedido.pedido.aprovar')).toEqual(['administrador', 'gerente']);
    expect(quem('faturamento.nota.emitir')).toEqual(['administrador', 'faturista', 'fiscal']);
  });

  it('RN-CORE-08: trocar ambiente fiscal só o administrador (o recado do Alexandre é conferido no core)', () => {
    expect(quem('core.ambiente.trocar')).toEqual(['administrador']);
  });

  it('"ver tudo" vale para todos os perfis (o vendedor é filtrado pela carteira no módulo)', () => {
    for (const a of ['cadastros.ver', 'pedido.ver', 'fiscal.ver', 'faturamento.ver', 'core.empresa.ver'] as const) {
      expect(quem(a)).toEqual([...PERFIS]);
    }
  });

  it('toda ação começa com um módulo conhecido e só lista perfis da RN-CORE-01', () => {
    for (const [acao, perfis] of Object.entries(PERMISSOES)) {
      expect(MODULOS).toContain(moduloDaAcao(acao as Acao));
      for (const p of perfis) expect(PERFIS).toContain(p as Perfil);
    }
  });
});
