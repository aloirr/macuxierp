import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SemPermissao } from '@/lib/api';
import { acoesDoUsuario, ROTA_USUARIOS } from '@/lib/telas/core';
import { telaDaRota } from '@/lib/telas';
import type { TelaLista } from '@/lib/descritor/tipos';
import { AVISO_SENHA_PROVISORIA } from '@macuxierp/core/web';
import { DialogoEscrita } from './dialogo-escrita';
import { PainelSegredo } from './painel-segredo';
import { ListaGenerica } from './lista-generica';

const estado = vi.hoisted(() => ({ falha: null as unknown, filtros: [] as Record<string, string>[] }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: (d: string) => { throw new Error(`REDIRECT ${d}`); }, notFound: () => { throw new Error('404'); } }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn(), ler: vi.fn() }));
vi.mock('@/lib/listas', () => ({ buscarPagina: async (_api: string, filtros: Record<string, string>) => { estado.filtros.push(filtros); if (estado.falha) throw estado.falha; return { itens: [], proximo_cursor: null }; } }));

const ID = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';

describe('403 da lista de usuários para quem não é administrador (RN-CORE-09)', () => {
  it('a API responde 403 e a tela mostra a mensagem fixa, sem lista', async () => {
    estado.falha = new SemPermissao();
    const tela = telaDaRota(ROTA_USUARIOS) as TelaLista;
    const h = renderToStaticMarkup(await ListaGenerica({ tela, rotaDaPagina: ROTA_USUARIOS, rota: ROTA_USUARIOS, busca: new URLSearchParams(), perfil: 'gerente', acesso: 't', fuso: 'America/Manaus' }));
    expect(h).toContain('Seu perfil não pode ver esta tela.');
    expect(h).not.toContain('<table');
    expect(h).not.toContain('Novo usuário');
  });
  it('administrador: lista vazia com o texto do módulo, botão Novo usuário e Exportar CSV', async () => {
    estado.falha = null;
    const tela = telaDaRota(ROTA_USUARIOS) as TelaLista;
    const h = renderToStaticMarkup(await ListaGenerica({ tela, rotaDaPagina: ROTA_USUARIOS, rota: ROTA_USUARIOS, busca: new URLSearchParams(), perfil: 'administrador', acesso: 't', fuso: 'America/Manaus' }));
    expect(h).toContain('Nenhum usuário cadastrado.');
    expect(h).toContain('Novo usuário');
    expect(h).toContain('Exportar CSV');
    expect(h).toContain('Só ativos');
  });
});

describe('auditoria: datas do filtro chegam à API como datetime ISO completo', () => {
  it('a tela guarda o dia na URL; a API recebe início e fim do dia no fuso da empresa e o CSV usa a mesma conversão', async () => {
    estado.falha = null;
    estado.filtros = [];
    const tela = telaDaRota('/core/auditoria') as TelaLista;
    const h = renderToStaticMarkup(await ListaGenerica({ tela, rotaDaPagina: '/core/auditoria', rota: '/core/auditoria', busca: new URLSearchParams('de=2026-11-01&ate=2026-11-24&entidade=usuario'), perfil: 'administrador', acesso: 't', fuso: 'America/Manaus' }));
    expect(estado.filtros[0]).toMatchObject({ entidade: 'usuario' }); // a conversão de de/ate é conferida em lib/telas/core.test.ts
    expect(h).toContain('value="2026-11-01"'); // o campo de data continua com o dia civil
    expect(h).toContain('/exportar-csv?'); // o CSV leva os mesmos filtros (a rota converte)
    expect(h).toContain('Nenhuma alteração neste período ou para este usuário.');
  });
});

describe('senha provisória exibida uma vez (RN-CORE-10)', () => {
  it('o painel mostra o valor, o aviso do módulo e só os botões Copiar e "Já anotei"; sem campo de entrada', () => {
    const h = renderToStaticMarkup(<PainelSegredo titulo="Senha provisória" rotulo="Entregue esta senha à pessoa:" valor="Xk7-Qm29-Rt" aviso={AVISO_SENHA_PROVISORIA} aoFechar={() => undefined} />);
    expect(h).toContain('Xk7-Qm29-Rt');
    expect(h).toContain('Anote esta senha agora: ela aparece uma única vez.');
    expect(h).toContain('role="dialog"');
    expect(h).toContain('aria-modal="true"');
    expect(h).toMatch(/<button[^>]*>Copiar<\/button>/);
    expect(h).toMatch(/<button[^>]*>Já anotei<\/button>/);
    expect(h).not.toContain('<input');
  });
});

describe('diálogo de edição por campos', () => {
  it('mostra os campos com o valor atual e confirma com o rótulo do módulo', () => {
    const editar = acoesDoUsuario({ id: ID, nome: 'Maria Souza', email: 'maria@exemplo.com.br', perfil: 'faturista', filial_ids: [ID], ativo: true, external_id: null, ultimo_acesso_em: null, updated_at: '2026-11-24T12:00:00.000Z' }, 'administrador')[0];
    const h = renderToStaticMarkup(
      <DialogoEscrita titulo="Editar usuário" rotuloConfirmar="Salvar" ocupado={false} campos={editar?.campos} validar={() => null} aoConfirmar={() => undefined} aoCancelar={() => undefined} />,
    );
    expect(h).toContain('value="Maria Souza"');
    expect(h).toMatch(/<option value="faturista" selected="">Faturista<\/option>/);
    expect(h).toContain('Salvar');
    expect(h).not.toContain('maria@exemplo.com.br'); // o e-mail não entra no diálogo
  });
});
