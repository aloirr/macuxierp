import { describe, expect, it } from 'vitest';
import { GRUPOS_REGRA } from '@macuxierp/fiscal/web';
import type { Perfil } from '@macuxierp/platform-sdk';
import { MANIFESTOS } from '../manifestos';
import { montarMenu, resolverPagina } from '../menu';
import { PAGINAS_REGISTRADAS } from '../paginas';
import { telaDaRota } from '../telas';
import type { Linha, TelaQuadro } from '../descritor/tipos';
import { LISTA_CATALOGO, LISTA_REGRAS, ROTA_CATALOGO, ROTA_REGRA, ROTA_REGRAS_FISCAIS, ROTA_REGRA_NOVA } from './fiscal';

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const FISCAL = [{ id: 'fiscal' as const, menus: ['Regras fiscais'] }];
const PERFIS: readonly Perfil[] = ['administrador', 'gerente', 'faturista', 'fiscal', 'vendedor', 'leitura'];

describe('regras fiscais no shell (T-0127)', () => {
  it('as quatro rotas têm tela; lista e catálogo são do renderizador genérico', () => {
    expect(telaDaRota(ROTA_REGRAS_FISCAIS)).toBe(LISTA_REGRAS);
    expect(telaDaRota(ROTA_CATALOGO)).toBe(LISTA_CATALOGO);
    expect(telaDaRota(ROTA_REGRA_NOVA)?.tipo).toBe('quadro');
    expect(telaDaRota(ROTA_REGRA)?.tipo).toBe('quadro');
  });

  it('menu: só com a licença do módulo e a permissão fiscal.ver; nova regra e detalhe não aparecem no menu (regra 6)', () => {
    for (const perfil of PERFIS) {
      const sem = montarMenu([{ id: 'core', menus: [] }], MANIFESTOS, perfil, PAGINAS_REGISTRADAS);
      expect(sem.some((g) => g.modulo === 'fiscal'), `${perfil} sem licença`).toBe(false);
    }
    const m = montarMenu(FISCAL, MANIFESTOS, 'fiscal', PAGINAS_REGISTRADAS);
    expect(m.find((g) => g.modulo === 'fiscal')?.itens.map((i) => i.href)).toEqual([ROTA_REGRAS_FISCAIS]);
    expect(resolverPagina(m, ROTA_CATALOGO, 'fiscal', PAGINAS_REGISTRADAS)?.pagina?.titulo).toBe('Catálogo base');
  });

  it('lista: filtros da URL, busca por NCM ou CFOP, CSV e "Nova regra" só com fiscal.regra.editar', () => {
    expect(LISTA_REGRAS.filtrosTela.map((f) => f.chave)).toEqual(['tributo', 'uf_origem', 'uf_destino', 'crt', 'situacao']);
    expect(LISTA_REGRAS.pagina.csv).toBeDefined();
    expect(LISTA_REGRAS.pagina.busca).toBe(true);
    expect(LISTA_REGRAS.novo).toMatchObject({ rotulo: 'Nova regra', criar: 'fiscal.regra.editar', rota: ROTA_REGRA_NOVA });
    expect(LISTA_REGRAS.rotaDaLinha?.({ id: ID })).toBe(`/fiscal/regras-fiscais/${ID}`);
  });

  it('colunas e campos em português, nunca o nome da coluna (NCM, CST e MVA com rótulo e dica)', () => {
    const rotulos = LISTA_REGRAS.colunas('fiscal', 'America/Manaus').map((c) => c.rotulo);
    expect(rotulos).toEqual(expect.arrayContaining(['NCM (produto)', 'Situação tributária', 'Margem ST (MVA)', 'Regime (CRT)']));
    for (const r of [...rotulos, ...LISTA_CATALOGO.colunas('fiscal', 'America/Manaus').map((c) => c.rotulo), ...LISTA_REGRAS.filtrosTela.map((f) => f.rotulo)]) expect(r, r).not.toMatch(/_|^CST/);
    for (const c of GRUPOS_REGRA.flatMap((g) => g.campos)) expect(c.rotulo, c.nome).not.toMatch(/_/);
  });

  it('catálogo: a coluna Título tem largura mínima para não quebrar em várias linhas', () => {
    expect(LISTA_CATALOGO.colunas('fiscal', 'America/Manaus').find((c) => c.id === 'titulo')?.largura).toBe('24rem');
  });

  it('catálogo: "Aplicar" só para quem edita e só no modelo aplicável; confirma e envia { confirmo: true }', () => {
    const acao = LISTA_CATALOGO.acaoDaLinha!;
    const pronta: Linha = { id: ID, chave: 'icms-sp', aplicavel: true };
    expect(acao.acao(pronta, 'fiscal')).toMatchObject({ rotulo: 'Aplicar', metodo: 'POST', caminho: `/v1/fiscal/catalogo/${ID}/aplicar`, entrada: 'confirmar' });
    expect(acao.acao(pronta, 'administrador')).not.toBeNull();
    for (const p of ['gerente', 'faturista', 'vendedor', 'leitura'] as const) expect(acao.acao(pronta, p), p).toBeNull();
    expect(acao.acao({ ...pronta, aplicavel: false }, 'fiscal')).toBeNull();
    const a = acao.acao(pronta, 'fiscal')!;
    expect(acao.validarAcao(a, { texto: '', chave: 'k' })).toEqual({ ok: true, corpo: { confirmo: true } });
  });

  it('o formulário escreve com POST, PUT e DELETE no caminho da regra', () => {
    const t = telaDaRota(ROTA_REGRA_NOVA) as TelaQuadro;
    expect(t.escritas.map((e) => `${e.metodo} ${e.caminho}`)).toEqual(['POST /v1/fiscal/regras', 'PUT /v1/fiscal/regras/:id', 'DELETE /v1/fiscal/regras/:id']);
  });

  it('a linha da lista vira texto', () => {
    const l = LISTA_REGRAS.linha({ tributo: 'icms', ncm_prefixo: null, uf_destino: 'SP', crt: 3, codigo: '00', aliquota_icms: 180000, mva_original: null, versao: '1', vigencia_inicio: '2026-01-01', vigencia_fim: null, situacao: 'vigente' }, 'America/Manaus');
    expect(l).toMatchObject({ tributo: 'ICMS', ncm_prefixo: 'Todos', aliquota_icms: '18%', crt: '3', situacao: 'Vigente' });
  });
});
