import { FichaReceitaPlanaMascarada } from '@macuxierp/core/contracts';
import { describe, expect, it } from 'vitest';
import { CAMPOS_FICHA, GRUPOS_FICHA, ROTULO_CAMPO, camposMudados, dataDoForm, dataNaTela, entradaDoForm, formComPrevia, formDaFicha, nomesDosCampos, textoPrevia, textoSalvo, validarFicha } from './ficha-edicao';

/** RN-CORE-16 (v0.3.24): formulário da Ficha da Receita editável. Dados fictícios. */
const ficha = FichaReceitaPlanaMascarada.parse({
  razao_social: 'Comércio Fictício Ltda', nome_fantasia: 'Ficticia', ie: '123456789', logradouro: 'Rua A', numero: '10', complemento: null, bairro: 'Centro', cep: '69000000', municipio_ibge: '1302603', uf: 'AM',
  email_mascarado: 'ma****@exemplo.com.br', telefone_mascarado: '(92) ****-1234', cnae_principal: '4711302', regime_receita: 'simples', situacao_cadastral: 'Ativa', situacao_cadastral_data: '2020-01-31',
  data_abertura: '2020-01-31', natureza_juridica: 'Sociedade Empresária Limitada', porte: 'Demais', cnae_secundarios: ['4712100'], receita_fonte: 'brasilapi', receita_consultada_em: '2026-11-24T16:00:00.000Z',
});

describe('formulário da ficha (RN-CORE-16)', () => {
  it('todo campo editável está em um cartão, uma vez só, com rótulo', () => {
    const nos = GRUPOS_FICHA.flatMap((g) => g.campos.map((c) => c.campo));
    expect([...nos].sort()).toEqual([...CAMPOS_FICHA].sort());
    expect(new Set(nos).size).toBe(nos.length);
    for (const c of CAMPOS_FICHA) expect(ROTULO_CAMPO[c]).toBeTruthy();
  });
  it('da ficha salva: valores nos campos, contatos vazios (o salvo só existe mascarado)', () => {
    const f = formDaFicha(ficha, 'Outra');
    expect(f).toMatchObject({ razao_social: 'Comércio Fictício Ltda', cep: '69000000', cnae_secundarios: '4712-1/00', email: '', telefone: '' });
    expect(formDaFicha(null, 'Razão da Empresa').razao_social).toBe('Razão da Empresa');
  });
  it('"Atualizar pela Receita" só preenche: a prévia troca os dados da Receita e mantém a IE e o contato digitados', () => {
    const atual = { ...formDaFicha(ficha, null), ie: 'ISENTO', email: 'novo@exemplo.invalid' };
    const novo = formComPrevia(atual, { ...ficha, ie: null, logradouro: 'Rua B', razao_social: null });
    expect(novo).toMatchObject({ logradouro: 'Rua B', ie: 'ISENTO', email: 'novo@exemplo.invalid', razao_social: 'Comércio Fictício Ltda' });
    expect(camposMudados(atual, novo)).toEqual(['logradouro']);
  });
  it('entrada do Salvar: sem máscara, vazio vira nulo, UF e IE em maiúsculas, CNAE sem repetição, contato vazio fica de fora', () => {
    const f = { ...formDaFicha(ficha, null), cep: '69000-001', uf: 'am', ie: 'isento', complemento: '  ', cnae_principal: '4711-3/02', cnae_secundarios: '4712-1/00\n4712100, 4781400', telefone: '' };
    const e = entradaDoForm(f, 'manual');
    expect(e).toMatchObject({ cep: '69000001', uf: 'AM', ie: 'ISENTO', complemento: null, cnae_principal: '4711302', cnae_secundarios: ['4712100', '4781400'], origem: 'manual' });
    expect(e).not.toHaveProperty('email');
    expect(e).not.toHaveProperty('telefone');
    expect(e).not.toHaveProperty('consultado_em');
    expect(entradaDoForm({ ...f, email: ' Novo@Exemplo.Invalid ', telefone: '(92) 99999-0000' }, 'receita', '2026-11-27T16:00:00.000Z')).toMatchObject({ email: 'novo@exemplo.invalid', telefone: '92999990000', origem: 'receita', consultado_em: '2026-11-27T16:00:00.000Z' });
  });
  it('validação pelo contrato do core (EdicaoFicha): erro por campo, com o formato e sem o valor digitado', () => {
    expect(validarFicha(formDaFicha(ficha, null), 'manual').ok).toBe(true);
    const r = validarFicha({ ...formDaFicha(ficha, null), razao_social: 'X', cep: '690', municipio_ibge: '13', uf: 'AMA', ie: '12A', cnae_principal: '47', email: 'nao-e-email', telefone: '123' }, 'manual');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.campos).sort()).toEqual(['cep', 'cnae_principal', 'email', 'ie', 'municipio_ibge', 'razao_social', 'telefone', 'uf']);
    expect(JSON.stringify(r.campos)).not.toContain('nao-e-email');
  });
  it('textos do retorno: só os rótulos dos campos, nunca valores', () => {
    expect(nomesDosCampos(['razao_social', 'cep', 'desconhecido'])).toBe('Razão social, CEP, desconhecido');
    expect(textoSalvo([])).toBe('Nada mudou: a ficha já estava assim.');
    expect(textoSalvo(['uf'])).toBe('Ficha salva. Mudou: UF.');
    expect(textoPrevia([])).toBe('A Receita trouxe os mesmos dados da ficha salva.');
    expect(textoPrevia(['logradouro'])).toBe('A Receita trouxe dados diferentes. Confira e clique em Salvar.');
  });
});

describe('datas da ficha em dd/mm/aaaa (PO, #853)', () => {
  it('na tela sempre dd/mm/aaaa; no Salvar volta a AAAA-MM-DD; data que não existe segue como veio e o contrato recusa', () => {
    expect(dataNaTela('2014-07-21')).toBe('21/07/2014');
    expect(dataNaTela(null)).toBe('');
    expect(dataDoForm('21/07/2014')).toBe('2014-07-21');
    expect(dataDoForm('1/7/2014')).toBe('2014-07-01');
    expect(dataDoForm('  ')).toBeNull();
    expect(dataDoForm('31/02/2014')).toBe('31/02/2014');
    expect(dataDoForm('45/13/2014')).toBe('45/13/2014');
    expect(formDaFicha(ficha, null)).toMatchObject({ data_abertura: '31/01/2020', situacao_cadastral_data: '31/01/2020' });
    expect(entradaDoForm(formDaFicha(ficha, null), 'manual')).toMatchObject({ data_abertura: '2020-01-31' });
    const r = validarFicha({ ...formDaFicha(ficha, null), data_abertura: '31/02/2020' }, 'manual');
    expect(r.ok ? {} : r.campos).toEqual({ data_abertura: 'Data inválida. Use dd/mm/aaaa.' });
  });
});
