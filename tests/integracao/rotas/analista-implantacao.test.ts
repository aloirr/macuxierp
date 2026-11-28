/**
 * T-0050 (E6.5), RN-CORE-09: o perfil `analista_implantacao` leva 403 PERFIL_SEM_PERMISSAO, antes de abrir a transação.
 * O autorizacao-rotas confere o analista em empresa.ver e perfil.ver; aqui, usuario.* e licenca.*.
 * Controle positivo: na rota de cadastros.ver o analista passa da checagem de perfil (não é 403 PERFIL_SEM_PERMISSAO).
 * As rotas vêm do plugin real (montarModulos de produção, tests/apoio/api-memoria.ts): rota nova entra sozinha.
 */
import { describe, expect, it } from 'vitest';
import { PERFIS, type Perfil } from '../../../packages/platform-sdk/src/index';
import { montarApiMemoria, usarApiMemoria } from '../../apoio/api-memoria';

const ANALISTA = 'analista_implantacao' as Perfil;
const GRUPOS: Record<string, (acao: string) => boolean> = {
  'core.usuario.*': (a) => a.startsWith('core.usuario.'),
  'core.licenca.*': (a) => a.startsWith('core.licenca.'),
};
const ID = '9f000000-0000-4000-8000-000000000001';
const urlDe = (modulo: string, caminho: string) => `/v1/${modulo}${caminho.replace(/:[a-z_]+/g, ID)}`;

const referencia = await montarApiMemoria();
const rotasDe = (modulo: string) => referencia.modulos.find((m) => m.manifesto.id === modulo)!.rotas;
const ROTAS_CORE = rotasDe('core').filter((r) => Object.values(GRUPOS).some((g) => g(r.acao)));
const ROTAS_CADASTROS_VER = rotasDe('cadastros').filter((r) => r.acao === 'cadastros.ver' && r.metodo === 'GET' && !r.multipart);
await referencia.app.close();

describe('RN-CORE-09: analista_implantacao fora do core (T-0050 E6.5)', () => {
  const api = usarApiMemoria();

  it('o PERFIS do SDK tem o analista_implantacao (se sumir, a matriz falha em vez de pular)', () => {
    expect(PERFIS).toContain(ANALISTA);
  });

  it.each(Object.keys(GRUPOS))('o plugin real tem rota de %s (a matriz abaixo não passa em branco)', (grupo) => {
    expect(ROTAS_CORE.filter((r) => GRUPOS[grupo]!(r.acao)).length).toBeGreaterThan(0);
  });

  it.each(ROTAS_CORE.map((r) => ({ nome: `${r.metodo} /v1/core${r.caminho} (${r.acao})`, r })))('$nome: 403 PERFIL_SEM_PERMISSAO, sem abrir transação', async ({ r }) => {
    const a = await api();
    const res = await a.app.inject({
      method: r.metodo,
      url: urlDe('core', r.caminho),
      headers: a.auth(ANALISTA),
      ...(r.metodo === 'GET' || r.metodo === 'DELETE' ? {} : { payload: {} }),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ codigo: 'PERFIL_SEM_PERMISSAO' });
    expect(a.banco.aberturas).toEqual([]);
    expect(a.auditoria.registros).toEqual([]);
  });

  it('controle positivo: nas rotas GET de cadastros.ver o analista passa da checagem de perfil', async () => {
    expect(ROTAS_CADASTROS_VER.length).toBeGreaterThan(0);
    const a = await api();
    for (const r of ROTAS_CADASTROS_VER) {
      const res = await a.app.inject({ method: 'GET', url: urlDe('cadastros', r.caminho), headers: a.auth(ANALISTA) });
      // as rotas /exportar (CSV, #1005) respondem texto quando passam; o 403 de perfil é sempre JSON
      const json = String(res.headers['content-type'] ?? '').includes('application/json');
      expect(res.statusCode === 403 && json ? res.json<{ codigo?: string }>().codigo : undefined, `GET /v1/cadastros${r.caminho}`).not.toBe('PERFIL_SEM_PERMISSAO');
    }
  });
});
