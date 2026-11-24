import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ConfiguracaoFilialResposta } from '@macuxierp/faturamento/contracts';
import type { Perfil } from '@macuxierp/platform-sdk';
import { ROTA_BANDEIRA, cartoesDaBandeira } from '@/lib/telas/bandeira';
import { VistaBandeira } from './vista-bandeira';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn() }));

const A = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const B = '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d';
const FILIAIS = [{ id: A, nome: 'Matriz Manaus' }, { id: B, nome: 'Filial Parintins' }];
const cfg = (filial_id: string, ligada: boolean): ConfiguracaoFilialResposta => ({ filial_id, faturamento_real_nfe_simulada: ligada, ambiente: 'homologacao' });
const html = (perfil: Perfil, configs: Record<string, ConfiguracaoFilialResposta | null> = { [A]: cfg(A, false), [B]: cfg(B, true) }) =>
  renderToStaticMarkup(<VistaBandeira cartoes={cartoesDaBandeira(perfil, FILIAIS, configs)} rota={ROTA_BANDEIRA} rotaDaPagina={ROTA_BANDEIRA} />);
const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');

describe('página da bandeira por filial (T-0088)', () => {
  it('administrador: um cartão por filial, com selos de situação e ambiente e o botão certo em cada uma', () => {
    const h = html('administrador');
    expect(h.match(/class="cartao-bandeira"/g)).toHaveLength(2);
    expect(h).toContain('Matriz Manaus');
    expect(h).toContain('Filial Parintins');
    expect(h).toContain('Desligada');
    expect(h).toContain('Ligada');
    expect(h).toMatch(/<button[^>]*>Ligar<\/button>/);
    expect(h).toMatch(/<button[^>]*>Desligar<\/button>/);
  });
  it('gerente, faturista, fiscal e leitura veem a situação sem nenhum botão', () => {
    for (const p of ['gerente', 'faturista', 'fiscal', 'leitura'] as const) {
      const h = html(p);
      expect(h, p).not.toContain('<button');
      expect(h, p).toContain('Ligada');
    }
  });
  it('não oferece troca de ambiente: nem botão de produção nem texto de troca', () => {
    const h = html('administrador');
    for (const t of ['produção fiscal', 'Voltar para homologação', 'Trocar ambiente']) expect(h, t).not.toContain(t);
  });
  it('filial sem leitura mostra o aviso no cartão e segue com as outras', () => {
    const h = html('administrador', { [A]: null, [B]: cfg(B, false) });
    expect(h).toContain('role="alert"');
    expect(h.match(/<button/g)).toHaveLength(1);
  });
  it('sem filial cadastrada, a página explica em vez de ficar vazia', () => {
    expect(renderToStaticMarkup(<VistaBandeira cartoes={[]} rota={ROTA_BANDEIRA} rotaDaPagina={ROTA_BANDEIRA} />)).toContain('Nenhuma filial cadastrada.');
  });
  it('🟡 da marca: Ligar e Desligar com a mesma largura mínima; no 390 cada filial é um cartão e o botão é inteiro com 44 px', () => {
    expect(css).toMatch(/\.bandeira-acoes > \.barra-acoes > button \{ min-width: 7\.5rem; \}/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*\.cartoes-bandeira \{ grid-template-columns: minmax\(0, 1fr\); \}\s*\.bandeira-acoes > \.barra-acoes > button \{ width: 100%; min-height: 44px; \}/);
    expect(css).toMatch(/\.cartao-bandeira \{[^}]*border-radius: 10px/);
  });
});
