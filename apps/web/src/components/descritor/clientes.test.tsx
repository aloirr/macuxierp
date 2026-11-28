import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { telaDaRota } from '@/lib/telas';
import { EDITAR_CLIENTE, NOVO_CLIENTE, ROTA_CLIENTE, ROTA_CLIENTE_NOVO, ROTA_CLIENTES } from '@/lib/telas/cadastros';
import type { TelaLista } from '@/lib/descritor/tipos';
import { FormularioGenerico, larguraDoCampo } from './formulario-generico';
import { ListaGenerica } from './lista-generica';

const F = '8a2b6c10-1d3e-4f5a-8b7c-9d0e1f2a3b4c';
const cliente = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `3f1d5a07-7b0e-4a52-9d3c-4a6b8e2f1c7${n}`, tipo_pessoa: 'PJ', documento: ['11222333000181', '45997418000153', '07526557000100'][n] ?? '11222333000181', ie: null, ind_ie_dest: '9',
  razao_social: ['Bar do Zé Ltda', 'Mercadinho Tarumã ME', 'Distribuidora Rio Negro SA'][n] ?? 'Cliente', nome_fantasia: null, email_nfe: null, limite_credito_centavos: 150000 * (n + 1),
  condicao_pagamento_id: null, tabela_preco_id: null, filial_id: F, vendedor_id: null, prazo_medio_dias: 30, external_id: null, inativo: false, ...extra,
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), redirect: () => { throw new Error('redirect'); }, notFound: () => { throw new Error('404'); } }));
vi.mock('@/app/(shell)/[modulo]/[...pagina]/acoes', () => ({ escrever: vi.fn(), ler: vi.fn() }));
vi.mock('@/lib/listas', () => ({ buscarPagina: async () => ({ itens: [cliente(0), cliente(1), cliente(2, { inativo: true })], proximo_cursor: null }) }));

describe('Clientes no renderizador genérico', () => {
  it('lista: colunas, três clientes, selo de situação, Novo cliente e CSV; o gerente vê o limite, o vendedor não', async () => {
    const tela = telaDaRota(ROTA_CLIENTES) as TelaLista;
    const render = async (perfil: 'gerente' | 'vendedor') => renderToStaticMarkup(await ListaGenerica({ tela, rotaDaPagina: ROTA_CLIENTES, rota: ROTA_CLIENTES, busca: new URLSearchParams(), perfil, acesso: 't', fuso: 'America/Manaus' }));
    const h = await render('gerente');
    for (const t of ['CNPJ/CPF', 'Razão social', 'Contribuinte ICMS', 'Limite', 'Situação', 'Bar do Zé Ltda', 'Mercadinho Tarumã ME', '11.222.333/0001-81', 'Novo cliente', 'Exportar CSV', 'Só ativos']) expect(h).toContain(t);
    expect(h).toContain('Inativo');
    expect(h).toContain('aria-label="Abrir cliente Bar do Zé Ltda"'); // a linha abre o registro (destino /cadastros/clientes/:id)
    expect(h).not.toMatch(/Disponível em breve|undefined|NaN/);
    expect(await render('vendedor')).not.toContain('>Limite<');
  });

  it('formulário novo: .formulario, campos do descritor, endereço, botões juntos embaixo e larguras curtas para UF, CEP e número', () => {
    const campos = NOVO_CLIENTE.camposDoPerfil!('gerente');
    const h = renderToStaticMarkup(<FormularioGenerico rota={ROTA_CLIENTE_NOVO} opcoes={{ filial_id: [{ valor: F, rotulo: 'Matriz' }] }} produtos={[]} perfil="gerente" campos={campos} />);
    expect(h).toContain('class="formulario"');
    for (const t of ['Tipo de pessoa', 'CNPJ/CPF', 'Razão social', 'Inscrição estadual', 'Limite de crédito (R$)', 'CEP', 'UF', 'Salvar cliente', 'Cancelar', 'Matriz']) expect(h).toContain(t);
    expect(h).toMatch(/class="campo campo-curto"[^>]*for="campo-end_cep"|for="campo-end_cep"/);
    expect(larguraDoCampo({ nome: 'end_uf', tipo: 'texto' })).toBe(' campo-curto');
    expect(larguraDoCampo({ nome: 'end_cep', tipo: 'texto' })).toBe(' campo-curto');
    expect(larguraDoCampo({ nome: 'end_logradouro', tipo: 'texto' })).toBe(' campo-8');
    expect(h.indexOf('barra-acoes')).toBeGreaterThan(h.indexOf('campo-end_cep')); // botões depois do último campo, na mesma barra
    expect((h.match(/class="barra-acoes"/g) ?? []).length).toBe(1);
  });

  it('formulário de edição: valores do cliente, sem os campos de endereço, e o botão "Salvar alterações"', () => {
    const { valores, original } = EDITAR_CLIENTE.edicao!.abrir(cliente(0));
    const h = renderToStaticMarkup(<FormularioGenerico rota={ROTA_CLIENTE} opcoes={{ filial_id: [{ valor: F, rotulo: 'Matriz' }] }} produtos={[]} perfil="gerente" campos={EDITAR_CLIENTE.camposDoPerfil!('gerente')} aberto={{ valores, original, id: 'x' }} />);
    expect(h).toContain('value="Bar do Zé Ltda"');
    expect(h).toContain('value="11.222.333/0001-81"');
    expect(h).toContain('Salvar alterações');
    expect(h).not.toContain('campo-end_cep');
  });
});
