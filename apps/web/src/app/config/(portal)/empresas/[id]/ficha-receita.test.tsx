import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FichaReceitaPlanaMascarada } from '@macuxierp/core/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { dataCivil, enderecoEmLinha, linhasDaFicha, origemDaConsulta } from '@/lib/config/ficha';
import { FichaReceita } from './ficha-receita';

const ID = '11111111-1111-4111-8111-111111111111';
const ficha = FichaReceitaPlanaMascarada.parse({
  nome_fantasia: 'Ficticia', ie: '123456789', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cep: '69000000', municipio_ibge: '1302603', uf: 'AM',
  email_mascarado: 'ma****@exemplo.com.br', telefone_mascarado: '(92) ****-1234', cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: 'Ativa', situacao_cadastral_data: '2020-01-31',
  data_abertura: '2020-01-31', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'Demais', cnae_secundarios: ['4712100', '4781400'], receita_fonte: 'fonte-ficticia', receita_consultada_em: '2026-11-24T16:00:00.000Z',
});
const render = (f: typeof ficha | null = ficha, editavel = true) => renderToStaticMarkup(<FichaReceita empresaId={ID} ficha={f} fuso="America/Manaus" editavel={editavel} />);

describe('ficha da Receita na aba Empresa (T-0101)', () => {
  it('mostra a ficha, com e-mail e telefone como o banco mascarou e um Revelar por campo, sem repetir o bloco Dados', () => {
    const h = render();
    for (const t of ['Ficticia', '123456789', 'Ativa', '31/01/2020', 'Sociedade Empresária Limitada', 'Demais', 'Simples Nacional', '4711302', 'Rua A, 10, Centro, CEP 69000-000', 'Consultada em 24/11/2026 12:00']) expect(h).toContain(t);
    for (const t of ['Razão social', 'CNPJ', 'Cidade/UF', 'BrasilAPI', 'fonte-ficticia']) expect(h).not.toContain(t);
    expect(h).toContain('CNAE secundários');
    expect(h).toContain('4712100');
    expect(h).toContain('ma****@exemplo.com.br');
    expect(h).toContain('(92) ****-1234');
    expect(h.match(/>Revelar</g)).toHaveLength(2);
    expect(h).toContain('aria-label="Revelar e-mail"');
    expect(h).toContain('aria-label="Revelar telefone"');
    expect(h).toContain('Atualizar pela Receita');
  });
  it('sem ficha: orientação curta e o botão Atualizar; empresa encerrada desabilita o botão', () => {
    const h = render(null);
    expect(h).toContain('Ainda não consultada. Use Atualizar pela Receita.');
    expect(h).not.toContain('Revelar');
    expect(render(null, false)).toMatch(/<button[^>]*disabled=""[^>]*>Atualizar pela Receita/);
  });
  it('sem e-mail ou telefone: traço e nenhum Revelar para o campo', () => {
    const h = render({ ...ficha, email_mascarado: null, telefone_mascarado: null });
    expect(h).not.toContain('Revelar');
  });
  it('linhas puras: datas civis, endereço parcial e consulta no fuso da empresa', () => {
    expect(dataCivil(null)).toBe('—');
    expect(enderecoEmLinha({ logradouro: null, numero: null, complemento: null, bairro: null, cep: null })).toBe('—');
    expect(origemDaConsulta(ficha, 'America/Manaus')).toContain('12:00');
    expect(origemDaConsulta({ ...ficha, receita_consultada_em: null }, 'America/Manaus')).toBeNull();
    expect(linhasDaFicha(ficha).map((l) => l.rotulo)).toEqual(['Nome fantasia', 'Inscrição estadual', 'Situação cadastral', 'Abertura', 'Natureza jurídica', 'Porte', 'Regime', 'CNAE principal', 'Endereço']);
  });
  it('o componente não grava o valor revelado em armazenamento nem em log', () => {
    for (const arq of [join(__dirname, 'ficha-receita.tsx'), join(__dirname, '../../../../../components/revelar-mascarado.tsx')]) {
      expect(readFileSync(arq, 'utf8')).not.toMatch(/localStorage|sessionStorage|console\.|document\.cookie/);
    }
  });
});
