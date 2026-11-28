import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { quadroEmpresaFiscal, TEXTO_AMBIENTE_HOMOLOGACAO } from '@macuxierp/core/web';
import { AmbienteFiscal, Empresa } from '@macuxierp/core/contracts';
import { VistaAmbienteFiscal, VistaPerfis } from './vistas';
import { matrizDePerfis } from '@/lib/telas/core';
import { PERFIS, PERMISSOES } from '@macuxierp/platform-sdk';
import { PerfilComAcoes } from '@macuxierp/core/contracts';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn() }));

const F1 = '3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c70';
const F2 = '8a2b4c6d-1e3f-4a5b-9c7d-0e1f2a3b4c5d';
const empresa = Empresa.parse({
  id: F1, razao_social: 'Distribuidora Rio Negro Ltda', nome_fantasia: 'Rio Negro', cnpj: '11222333000181', ie: '041234567', fuso: 'America/Manaus', updated_at: '2026-11-24T12:00:00.000Z',
});
const amb = (filial_id: string, ambiente: 'homologacao' | 'producao') => AmbienteFiscal.parse({ filial_id, ambiente, recado_aprovacao: null });

describe('ambiente fiscal no BKO (T-0088): só exibição', () => {
  it('mostra empresa, filiais pelo nome do cadastros e o texto de homologação; nenhum botão, formulário nem troca', () => {
    const h = renderToStaticMarkup(<VistaAmbienteFiscal quadro={quadroEmpresaFiscal(empresa, [amb(F1, 'homologacao'), amb(F2, 'producao')], { [F1]: 'Matriz Manaus', [F2]: 'Filial Parintins' })} />);
    expect(h).not.toContain('Distribuidora Rio Negro Ltda'); // RD-2397: a ficha da empresa mora na aba Empresa
    expect(h).toContain('Matriz Manaus');
    expect(h).toContain('Filial Parintins');
    expect(h).toContain(TEXTO_AMBIENTE_HOMOLOGACAO);
    expect(h).not.toMatch(/<button|<form|<input|<select/);
    for (const t of ['Voltar para homologação', 'Trocar', 'Mudar para produção', 'Ir para produção', 'Passar para produção']) expect(h, t).not.toContain(t);
  });
  it('empresa sem filial com ambiente avisa em vez de tabela vazia', () => {
    expect(renderToStaticMarkup(<VistaAmbienteFiscal quadro={quadroEmpresaFiscal(empresa, [])} />)).toContain('Nenhuma filial configurada.');
  });
});

describe('perfis e permissões no BKO (T-0087)', () => {
  const itens = PerfilComAcoes.array().parse(PERFIS.map((perfil) => ({ perfil, acoes: Object.entries(PERMISSOES).filter(([, ps]) => (ps as readonly string[]).includes(perfil)).map(([a]) => a) })));
  it('tabela com uma coluna por perfil, em português, e só leitura (sem botão nem campo)', () => {
    const h = renderToStaticMarkup(<VistaPerfis matriz={matrizDePerfis(itens)} />);
    for (const p of ['Administrador', 'Gerente', 'Faturista', 'Fiscal', 'Vendedor', 'Leitura', 'Analista de implantação']) expect(h, p).toContain(p);
    expect(h).toContain('title="core.usuario.gerir">usuario.gerir<'); // o grupo diz o módulo; o código completo fica no title
    expect(h).toContain('Plataforma');
    expect(h).not.toMatch(/<button|<form|<input|<select/);
    expect(h).toContain('scope="col"');
    expect(h).toContain('scope="row"');
  });
});
