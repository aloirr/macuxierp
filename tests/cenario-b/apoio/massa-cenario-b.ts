/**
 * T-0057 (cenário B, ADR 0014 §2 e §7): massa fictícia dos 10 cadastros da F2 no layout do kit, já no payload do Hub v1
 * (`PAYLOADS_HUB` do `hub-v1.ts`), como o Conector a leria das views `dbo.vw_macuxi_*` do `ERP_THATHYANY` fictício.
 *
 * - `external_id` no estilo do kit (código do ERP do cliente, `CB-<ENT>-0001`), nunca UUID: no cenário B o dono do
 *   código é o banco do cliente. Os campos seguem os modelos CSV da carga (`modules/cadastros/domain/carga/__fixtures__`)
 *   e o formato da `tests/ponta-a-ponta-fdv/apoio/massa.ts`, com as regras do hub-v1: dinheiro em `_cents` inteiros,
 *   `alterado_em` UTC com `Z`, quantidade (`fator`, `saldo`) numérica, sigla de medida em maiúsculas, CEP e CNPJ sem máscara.
 * - Determinística (mesma base = mesmos bytes): o reenvio e a idempotência se conferem por igualdade.
 * - Nada de dado real: nomes "Ficticio", CNPJ e CPF com DV válido gerados de bases fixas pela validação do SDK.
 * - `sensiveis` lista os valores que nunca podem aparecer em log ou resposta (E3, regra 8 do CLAUDE.md).
 */
import { cnpjValido, cpfValido } from '../../../packages/platform-sdk/src/documentos';
import { comDv } from '../../ponta-a-ponta-fdv/apoio/massa';
import { ENTIDADES_F2, type EntidadeF2, type RegistroLocal } from './conector-simulado';

export type RegistrosCenarioB = Record<EntidadeF2, RegistroLocal[]>;

export interface MassaCenarioB {
  registros: RegistrosCenarioB;
  /** Valores que nunca podem sair em log, resposta ou recado (documentos, nomes e endereço de cliente). */
  sensiveis: string[];
  /** Quantos registros de cada entidade a massa tem (para conferir contagem no ERP e no dublê do Hub). */
  contagem: Record<EntidadeF2, number>;
}

export const BASE_PADRAO = new Date('2026-11-23T14:00:00.000Z');
const id = (ent: string, n: number) => `CB-${ent}-${String(n).padStart(4, '0')}`;

export interface OpcoesMassa {
  /** Início do `alterado_em` (UTC); cada registro soma 1 s, em ordem de carga. */
  base?: Date;
  /** Produtos (e, com eles, unidades, preços e estoques). Padrão 3; a trava de 30% pede 10. */
  produtos?: number;
  /** Clientes (e endereços de entrega). Padrão 3. */
  clientes?: number;
}

export function montarMassaCenarioB(o: OpcoesMassa = {}): MassaCenarioB {
  const base = o.base ?? BASE_PADRAO;
  const nProd = o.produtos ?? 3;
  const nCli = o.clientes ?? 3;
  let seq = 0;
  const em = () => new Date(base.getTime() + 1000 * seq++).toISOString();
  const sensiveis: string[] = [];

  const filiais = [1, 2].map((n) => ({
    external_id: id('FIL', n),
    alterado_em: em(),
    ativo: true,
    codigo: String(n).padStart(2, '0'),
    nome: `Filial Ficticia ${n}`,
    cnpj: comDv(`9900000${n}000${n}`.slice(0, 12), cnpjValido),
    logradouro: 'Rua Ficticia do Cenario B',
    numero: String(100 * n),
    bairro: 'Centro',
    cep: '69000000',
    cidade: 'Manaus',
    uf: 'AM',
  }));
  const vendedores = [1, 2].map((n) => ({
    external_id: id('VEN', n),
    alterado_em: em(),
    ativo: true,
    nome: `Vendedora Ficticia ${n}`,
    filial_external_id: filiais[n - 1]!.external_id,
  }));
  const formas = [
    { external_id: id('FP', 1), alterado_em: em(), ativo: true, codigo: 'BOLETO', nome: 'Boleto' },
    { external_id: id('FP', 2), alterado_em: em(), ativo: true, codigo: 'PIX', nome: 'Pix' },
  ];
  const prazos = [
    { n: 1, forma: 0, codigo: '28-56', parcelas_dias: '28/56', descricao: 'Boleto 28/56' },
    { n: 2, forma: 0, codigo: '28', parcelas_dias: '28', descricao: 'Boleto 28' },
    { n: 3, forma: 1, codigo: 'AV', parcelas_dias: '0', descricao: 'Pix a vista' },
  ].map((p) => ({
    external_id: id('PZ', p.n),
    alterado_em: em(),
    ativo: true,
    forma_external_id: formas[p.forma]!.external_id,
    codigo: p.codigo,
    parcelas_dias: p.parcelas_dias,
    descricao: p.descricao,
  }));
  const numeros = Array.from({ length: nProd }, (_, i) => i + 1);
  const produtos = numeros.map((n) => ({
    external_id: id('PRD', n),
    alterado_em: em(),
    ativo: true,
    sku: `SKU-CB-${String(n).padStart(4, '0')}`,
    nome: `Produto Ficticio ${n}`,
    unidade: 'UN',
    marca: 'Marca Ficticia',
  }));
  const unidades = numeros.flatMap((n) => [
    {
      external_id: id('PU', 2 * n - 1),
      alterado_em: em(),
      ativo: true,
      produto_external_id: id('PRD', n),
      unidade: 'UN',
      fator: 1,
      padrao: true,
    },
    {
      external_id: id('PU', 2 * n),
      alterado_em: em(),
      ativo: true,
      produto_external_id: id('PRD', n),
      unidade: 'CX',
      fator: 12,
      padrao: false,
    },
  ]);
  const precos = numeros.map((n) => ({
    external_id: id('PR', n),
    alterado_em: em(),
    ativo: true,
    tabela_external_id: id('TAB', 1),
    tabela_nome: 'Tabela Ficticia',
    vigencia_inicio: '2026-01-01',
    produto_external_id: id('PRD', n),
    preco_cents: 1000 * n + 99,
    filial_external_id: filiais[0]!.external_id,
  }));
  const estoques = numeros.map((n) => ({
    external_id: id('EST', n),
    alterado_em: em(),
    ativo: true,
    deposito_external_id: id('DEP', 1),
    deposito_nome: 'Deposito Ficticio',
    produto_external_id: id('PRD', n),
    saldo: n * 10 + 0.5,
    filial_external_id: filiais[0]!.external_id,
  }));
  const nCliNums = Array.from({ length: nCli }, (_, i) => i + 1);
  const clientes = nCliNums.map((n) => {
    // o primeiro cliente é pessoa física (CPF), os outros jurídica (CNPJ)
    const documento =
      n === 1
        ? comDv(`98765432${n}`.slice(0, 9), cpfValido)
        : comDv(`9911111${n}0001`.slice(0, 12), cnpjValido);
    const razao = `Cliente Ficticio ${n} ${n === 1 ? '' : 'Ltda'}`.trim();
    const logradouro = `Rua Ficticia do Cliente ${n}`;
    sensiveis.push(documento, razao, logradouro);
    return {
      external_id: id('CLI', n),
      alterado_em: em(),
      ativo: true,
      razao_social: razao,
      nome_fantasia: `Fantasia Ficticia ${n}`,
      documento,
      vendedor_external_id: vendedores[(n - 1) % 2]!.external_id,
      filial_external_id: filiais[0]!.external_id,
      endereco: {
        logradouro,
        numero: String(n),
        bairro: 'Bairro Ficticio',
        cidade: 'Manaus',
        uf: 'AM',
        cep: '69000001',
      },
      limite_credito_cents: 100_000 * n,
      formas_pagamento: ['BOLETO', 'PIX'],
      prazo_medio_max_dias: 42,
    };
  });
  const enderecos = nCliNums.map((n) => ({
    external_id: id('END', n),
    alterado_em: em(),
    ativo: true,
    cliente_external_id: id('CLI', n),
    logradouro: `Rua Ficticia de Entrega ${n}`,
    numero: String(10 + n),
    bairro: 'Bairro Ficticio',
    cidade: 'Manaus',
    uf: 'AM',
    cep: '69000002',
    tipo: 'entrega' as const,
    principal: false,
  }));
  sensiveis.push(...enderecos.map((e) => e.logradouro));

  const registros: RegistrosCenarioB = {
    filial: filiais,
    vendedor: vendedores,
    forma_pagamento: formas,
    prazo_pagamento: prazos,
    produto: produtos,
    produto_unidade: unidades,
    preco: precos,
    estoque: estoques,
    cliente: clientes,
    cliente_endereco: enderecos,
  };
  const contagem = Object.fromEntries(ENTIDADES_F2.map((e) => [e, registros[e].length])) as Record<
    EntidadeF2,
    number
  >;
  return { registros, sensiveis, contagem };
}

/**
 * Trava de 30% (ADR 0014 §3, RN-INT-06 copiada): a carga completa seguinte sem `faltando` dos registros ativos.
 * Devolve a lista que o Conector mandaria e quantos ficariam para inativar. O percentual é sobre os ativos da entidade.
 */
export function cargaSemParte(
  registros: readonly RegistroLocal[],
  faltando: number,
): { registros: RegistroLocal[]; candidatos: number; percentual: number } {
  if (!Number.isInteger(faltando) || faltando < 0 || faltando > registros.length)
    throw new Error('cargaSemParte: faltando fora da faixa.');
  const ativos = registros.filter((r) => r.ativo).length;
  return {
    registros: registros.slice(faltando).map((r) => ({ ...r })),
    candidatos: faltando,
    percentual: ativos === 0 ? 0 : (100 * faltando) / ativos,
  };
}
