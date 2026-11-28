import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UsuarioConfig } from '@macuxierp/core/contracts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('@/lib/acoes-cliente', () => ({
  criarUsuarioAcao: vi.fn(), editarUsuarioAcao: vi.fn(), excluirUsuarioAcao: vi.fn(), inativarUsuarioAcao: vi.fn(), reativarUsuarioAcao: vi.fn(), redefinirSenhaUsuarioAcao: vi.fn(),
}));

import { BlocoUsuarios, DialogoSenha, MenuDoUsuario } from './usuarios';

const EMP = '11111111-1111-4111-8111-111111111111';
const u = (id: string, extra: Partial<UsuarioConfig> = {}): UsuarioConfig => ({
  id, nome: 'Ana Exemplo', email_mascarado: 'an****@exemplo.com', perfil: 'administrador', filial_ids: [], situacao: 'ativo', ultimo_acesso_em: '2026-11-27T20:42:00.000Z',
  deve_trocar_senha: false, ultimo_admin_ativo: false, acoes: ['editar', 'redefinir_senha', 'inativar', 'excluir'], ...extra,
});
const ANA = u('3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70', { ultimo_admin_ativo: true, acoes: ['editar', 'redefinir_senha'] });
const BRUNO = u('8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d', { nome: 'Bruno Exemplo', email_mascarado: 'br****@exemplo.com', perfil: 'faturista' });
const ELISA = u('9b3c5d7e-2f40-4b6c-8d8e-1f2a3b4c5d6e', { nome: 'Elisa Exemplo', perfil: 'fiscal', situacao: 'inativo', acoes: ['editar', 'reativar', 'excluir'] });
const bloco = (itens: UsuarioConfig[] | null) => renderToStaticMarkup(<BlocoUsuarios empresaId={EMP} itens={itens} fuso="America/Manaus" />);
const aberto = (x: UsuarioConfig) => renderToStaticMarkup(<MenuDoUsuario usuario={x} aoAcionar={() => undefined} abertoInicial />);

describe('Bloco Usuários da aba Empresa (Config v4, MC-0212)', () => {
  it('tabela com Nome, E-mail, Perfil, Situação, Último acesso e Ações ▾ por linha; e-mail só mascarado; contagem no título', () => {
    const h = bloco([ANA, BRUNO, ELISA]);
    for (const t of ['Nome', 'E-mail', 'Perfil', 'Situação', 'Último acesso']) expect(h).toContain(t);
    expect(h).toContain('· 3');
    expect(h).toContain('an****@exemplo.com');
    expect(h.match(/aria-label="Ações de /g)).toHaveLength(3);
    expect(h).toContain('>Ativo<');
    expect(h).toContain('>Inativo<');
  });
  it('etiqueta "último administrador" só na linha dele, ao lado do perfil', () => {
    const h = bloco([ANA, BRUNO]);
    expect(h.match(/último administrador/g)).toHaveLength(1);
    expect(h).toMatch(/Administrador<span class="etiqueta-ultimo-admin">último administrador<\/span>/);
  });
  it('barra do bloco: "+ Adicionar usuário" embaixo da tabela; nenhum diálogo nem senha na saída inicial', () => {
    const h = bloco([ANA]);
    expect(h.indexOf('+ Adicionar usuário')).toBeGreaterThan(h.lastIndexOf('</table>'));
    expect(h).not.toContain('role="dialog"');
    expect(h).not.toContain('senha-provisoria');
  });
  it('lista vazia: convida a adicionar o primeiro administrador; falha de leitura: erro com "Recarregar"', () => {
    expect(bloco([])).toContain('Nenhum usuário. Adicione o primeiro administrador.');
    const f = bloco(null);
    expect(f).toContain('Não foi possível carregar os usuários.');
    expect(f).toContain('>Recarregar<');
  });
  it('menu da linha: acoes[] na ordem, com Excluir por último; ativo tem Inativar, inativo tem Reativar', () => {
    const h = aberto(BRUNO);
    const pos = ['Editar', 'Redefinir senha', 'Inativar', 'Excluir'].map((t) => h.indexOf(`>${t}<`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(aberto(ELISA)).toContain('>Reativar<');
    expect(aberto(ELISA)).not.toContain('>Inativar<');
  });
  it('último administrador: sem Excluir nem Inativar no menu (a API não os manda); sem ações, sem menu', () => {
    const h = aberto(ANA);
    expect(h).toContain('>Editar<');
    expect(h).not.toContain('>Excluir<');
    expect(h).not.toContain('>Inativar<');
    expect(renderToStaticMarkup(<MenuDoUsuario usuario={u(ANA.id, { acoes: [] })} aoAcionar={() => undefined} />)).toBe('');
  });
});

describe('Senha provisória: mostrada uma vez e nunca guardada (regra 9, LGPD)', () => {
  it('o diálogo mostra a senha com Copiar e "Já entreguei", e o aviso de que não volta', () => {
    const h = renderToStaticMarkup(<DialogoSenha nome="Bruno Exemplo" senha="Zq7-secreta-XYZ99" aoFechar={() => undefined} />);
    expect(h).toContain('Zq7-secreta-XYZ99');
    expect(h).toContain('>Copiar<');
    expect(h).toContain('>Já entreguei<');
    expect(h).toContain('Esta senha não volta a aparecer');
    expect(h).toContain('role="dialog"');
  });
  it('o código do bloco não grava a senha em armazenamento, URL, cookie nem log; ela vive só no estado do componente', () => {
    const fonte = readFileSync(join(__dirname, 'usuarios.tsx'), 'utf8');
    expect(fonte).not.toMatch(/localStorage|sessionStorage|console\.|document\.cookie|history\.|router\.(push|replace)/);
    expect(fonte).toContain('setSenha(null)');
  });
});
