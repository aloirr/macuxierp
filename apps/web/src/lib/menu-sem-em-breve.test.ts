import { describe, expect, it } from 'vitest';
import { PERFIS, type EuResposta } from '@macuxierp/platform-sdk';
import { PAGINAS_INTEGRACAO_FDV } from '@macuxierp/integracao-fdv/web';
import { MANIFESTOS } from './manifestos';
import { montarMenu, resolverPagina } from './menu';
import { PAGINAS_REGISTRADAS, ROTAS_SEM_TELA } from './paginas';
import { telaDaRota } from './telas';
import { ROTA_BANDEIRA } from './telas/bandeira';
import { ROTA_AMBIENTE_FISCAL, ROTA_EMPRESA, ROTA_PERFIS } from './telas/core';

/** Rotas com componente próprio na página `[modulo]/[...pagina]` (quadros e o monitor do FDV): não passam pelo renderizador genérico. */
const COM_COMPONENTE_PROPRIO = new Set<string>([ROTA_PERFIS, ROTA_EMPRESA, ROTA_AMBIENTE_FISCAL, ROTA_BANDEIRA, ...PAGINAS_INTEGRACAO_FDV.filter((p) => p.tipo === 'monitor').map((p) => p.rota)]);

const TODOS = MANIFESTOS.map((m) => ({ id: m.id, menus: [...(m.web?.menus ?? [])] })) as EuResposta['modulos'];

describe('menu sem páginas "em breve" (decisão do PO, v0.3.28)', () => {
  it('nenhum item visível do menu, de nenhum perfil, abre numa tela sem componente (cai em "Disponível em breve")', () => {
    for (const perfil of PERFIS) {
      const menu = montarMenu(TODOS, MANIFESTOS, perfil);
      for (const g of menu) {
        for (const i of g.itens) {
          const r = resolverPagina(menu, i.href, perfil);
          const rota = r?.pagina?.rota ?? '';
          const pronta = r?.pagina !== undefined && (telaDaRota(rota) !== undefined || COM_COMPONENTE_PROPRIO.has(rota) || r.pagina.aviso !== undefined);
          expect({ perfil, item: i.rotulo, href: i.href, pronta }).toEqual({ perfil, item: i.rotulo, href: i.href, pronta: true });
        }
      }
    }
  });

  it('saem do menu: Estoque, Condições de pagamento, Equipe e carteira, Tabelas oficiais e Regras fiscais; ficam Clientes, Produtos, Tabelas de preço e Filiais', () => {
    const rotulos = montarMenu(TODOS, MANIFESTOS, 'administrador').flatMap((g) => g.itens.map((i) => i.rotulo));
    for (const fora of ['Estoque', 'Condições de pagamento', 'Equipe e carteira', 'Tabelas oficiais', 'Regras fiscais']) expect(rotulos).not.toContain(fora);
    for (const dentro of ['Clientes', 'Produtos', 'Tabelas de preço', 'Filiais', 'Usuários e perfis', 'Pedidos']) expect(rotulos).toContain(dentro);
  });

  it('Empresa (T-0125): o item abre na própria Empresa, com o Ambiente fiscal como bloco; Ambiente fiscal, Certificado A1 e Exportar saem do menu', () => {
    const grupo = montarMenu(TODOS, MANIFESTOS, 'administrador').find((g) => g.modulo === 'core');
    expect(grupo?.itens.find((i) => i.rotulo === 'Empresa')?.href).toBe(ROTA_EMPRESA);
    for (const rota of ['/core/empresa/certificado', '/core/empresa/exportacao']) {
      expect(ROTAS_SEM_TELA.has(rota)).toBe(true);
      expect(PAGINAS_REGISTRADAS.find((p) => p.rota === rota)?.ocultaNoMenu).toBe(true);
    }
    expect(ROTAS_SEM_TELA.has(ROTA_EMPRESA)).toBe(false);
    expect(PAGINAS_REGISTRADAS.find((p) => p.rota === ROTA_EMPRESA)?.ocultaNoMenu).not.toBe(true);
    // o Ambiente fiscal tem tela (bloco da Empresa) e só abre pela URL
    expect(ROTAS_SEM_TELA.has(ROTA_AMBIENTE_FISCAL)).toBe(false);
    expect(PAGINAS_REGISTRADAS.find((p) => p.rota === ROTA_AMBIENTE_FISCAL)?.ocultaNoMenu).toBe(true);
  });

  it('nenhuma tela linka para "Editar pedido": a rota /pedido/pedidos/:id/editar não está registrada', () => {
    expect(PAGINAS_REGISTRADAS.find((p) => p.rota.endsWith('/:id/editar'))).toBeUndefined();
  });
});
