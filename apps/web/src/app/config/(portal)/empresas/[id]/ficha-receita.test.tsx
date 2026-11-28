import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FichaReceitaPlanaMascarada } from '@macuxierp/core/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { estadoDaFicha, origemDaConsulta, textoCnae } from '@/lib/config/ficha';
import { FichaReceita } from './ficha-receita';

const ID = '11111111-1111-4111-8111-111111111111';
const ficha = FichaReceitaPlanaMascarada.parse({
  razao_social: 'Comércio Fictício Ltda', nome_fantasia: 'Ficticia', ie: '123456789', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cep: '69000000', municipio_ibge: '1302603', uf: 'AM',
  email_mascarado: 'ma****@exemplo.com.br', telefone_mascarado: '(92) ****-1234', cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: 'Ativa', situacao_cadastral_data: '2020-01-31',
  data_abertura: '2020-01-31', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'Demais', cnae_secundarios: ['4712100', '4781400'], receita_fonte: 'fonte-ficticia', receita_consultada_em: '2026-11-24T16:00:00.000Z',
});
const toda = Object.fromEntries(Object.keys(ficha).map((k) => [k, null])) as unknown as typeof ficha;
const render = (f: typeof ficha | null = ficha, editavel = true, razao: string | null = 'Razão da Empresa Fictícia') =>
  renderToStaticMarkup(<FichaReceita empresaId={ID} ficha={f} razaoEmpresa={razao} fuso="America/Manaus" editavel={editavel} />);
const valorDe = (h: string, campo: string) => new RegExp(`name="${campo}"[^>]*value="([^"]*)"|value="([^"]*)"[^>]*name="${campo}"`).exec(h)?.slice(1).find((v) => v !== undefined);

describe('Ficha da Receita editável na aba Empresa (RN-CORE-16, v0.3.24)', () => {
  it('formulário em 5 cartões na grade de 12, com os valores salvos nos campos; "Salvar" começa desligado (nada mudou)', () => {
    const h = render();
    for (const t of ['Identificação', 'Endereço', 'Atividades (CNAE)', 'Contato', 'Na Receita']) expect(h).toContain(`>${t}</h3>`);
    expect(h.match(/<fieldset/g)).toHaveLength(5);
    expect(valorDe(h, 'razao_social')).toBe('Comércio Fictício Ltda');
    expect(valorDe(h, 'ie')).toBe('123456789');
    expect(valorDe(h, 'cep')).toBe('69000000');
    expect(valorDe(h, 'data_abertura')).toBe('31/01/2020'); // dd/mm/aaaa sem depender do idioma do navegador
    expect(h).not.toContain('type="date"');
    expect(h.indexOf('id="rotulo-cnpj"')).toBe(-1); // sem o nó do CNPJ (vem do painel)
    expect([...h.matchAll(/<h3 id="h-ficha-([a-z]+)"/g)].map((m) => m[1])).toEqual(['identificacao', 'endereco', 'atividades', 'contato', 'situacao']);
    expect(h).toContain('<div class="formulario">'); // a grade de 12 da regra 11
    expect(h.match(/class="formulario cartao-ficha cartao-12"/g)).toHaveLength(3);
    expect(h).toContain('class="formulario cartao-ficha cartao-5"');
    expect(h).toContain('class="formulario cartao-ficha cartao-4"');
    expect(h).not.toMatch(/grade-cartoes|cartao-campos|cartao-largo|campo-ficha/);
    expect(h).toContain('<div class="campo campo-curto"><label for="ficha-ie"'); // campo curto em 2 colunas
    expect(h).toMatch(/<option value="simples" selected="">Simples Nacional<\/option>/);
    expect(h).toContain('4712100\n4781400</textarea>');
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Salvar<\/button>/);
    expect(h).not.toContain('>Descartar<');
    expect(h).toContain('Consultada em 24/11/2026 12:00');
  });
  it('MC-2 e MC-7: Endereço fecha as 12 (CEP 2 + Logradouro 8 + Número 2; Complemento 6 + Bairro 2 + IBGE 2 + UF 2); Na Receita: Situação, Data, Abertura e Porte em 2 e a Natureza em 4, e o Regime em 2', () => {
    const h = render();
    const classe = (c: string) => new RegExp(`<div class="campo([^"]*)"><label for="ficha-${c}"`).exec(h)?.[1] ?? null;
    expect(classe('logradouro')).toBe(' campo-oito');
    expect(classe('complemento')).toBe('');
    for (const c of ['cep', 'numero', 'bairro', 'municipio_ibge', 'uf', 'situacao_cadastral', 'situacao_cadastral_data', 'data_abertura', 'porte', 'regime_receita']) expect(classe(c)).toBe(' campo-curto');
    expect(classe('natureza_juridica')).toBe(' campo-medio');
    expect(h.indexOf('ficha-porte')).toBeLessThan(h.indexOf('ficha-natureza_juridica'));
    expect(h.indexOf('ficha-natureza_juridica')).toBeLessThan(h.indexOf('ficha-regime_receita'));
  });
  it('RD-2373: sem o placeholder "Vazio mantém o salvo" e sem as dicas de quantidade; "Só números ou ISENTO." fica; a data mostra o formato no placeholder', () => {
    const h = render();
    expect(h).not.toContain('Vazio mantém o salvo');
    expect(h).not.toMatch(/[78] números\./);
    expect(h).not.toContain('<span class="dica-campo">dd/mm/aaaa</span>');
    expect(h).toContain('Só números ou ISENTO.');
    expect(h).toMatch(/name="data_abertura"[^>]*placeholder="dd\/mm\/aaaa"|placeholder="dd\/mm\/aaaa"[^>]*name="data_abertura"/);
    expect(h).toContain('>Na Receita</h3>');
    expect(h).not.toContain('Situação na Receita');
  });
  it('rótulo de campo com classe própria (destaque, R-20261127-110345) e ligado ao campo pelo id', () => {
    const h = render();
    expect(h).toContain('<label for="ficha-razao_social" class="rotulo-campo">Razão social</label>');
    expect(h).toContain('id="ficha-razao_social"');
  });
  it('36 A: um retorno por ação: o da prévia da Receita antes dos campos; o do "Salvar", depois da barra de botões (sem o rodapé da página, a barra fica no rodapé do cartão)', () => {
    const h = render();
    const retornos = [...h.matchAll(/data-resultado-acao/g)].map((m) => m.index);
    expect(retornos).toHaveLength(2);
    const atualizar = h.indexOf('>Atualizar</button>');
    const salvar = h.indexOf('>Salvar</button>');
    expect(atualizar).toBeGreaterThan(h.lastIndexOf('</fieldset>'));
    expect(retornos[0]).toBeLessThan(h.indexOf('<fieldset'));
    expect(salvar).toBeGreaterThan(h.lastIndexOf('</fieldset>'));
    expect(retornos[1]).toBeGreaterThan(salvar);
    expect(h).not.toMatch(/class="erro"/);
  });
  it('e-mail e telefone: o campo começa vazio (vazio mantém) e o salvo aparece mascarado, com um Mostrar por campo', () => {
    const h = render();
    expect(valorDe(h, 'email')).toBe('');
    expect(valorDe(h, 'telefone')).toBe('');
    expect(h).toContain('ma****@exemplo.com.br');
    expect(h).toContain('(92) ****-1234');
    expect(h.match(/>Mostrar</g)).toHaveLength(2);
    expect(h).not.toContain('Revelar');
    expect(render({ ...ficha, email_mascarado: null, telefone_mascarado: null })).not.toContain('Mostrar');
  });
  it('a razão social vem da ficha; sem ela, a da empresa', () => {
    expect(valorDe(render({ ...ficha, razao_social: undefined }), 'razao_social')).toBe('Razão da Empresa Fictícia');
  });
  it('sem consulta: o estado vazio no cabeçalho e o formulário vazio, para preencher; empresa encerrada desliga tudo', () => {
    const h = render(null);
    expect(h).toContain('Ainda não consultada.');
    expect(valorDe(h, 'logradouro')).toBe('');
    expect(h).not.toContain('—');
    const enc = render(ficha, false);
    expect(enc).toMatch(/<button[^>]*disabled=""[^>]*>Atualizar</);
    expect(enc).toMatch(/name="razao_social"[^>]*disabled=""|disabled=""[^>]*name="razao_social"/);
  });
  it('CNAE: a descrição oficial aparece sob o campo enquanto o código é o salvo; sem descrição, só a dica', () => {
    const h = render({ ...ficha, cnae_principal_descricao: 'COMÉRCIO VAREJISTA', cnae_secundarios_descritos: [{ codigo: '4712100', descricao: 'MINIMERCADOS' }, { codigo: '4781400', descricao: null }] });
    expect(h).toContain('4711-3/02 · COMÉRCIO VAREJISTA');
    expect(h).toContain('<li>4712-1/00 · MINIMERCADOS</li>');
    expect(h).toContain('<li>4781-4/00</li>');
    expect(textoCnae('123', 'X')).toBe('123 · X');
  });
  it('três estados da ficha e a consulta no fuso da empresa', () => {
    const consultada = { ...toda, receita_fonte: 'x', receita_consultada_em: '2026-11-24T16:00:00.000Z', cnae_secundarios: [], cnae_secundarios_descritos: [] };
    expect(estadoDaFicha(null)).toBe('nunca');
    expect(estadoDaFicha({ ...ficha, receita_consultada_em: null })).toBe('nunca');
    expect(estadoDaFicha(consultada)).toBe('sem_dados');
    expect(estadoDaFicha({ ...consultada, municipio_nome: 'Manaus' })).toBe('com_dados');
    expect(estadoDaFicha(ficha)).toBe('com_dados');
    expect(origemDaConsulta(ficha, 'America/Manaus')).toContain('12:00');
    expect(origemDaConsulta({ ...ficha, receita_consultada_em: null }, 'America/Manaus')).toBeNull();
  });
  it('o componente não grava valor em armazenamento nem em log', () => {
    for (const arq of [join(__dirname, 'ficha-receita.tsx'), join(__dirname, '../../../../../components/revelar-mascarado.tsx')]) {
      expect(readFileSync(arq, 'utf8')).not.toMatch(/localStorage|sessionStorage|console\.|document\.cookie/);
    }
  });
});
