import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FichaReceitaMascarada } from '@macuxierp/core/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { cnaeEmTexto, dataCivil, enderecoEmLinha, linhasDaFicha, origemDaConsulta } from '@/lib/config/ficha';
import { FichaReceita } from './ficha-receita';

const ID = '11111111-1111-4111-8111-111111111111';
const ficha = FichaReceitaMascarada.parse({
  razao_social: 'Empresa Ficticia Ltda', nome_fantasia: 'Ficticia', cnpj: '11222333000181', situacao_cadastral: 'Ativa', data_abertura: '2020-01-31', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'Demais',
  cnae_principal: { codigo: '4711302', descricao: 'Comércio varejista' }, cnae_secundarios: [{ codigo: '4712100', descricao: 'Minimercados' }, { codigo: '4781400', descricao: null }],
  endereco: { logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cep: '69000000', municipio: 'Manaus', municipio_ibge: '1302603', uf: 'AM' },
  regime: 'simples', consultado_em: '2026-11-24T16:00:00.000Z', fonte: 'brasilapi', email_mascarado: 'ma****@exemplo.com.br', telefone_mascarado: '(92) ****-1234',
});
const render = (f: typeof ficha | null = ficha, editavel = true) => renderToStaticMarkup(<FichaReceita empresaId={ID} ficha={f} fuso="America/Manaus" editavel={editavel} />);

describe('ficha da Receita na aba Empresa (T-0101)', () => {
  it('mostra a ficha completa, com e-mail e telefone MASCARADOS e um Revelar por campo', () => {
    const h = render();
    for (const t of ['Empresa Ficticia Ltda', 'Ficticia', '11.222.333/0001-81', 'Ativa', '31/01/2020', 'Sociedade Empresária Limitada', 'Demais', 'Simples Nacional', '4711302 · Comércio varejista', 'Rua A, 10, Centro, Manaus/AM, CEP 69000-000', 'BrasilAPI']) expect(h).toContain(t);
    expect(h).toContain('CNAE secundários');
    expect(h).toContain('4712100 · Minimercados');
    expect(h).toContain('ma****@exemplo.com.br');
    expect(h).toContain('(92) ****-1234');
    expect(h.match(/>Revelar</g)).toHaveLength(2);
    expect(h).toContain('aria-label="Revelar e-mail"');
    expect(h).toContain('aria-label="Revelar telefone"');
    expect(h).toContain('Atualizar pela Receita');
  });
  it('sem ficha: traço, orientação e o botão Atualizar; empresa encerrada desabilita o botão', () => {
    const h = render(null);
    expect(h).toContain('Sem ficha da Receita ainda');
    expect(h).not.toContain('Revelar');
    expect(render(null, false)).toMatch(/<button[^>]*disabled=""[^>]*>Atualizar pela Receita/);
  });
  it('sem e-mail ou telefone: traço e nenhum Revelar para o campo', () => {
    const h = render({ ...ficha, email_mascarado: null, telefone_mascarado: null });
    expect(h).not.toContain('Revelar');
  });
  it('linhas puras: datas civis, endereço parcial e consulta no fuso da empresa', () => {
    expect(dataCivil(null)).toBe('—');
    expect(enderecoEmLinha({ logradouro: null, numero: null, complemento: null, bairro: null, cep: null, municipio: null, municipio_ibge: null, uf: null })).toBe('—');
    expect(cnaeEmTexto({ codigo: '4781400', descricao: null })).toBe('4781400');
    expect(origemDaConsulta(ficha, 'America/Manaus')).toContain('12:00');
    expect(linhasDaFicha(ficha).map((l) => l.rotulo)).toEqual(['Razão social', 'Nome fantasia', 'CNPJ', 'Situação cadastral', 'Abertura', 'Natureza jurídica', 'Porte', 'Regime', 'CNAE principal', 'Endereço']);
  });
  it('o componente não grava o valor revelado em armazenamento nem em log', () => {
    const fonte = readFileSync(join(__dirname, 'ficha-receita.tsx'), 'utf8');
    expect(fonte).not.toMatch(/localStorage|sessionStorage|console\.|document\.cookie/);
  });
});
