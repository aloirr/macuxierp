/**
 * T-0012: massa de uma execução da ida ERP → FDV, já no formato do Hub (payloads do desenho T-0009 seção 2, com o CNPJ
 * e o endereço da filial que o Hub exige — achado A-01 de docs/testes/T-0012.md, corrigido pelo #123).
 *
 * Cada execução tem identificadores próprios (UUID, como o `id` do ERP, M2) e códigos com o sufixo da execução: no
 * tenant de teste real, uma rodada não esbarra na anterior. Nomes e documentos são fictícios (CNPJ e CPF com dígito
 * verificador válido, gerados aqui); nada de dado de cliente real.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { cnpjValido, cpfValido } from '../../../packages/platform-sdk/src/documentos';
import type { EntidadeHub, RegistroHub } from './contrato-hub';

/** Completa os dois dígitos verificadores pela validação do SDK (sem repetir a conta do DV aqui). */
function comDv(base: string, valido: (d: string) => boolean): string {
  for (let dv = 0; dv < 100; dv++) {
    const doc = base + String(dv).padStart(2, '0');
    if (valido(doc)) return doc;
  }
  throw new Error('sem DV válido para a base gerada');
}

const digitos = (n: number) => Array.from({ length: n }, () => String(randomInt(10))).join('');

export const cnpjFicticio = (ordem: string) => comDv(`${digitos(8)}${ordem}`, cnpjValido);
export const cpfFicticio = () => comDv(digitos(9), cpfValido);

export type Registros = Partial<Record<EntidadeHub, RegistroHub[]>>;

/**
 * Rodada de testes: id = carimbo UTC do início (minuto) e um contador. O código da filial segue a regra do ERP (ordem do
 * CNPJ, 4 dígitos, RN-INF-02) e sai daqui, sempre do mesmo contador: dentro da rodada nenhum código se repete e não há
 * faixas sorteadas que se sobreponham. Cada rodada tem um bloco próprio de `CODIGOS_POR_RODADA` códigos, escolhido pelo
 * minuto UTC do início; dois blocos só se repetem depois de `BLOCOS_DE_CODIGO` minutos (premissa: rodadas no tenant de
 * teste real começam em minutos diferentes).
 */
export const CODIGOS_POR_RODADA = 16;
export const PRIMEIRO_CODIGO_FILIAL = 1000;
export const BLOCOS_DE_CODIGO = Math.floor((10_000 - PRIMEIRO_CODIGO_FILIAL) / CODIGOS_POR_RODADA);

export interface Rodada {
  /** `AAAAMMDDTHHMMZ` do início, em UTC. */
  readonly id: string;
  /** Próximo código de filial da rodada (4 dígitos); recusa passar do bloco. */
  proximoCodigoFilial(): string;
}

// hora-fixa-ok: o id da rodada vem do relógio real de propósito (bloco de códigos diferente entre rodadas no tenant real)
export function criarRodada(inicio: Date = new Date()): Rodada {
  const minuto = Math.floor(inicio.getTime() / 60_000);
  const id = `${inicio.toISOString().slice(0, 16).replace(/[-:]/g, '')}Z`;
  const primeiro = PRIMEIRO_CODIGO_FILIAL + (minuto % BLOCOS_DE_CODIGO) * CODIGOS_POR_RODADA;
  let contador = 0;
  return {
    id,
    proximoCodigoFilial() {
      if (contador >= CODIGOS_POR_RODADA)
        throw new Error(`rodada ${id}: mais de ${CODIGOS_POR_RODADA} filiais na mesma rodada.`);
      return String(primeiro + contador++);
    },
  };
}

export interface Massa {
  /** Sufixo curto da execução (aparece em códigos e nomes). */
  execucao: string;
  registros: Registros;
  /** Valores que nunca podem aparecer em log (LGPD, regra 8). */
  sensiveis: string[];
  ids: {
    filiais: [string, string];
    vendedores: [string, string];
    clientes: [string, string, string];
    produtos: [string, string, string];
  };
}

export function montarMassa(base: Date, rodada: Rodada): Massa {
  const execucao = randomUUID().slice(0, 6).toUpperCase();
  let seq = 0;
  /** `alterado_em` crescente a partir da base (UTC, ms). */
  const em = () => new Date(base.getTime() + 1000 * seq++).toISOString();
  const id = () => randomUUID();

  const filiais: [string, string] = [id(), id()];
  const vendedores: [string, string] = [id(), id()];
  const formas = [id(), id()] as const;
  const produtos: [string, string, string] = [id(), id(), id()];
  const clientes: [string, string, string] = [id(), id(), id()];
  const tabela = id();
  const ordens = [rodada.proximoCodigoFilial(), rodada.proximoCodigoFilial()];
  const cnpjs = ordens.map(cnpjFicticio);
  const cnpjCliente = cnpjFicticio('0001');
  const cpfCliente = cpfFicticio();
  const codForma = [`BOLETO-${execucao}`, `PIX-${execucao}`];

  const r: Registros = {
    filial: filiais.map((f, i) => ({
      external_id: f,
      alterado_em: em(),
      ativo: true,
      codigo: ordens[i]!,
      nome: `Filial Teste ${execucao} ${i + 1}`,
      cnpj: cnpjs[i]!,
      logradouro: 'Avenida Ficticia de Teste',
      numero: String(100 + i),
      bairro: 'Centro',
      cep: '69301000',
      cidade: 'Boa Vista',
      uf: 'RR',
    })),
    vendedor: vendedores.map((v, i) => ({
      external_id: v,
      alterado_em: em(),
      ativo: true,
      nome: `Vendedora Ficticia ${execucao} ${i + 1}`,
      filial_external_id: filiais[i]!,
    })),
    forma_pagamento: formas.map((f, i) => ({
      external_id: f,
      alterado_em: em(),
      ativo: true,
      codigo: codForma[i]!,
      nome: i === 0 ? 'Boleto' : 'Pix',
    })),
    prazo_pagamento: [
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        forma_external_id: formas[0],
        codigo: `28-56-${execucao}`,
        parcelas_dias: [28, 56],
        descricao: 'Boleto 28/56',
      },
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        forma_external_id: formas[0],
        codigo: `28-${execucao}`,
        parcelas_dias: [28],
        descricao: 'Boleto 28',
      },
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        forma_external_id: formas[1],
        codigo: `AV-${execucao}`,
        parcelas_dias: [0],
        descricao: 'Pix a vista',
      },
    ],
    produto: produtos.map((p, i) => ({
      external_id: p,
      alterado_em: em(),
      ativo: true,
      sku: `T${execucao}-${i + 1}`,
      nome: `Produto de Teste ${i + 1}`,
      unidade: 'UN',
      marca: 'Marca Teste',
    })),
    produto_unidade: [
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        produto_external_id: produtos[0],
        unidade: 'UN',
        fator: '1',
        padrao: true,
      },
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        produto_external_id: produtos[0],
        unidade: 'CX',
        fator: '12',
        padrao: false,
      },
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        produto_external_id: produtos[1],
        unidade: 'UN',
        fator: '1',
        padrao: true,
      },
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        produto_external_id: produtos[2],
        unidade: 'UN',
        fator: '1',
        padrao: true,
      },
    ],
    preco: [
      ...produtos.map((p, i) => ({
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        tabela_external_id: tabela,
        tabela_nome: `Tabela Teste ${execucao}`,
        vigencia_inicio: '2026-11-01',
        produto_external_id: p,
        preco_cents: 1990 + 1000 * i,
      })),
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        tabela_external_id: tabela,
        tabela_nome: `Tabela Teste ${execucao}`,
        vigencia_inicio: '2026-11-01',
        produto_external_id: produtos[0],
        preco_cents: 2090,
        filial_external_id: filiais[1],
      },
    ],
    estoque: [
      ...produtos.map((p) => ({
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        deposito_external_id: filiais[0],
        deposito_nome: `Filial Teste ${execucao} 1`,
        produto_external_id: p,
        saldo: '10.5',
        filial_external_id: filiais[0],
      })),
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        deposito_external_id: filiais[1],
        deposito_nome: `Filial Teste ${execucao} 2`,
        produto_external_id: produtos[0],
        saldo: '0',
        filial_external_id: filiais[1],
      },
    ],
    cliente: [
      {
        external_id: clientes[0],
        alterado_em: em(),
        ativo: true,
        razao_social: `Mercearia Ficticia ${execucao} Ltda`,
        nome_fantasia: `Mercadinho ${execucao}`,
        documento: cnpjCliente,
        inscricao_estadual: `24${digitos(7)}`,
        vendedor_external_id: vendedores[0],
        filial_external_id: filiais[0],
        endereco: {
          logradouro: `Rua Ficticia ${execucao}`,
          numero: '45',
          bairro: 'Centro',
          cidade: 'Boa Vista',
          uf: 'RR',
          cep: '69301110',
        },
        limite_credito_cents: 500000,
        formas_pagamento: [codForma[0]!],
        prazo_medio_max_dias: 42,
      },
      {
        external_id: clientes[1],
        alterado_em: em(),
        ativo: true,
        razao_social: `Pessoa Ficticia ${execucao}`,
        documento: cpfCliente,
        vendedor_external_id: vendedores[1],
        filial_external_id: filiais[1],
        limite_credito_cents: 0,
      },
      {
        external_id: clientes[2],
        alterado_em: em(),
        ativo: true,
        razao_social: `Cliente Sem Carteira ${execucao}`,
        filial_external_id: filiais[0],
        limite_credito_cents: 100000,
      },
    ],
    cliente_endereco: [
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        cliente_external_id: clientes[0],
        logradouro: `Rua Ficticia ${execucao}`,
        numero: '45',
        bairro: 'Centro',
        cidade: 'Boa Vista',
        uf: 'RR',
        cep: '69301110',
        tipo: 'principal',
        principal: true,
      },
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        cliente_external_id: clientes[0],
        logradouro: `Travessa de Entrega ${execucao}`,
        numero: '7',
        cidade: 'Boa Vista',
        uf: 'RR',
        tipo: 'entrega',
        principal: false,
      },
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        cliente_external_id: clientes[1],
        logradouro: `Rua da Pessoa ${execucao}`,
        cidade: 'Manaus',
        uf: 'AM',
        tipo: 'principal',
        principal: true,
      },
    ],
    titulo: [
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        cliente_external_id: clientes[0],
        numero: `T${execucao}1`,
        parcela: '1',
        emissao: '2026-11-01',
        vencimento: '2026-11-29',
        valor_cents: 15990,
        saldo_cents: 15990,
        situacao: 'aberto',
      },
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        cliente_external_id: clientes[0],
        numero: `T${execucao}1`,
        parcela: '2',
        emissao: '2026-11-01',
        vencimento: '2026-12-27',
        valor_cents: 15990,
        saldo_cents: 0,
        situacao: 'baixado',
        baixado_em: '2026-11-20T14:00:00.000Z',
      },
      {
        external_id: id(),
        alterado_em: em(),
        ativo: true,
        cliente_external_id: clientes[1],
        numero: `T${execucao}2`,
        parcela: '1',
        emissao: '2026-11-05',
        vencimento: '2026-12-05',
        valor_cents: 4500,
        saldo_cents: 4500,
        situacao: 'aberto',
      },
    ],
  };

  const cli = r.cliente!;
  const sensiveis = [
    ...cli.flatMap((c) => [c.razao_social, c.nome_fantasia, c.documento, c.inscricao_estadual]),
    ...(r.cliente_endereco ?? []).map((e) => e.logradouro),
    ...(r.vendedor ?? []).map((v) => v.nome),
  ].filter((v): v is string => typeof v === 'string');

  return { execucao, registros: r, sensiveis, ids: { filiais, vendedores, clientes, produtos } };
}

/** `n` títulos abertos dos clientes da massa (lote acima do limite de 5.000). */
export function titulosEmMassa(massa: Massa, n: number, base: Date): RegistroHub[] {
  return Array.from({ length: n }, (_, i) => ({
    external_id: randomUUID(),
    alterado_em: new Date(base.getTime() + i).toISOString(),
    ativo: true,
    cliente_external_id: massa.ids.clientes[i % 3]!,
    numero: `V${massa.execucao}${i}`,
    parcela: '1',
    emissao: '2026-11-01',
    vencimento: '2026-12-01',
    valor_cents: 1000 + (i % 97),
    saldo_cents: 1000 + (i % 97),
    situacao: 'aberto',
  }));
}

/**
 * Arquivo de massa "do kit" FICTÍCIO, só para o dublê provar o perfil thathyany-seguro (no real, o arquivo vem da
 * carga da T-0026 com os dados do kit). `formas` formas de pagamento e 2 prazos de cada uma das 2 primeiras, no formato
 * de `MACUXI_HUB_MASSA_KIT`.
 */
export function massaKitFicticia(base: Date, formas: number): { fonte: 'kit'; registros: Registros } {
  const execucao = randomUUID().slice(0, 6).toUpperCase();
  let seq = 0;
  const em = () => new Date(base.getTime() + 1000 * seq++).toISOString();
  const forma = Array.from({ length: formas }, (_, i) => ({
    external_id: `KIT-FP-${execucao}-${String(i + 1).padStart(4, '0')}`,
    alterado_em: em(),
    ativo: true,
    codigo: `FP${i + 1}-${execucao}`,
    nome: `Forma Ficticia ${i + 1}`,
  }));
  const prazo = forma.slice(0, 2).flatMap((f, i) => [
    {
      external_id: `KIT-PZ-${execucao}-${i}-28`,
      alterado_em: em(),
      ativo: true,
      forma_external_id: f.external_id,
      codigo: `28-${i}-${execucao}`,
      parcelas_dias: [28],
      descricao: 'Prazo Ficticio 28',
    },
    {
      external_id: `KIT-PZ-${execucao}-${i}-2856`,
      alterado_em: em(),
      ativo: true,
      forma_external_id: f.external_id,
      codigo: `28-56-${i}-${execucao}`,
      parcelas_dias: [28, 56],
      descricao: 'Prazo Ficticio 28/56',
    },
  ]);
  return { fonte: 'kit', registros: { forma_pagamento: forma, prazo_pagamento: prazo } };
}
