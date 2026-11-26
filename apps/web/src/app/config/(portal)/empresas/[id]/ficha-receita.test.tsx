import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FichaReceitaPlanaMascarada } from '@macuxierp/core/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { dataCivil, enderecoEmLinha, estadoDaFicha, linhasDaFicha, origemDaConsulta, textoCnae } from '@/lib/config/ficha';
import { FichaReceita } from './ficha-receita';

const ID = '11111111-1111-4111-8111-111111111111';
const ficha = FichaReceitaPlanaMascarada.parse({
  nome_fantasia: 'Ficticia', ie: '123456789', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cep: '69000000', municipio_ibge: '1302603', uf: 'AM',
  email_mascarado: 'ma****@exemplo.com.br', telefone_mascarado: '(92) ****-1234', cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: 'Ativa', situacao_cadastral_data: '2020-01-31',
  data_abertura: '2020-01-31', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'Demais', cnae_secundarios: ['4712100', '4781400'], receita_fonte: 'fonte-ficticia', receita_consultada_em: '2026-11-24T16:00:00.000Z',
});
const toda = Object.fromEntries(Object.keys(ficha).map((k) => [k, null])) as unknown as typeof ficha;
const render = (f: typeof ficha | null = ficha, editavel = true) => renderToStaticMarkup(<FichaReceita empresaId={ID} ficha={f} fuso="America/Manaus" editavel={editavel} />);

describe('ficha da Receita na aba Empresa (T-0101)', () => {
  it('mostra a ficha, com e-mail e telefone como o banco mascarou e um Mostrar por campo, sem repetir o bloco Dados', () => {
    const h = render();
    for (const t of ['Ficticia', '123456789', 'Ativa', '31/01/2020', 'Sociedade Empresária Limitada', 'Demais', 'Simples Nacional', '4711-3/02', 'Rua A, 10, Centro, CEP 69000-000', 'Consultada em 24/11/2026 12:00']) expect(h).toContain(t);
    for (const t of ['Razão social', 'CNPJ', 'Cidade/UF', 'BrasilAPI', 'fonte-ficticia']) expect(h).not.toContain(t);
    expect(h).toContain('CNAE secundários');
    expect(h).toContain('4712-1/00');
    expect(h).toContain('4781-4/00');
    expect(h).toContain('ma****@exemplo.com.br');
    expect(h).toContain('(92) ****-1234');
    expect(h.match(/>Mostrar</g)).toHaveLength(2);
    expect(h).toContain('aria-label="Mostrar e-mail"');
    expect(h).toContain('aria-label="Mostrar telefone"');
    expect(h).not.toContain('Revelar');
    expect(h).toContain('Atualizar pela Receita');
  });
  it('sem ficha: orientação curta e o botão Atualizar; empresa encerrada desabilita o botão', () => {
    const h = render(null);
    expect(h).toContain('Ainda não consultada.');
    expect(h).not.toContain('Mostrar');
    expect(render(null, false)).toMatch(/<button[^>]*disabled=""[^>]*>Atualizar pela Receita/);
  });
  it('sem consulta (ficha nula ou toda vazia): um só estado vazio, sem nenhum "—"', () => {
    for (const f of [null, toda]) {
      const h = render(f);
      expect(h.split('Ainda não consultada.').length - 1).toBe(1);
      expect(h).not.toContain('—');
      expect(h).not.toContain('<dl');
      expect(h.match(/>Atualizar pela Receita</g)).toHaveLength(1);
    }
  });
  it('consultada mas sem dados na Receita: cabeçalho com a data e o botão, texto próprio e nenhum "—" (RD-2201)', () => {
    const h = render({ ...toda, receita_consultada_em: '2026-11-24T16:00:00.000Z' });
    expect(h).toContain('Consultada em 24/11/2026 12:00');
    expect(h).toContain('Sem dados na Receita.');
    expect(h).not.toContain('Ainda não consultada');
    expect(h).not.toContain('—');
    expect(h).not.toContain('<dl');
    expect(h.match(/>Atualizar pela Receita</g)).toHaveLength(1);
  });
  it('CNAE: "NNNN-N/NN · Descrição" no principal e nos secundários; sem descrição, só o código; secundários sem descritos usam os códigos', () => {
    const h = render({ ...ficha, cnae_principal_descricao: 'COMÉRCIO VAREJISTA', cnae_secundarios_descritos: [{ codigo: '4712100', descricao: 'MINIMERCADOS' }, { codigo: '4781400', descricao: null }] });
    expect(h).toContain('4711-3/02 · COMÉRCIO VAREJISTA');
    expect(h).toContain('<li>4712-1/00 · MINIMERCADOS</li>');
    expect(h).toContain('<li>4781-4/00</li>');
    expect(render({ ...ficha, cnae_secundarios_descritos: null })).toContain('<li>4712-1/00</li>');
    expect(textoCnae('123', 'X')).toBe('123 · X');
  });
  it('três estados da ficha: nunca consultada, consultada sem dados e com dados', () => {
    const consultada = { ...toda, receita_fonte: 'x', receita_consultada_em: '2026-11-24T16:00:00.000Z', cnae_secundarios: [], cnae_secundarios_descritos: [] };
    expect(estadoDaFicha(null)).toBe('nunca');
    expect(estadoDaFicha({ ...ficha, receita_consultada_em: null })).toBe('nunca');
    expect(estadoDaFicha(consultada)).toBe('sem_dados');
    expect(estadoDaFicha({ ...consultada, municipio_nome: 'Manaus' })).toBe('com_dados');
    expect(estadoDaFicha({ ...consultada, cnae_principal_descricao: 'X' })).toBe('com_dados');
    expect(estadoDaFicha({ ...consultada, cnae_secundarios_descritos: [{ codigo: '4712100', descricao: null }] })).toBe('com_dados');
    expect(estadoDaFicha(ficha)).toBe('com_dados');
  });
  it('o endereço da ficha não repete a cidade/UF, que fica só no bloco Dados (RD-2200, RD-2033)', () => {
    const h = render();
    expect(h).toContain('Rua A, 10, Centro, CEP 69000-000');
    expect(h).not.toContain('Manaus/AM');
    expect(enderecoEmLinha(ficha)).toBe('Rua A, 10, Centro, CEP 69000-000');
  });
  it('sem e-mail ou telefone: traço e nenhum Mostrar para o campo', () => {
    const h = render({ ...ficha, email_mascarado: null, telefone_mascarado: null });
    expect(h).not.toContain('Mostrar');
  });
  it('linhas puras: datas civis, endereço parcial e consulta no fuso da empresa', () => {
    expect(dataCivil(null)).toBe('—');
    expect(enderecoEmLinha({ logradouro: null, numero: null, complemento: null, bairro: null, cep: null })).toBe('—');
    expect(origemDaConsulta(ficha, 'America/Manaus')).toContain('12:00');
    expect(origemDaConsulta({ ...ficha, receita_consultada_em: null }, 'America/Manaus')).toBeNull();
    expect(linhasDaFicha(ficha).map((l) => l.rotulo)).toEqual(['Nome fantasia', 'Inscrição estadual', 'Situação cadastral', 'Abertura', 'Natureza jurídica', 'Porte', 'Regime', 'CNAE principal', 'Endereço']);
  });
  it('o componente não grava o valor mostrado em armazenamento nem em log', () => {
    for (const arq of [join(__dirname, 'ficha-receita.tsx'), join(__dirname, '../../../../../components/revelar-mascarado.tsx')]) {
      expect(readFileSync(arq, 'utf8')).not.toMatch(/localStorage|sessionStorage|console\.|document\.cookie/);
    }
  });
});
