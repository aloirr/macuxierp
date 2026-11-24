/**
 * Mapeamento ERP → Hub entidade a entidade (T-0009 seção 2). Funções puras sobre os payloads tipados dos eventos
 * `cadastros.*.alterado@1`; só tipos de `@macuxierp/cadastros/contracts`. O registro sai pronto para o espelho
 * (`registro_publicado`): payload canônico do Hub, hash (RN-INF-03), `alterado_em` = `ocorrido_em` do evento (M3) e as
 * referências do ERP de que depende (M10).
 *
 * Premissas do P-1 (a conferir contra o contrato do FDV): quantidades como número (P-1 conferido); preço da filial padrão sai sem
 * `filial_external_id` (= todas as filiais); o cliente leva `prazo_medio_max_dias` (RN-CAD-16) e não leva mais `formas_pagamento`.
 */
import type { z } from 'zod';
import { prazoCompleto, type EVENTOS } from '@macuxierp/cadastros/contracts';
import { PAYLOADS_HUB, PrazoPagamentoHubV2, type EntidadeHub, type LinhaInvalida } from '../contracts';
import { externalIdForma, hashRegistro } from './canonico';
import { chaveHub } from './chave';
import { parcelasDiasParaHub } from './parcelas';
import { cnpjValido } from '@macuxierp/platform-sdk';

type Evento<N extends keyof typeof EVENTOS> = z.infer<(typeof EVENTOS)[N]>;
export type EventoFilial = Evento<'cadastros.filial.alterada@1'>;
export type EventoVendedor = Evento<'cadastros.vendedor.alterado@1'>;
export type EventoCondicao = Evento<'cadastros.condicao_pagamento.alterada@1'>;
export type EventoProduto = Evento<'cadastros.produto.alterado@1'>;
export type EventoPreco = Evento<'cadastros.preco.alterado@1'>;
export type EventoEstoque = Evento<'cadastros.estoque.alterado@1'>;
export type EventoCliente = Evento<'cadastros.cliente.alterado@1'>;
export type EventoTabelaPreco = Evento<'cadastros.tabela_preco.alterada@1'>;

/** Registro do espelho, pronto para entrar em `registros` do lote (com `alterado_em`) ou ser gravado. */
export interface RegistroEspelho {
  entidade: EntidadeHub;
  external_id: string;
  /** `ocorrido_em` do evento, UTC, ms (M3). */
  alterado_em: string;
  ativo: boolean;
  /** Payload canônico do Hub, sem `alterado_em`. Nunca tem custo (M8). */
  payload: Record<string, unknown>;
  hash: string;
  /** UUID do ERP do registro (coluna `erp_id`, RD-0318); `null` na `forma_pagamento`, que não tem registro próprio. */
  erp_id: string | null;
  /** UUIDs do ERP de que o registro depende (M10). */
  fonte_refs: Record<string, string>;
}

/** Referência de uso interno (M1): não vira entidade do Hub. */
export interface ReferenciaEspelho {
  tipo: 'tabela_preco' | 'filial_padrao';
  erp_id: string;
  dados: Record<string, unknown>;
  fonte_ocorrido_em: string;
}

/** Remove `undefined` e `null` de campos opcionais do Hub (campo ausente, nunca nulo). */
function limpar<T extends Record<string, unknown>>(o: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
}

export function instanteUtc(ocorridoEm: string): string {
  const t = Date.parse(ocorridoEm);
  if (Number.isNaN(t)) throw new Error('ocorrido_em inválido');
  return new Date(t).toISOString();
}

function registro(entidade: EntidadeHub, ocorridoEm: string, payload: Record<string, unknown>, erpId: string | null, refs: Record<string, string | null | undefined> = {}): RegistroEspelho {
  const limpo = limpar(payload);
  const fonte_refs = Object.fromEntries(Object.entries(refs).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return {
    entidade,
    external_id: String(limpo.external_id),
    alterado_em: instanteUtc(ocorridoEm),
    ativo: limpo.ativo === true,
    payload: limpo,
    hash: hashRegistro(limpo),
    erp_id: erpId,
    fonte_refs,
  };
}

/** Escala 4 (D11) → número do Hub (`Quantidade` é `number`, P-1): `15000` → `1.5`, `-5000` → `-0.5`. */
export function quantidade4(valor: number): number {
  if (!Number.isInteger(valor)) throw new Error('quantidade deve ser inteira na escala 4');
  return valor / 10_000;
}

/** A-04: o Hub compara a sigla da medida em maiúsculas (RN-CORE-19 do FDV); o ERP envia assim. */
export function siglaMedida(sigla: string): string {
  return sigla.trim().toUpperCase();
}

/** tPag do MOC → código e nome da forma no Hub (códigos a conferir, P-1). Os demais pelo nome do MOC. */
export const TPAG_PARA_FORMA: Readonly<Record<string, { codigo: string; nome: string }>> = {
  '01': { codigo: 'DINHEIRO', nome: 'Dinheiro' },
  '02': { codigo: 'CHEQUE', nome: 'Cheque' },
  '03': { codigo: 'CARTAO_CREDITO', nome: 'Cartão de crédito' },
  '04': { codigo: 'CARTAO_DEBITO', nome: 'Cartão de débito' },
  '05': { codigo: 'CREDITO_LOJA', nome: 'Crédito loja' },
  '10': { codigo: 'VALE_ALIMENTACAO', nome: 'Vale alimentação' },
  '11': { codigo: 'VALE_REFEICAO', nome: 'Vale refeição' },
  '12': { codigo: 'VALE_PRESENTE', nome: 'Vale presente' },
  '13': { codigo: 'VALE_COMBUSTIVEL', nome: 'Vale combustível' },
  '14': { codigo: 'DUPLICATA_MERCANTIL', nome: 'Duplicata mercantil' },
  '15': { codigo: 'BOLETO', nome: 'Boleto bancário' },
  '16': { codigo: 'DEPOSITO_BANCARIO', nome: 'Depósito bancário' },
  '17': { codigo: 'PIX', nome: 'PIX' },
  '18': { codigo: 'TRANSFERENCIA_BANCARIA', nome: 'Transferência bancária' },
  '19': { codigo: 'PROGRAMA_FIDELIDADE', nome: 'Programa de fidelidade' },
  '20': { codigo: 'PIX_ESTATICO', nome: 'PIX estático' },
  '90': { codigo: 'SEM_PAGAMENTO', nome: 'Sem pagamento' },
  '99': { codigo: 'OUTROS', nome: 'Outros' },
};
const FORMA_DESCONHECIDA = TPAG_PARA_FORMA['99']!;
export function formaDoTpag(tpag: string): { codigo: string; nome: string } {
  return TPAG_PARA_FORMA[tpag] ?? FORMA_DESCONHECIDA;
}

// ---- 2.1 filial ----
/** Filial + a referência `filial_padrao` (usada no preço, M10). O Hub exige CNPJ e endereço (A-01); a IE e os dados fiscais não vão. */
export function mapearFilial(ev: EventoFilial, ocorridoEm: string): { registro: RegistroEspelho; referencia: ReferenciaEspelho | null } {
  const cnpj = ev.cnpj.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  const r = registro('filial', ocorridoEm, {
    external_id: chaveHub(ev),
    ativo: !ev.inativo,
    // RN-INF-02/T-0009 2.1: o código no Hub é a ordem do CNPJ (posições 9-12).
    codigo: cnpj.slice(8, 12),
    nome: ev.nome_fantasia ?? ev.razao_social,
    cidade: ev.endereco.municipio_nome ?? undefined,
    uf: ev.endereco.uf,
    // A-01 (RN-CORE-39 do FDV): CNPJ sem máscara e endereço do evento; telefone não existe no evento do cadastros.
    cnpj,
    logradouro: ev.endereco.logradouro,
    numero: ev.endereco.numero,
    complemento: ev.endereco.complemento,
    bairro: ev.endereco.bairro,
    cep: ev.endereco.cep.replace(/\D/g, ''),
  }, ev.id);
  const referencia = ev.padrao && !ev.inativo ? { tipo: 'filial_padrao' as const, erp_id: ev.id, dados: { filial_id: ev.id }, fonte_ocorrido_em: r.alterado_em } : null;
  return { registro: r, referencia };
}

/**
 * C-2: a tabela de preço vira `referencia` (nome e vigência compõem o preço, M10). RD-0318 (ADR 0010): a chave da tabela no
 * Hub (`chaveHub`: `external_id ?? id`) vai em `dados.chave`; `referencia.external_id` não é mais usado.
 */
export function mapearTabelaPreco(ev: EventoTabelaPreco, ocorridoEm: string): ReferenciaEspelho {
  return {
    tipo: 'tabela_preco',
    erp_id: ev.id,
    dados: { chave: chaveHub(ev), nome: ev.nome, vigencia_inicio: ev.vigencia_inicio, ...(ev.vigencia_fim ? { vigencia_fim: ev.vigencia_fim } : {}), inativo: ev.inativo },
    fonte_ocorrido_em: instanteUtc(ocorridoEm),
  };
}

// ---- 2.2 vendedor ----
export function mapearVendedor(ev: EventoVendedor, ocorridoEm: string): RegistroEspelho {
  return registro('vendedor', ocorridoEm, { external_id: chaveHub(ev), ativo: !ev.inativo, nome: ev.nome, filial_external_id: ev.filial_id }, ev.id, { filial_id: ev.filial_id });
}

// ---- 2.3 forma_pagamento e prazo_pagamento ----
/** `formaAtiva`: o consumidor calcula (há prazo ativo no espelho com a mesma forma, incluindo este). */
export function mapearCondicao(ev: EventoCondicao, ocorridoEm: string, ctx: { tenantId: string; formaAtiva: boolean }): { forma: RegistroEspelho; prazo: RegistroEspelho | null } {
  // D12 (T-0026): a forma da carga viaja na condição; sem ela, UUID v5 do tPag (M2) e o nome do tPag do MOC.
  const formaId = chaveHub({ id: externalIdForma(ctx.tenantId, ev.forma_tpag), external_id: ev.forma_external_id });
  const f = formaDoTpag(ev.forma_tpag);
  const forma = registro(
    'forma_pagamento',
    ocorridoEm,
    { external_id: formaId, ativo: ctx.formaAtiva, codigo: ev.forma_codigo ?? f.codigo, nome: ev.forma_nome ?? f.nome },
    null,
    { condicao_pagamento_id: ev.id },
  );
  // RN-CAD-15 (T-0085 lote 2): o prazo incompleto NÃO sai; a forma sai assim mesmo, porque é compartilhada. A regra é a do `cadastros`.
  if (!prazoCompleto(ev)) return { forma, prazo: null };
  const prazo = registro(
    'prazo_pagamento',
    ocorridoEm,
    {
      external_id: chaveHub(ev),
      ativo: !ev.inativo,
      forma_external_id: formaId,
      codigo: ev.codigo,
      parcelas_dias: parcelasDiasParaHub(ev.prazos_dias),
      descricao: ev.descricao,
      prazo_medio_dias: ev.prazo_medio_dias as number,
    },
    ev.id,
    { condicao_pagamento_id: ev.id },
  );
  return { forma, prazo };
}

// ---- 2.4 produto e produto_unidade ----
/**
 * Custo e preço de venda nunca saem (M8): o mapeador monta o payload só com os campos do Hub, sem copiar o resto do
 * evento. Produto inativo leva as unidades com `ativo = false`. Unidade retirada de `unidades[]` é inativada pelo
 * consumidor com `inativarRegistro` sobre o espelho.
 */
export function mapearProduto(ev: EventoProduto, ocorridoEm: string): { produto: RegistroEspelho; unidades: RegistroEspelho[] } {
  const ean = ev.ean && ev.ean !== 'SEM GTIN' ? ev.ean : undefined;
  const produto = registro(
    'produto',
    ocorridoEm,
    {
      external_id: chaveHub(ev),
      ativo: !ev.inativo,
      sku: ev.codigo,
      nome: ev.descricao,
      unidade: siglaMedida(ev.unidade_comercial),
      ean,
      marca: ev.marca,
    },
    ev.id,
  );
  const unidades = ev.unidades.map((u) => {
    const eanU = u.ean && u.ean !== 'SEM GTIN' ? u.ean : undefined;
    return registro(
      'produto_unidade',
      ocorridoEm,
      {
        external_id: chaveHub(u),
        ativo: !ev.inativo,
        produto_external_id: chaveHub(ev),
        unidade: siglaMedida(u.unidade),
        fator: quantidade4(u.fator),
        ean: eanU,
        padrao: siglaMedida(u.unidade) === siglaMedida(ev.unidade_comercial),
      },
      u.id,
      { produto_id: ev.id },
    );
  });
  return { produto, unidades };
}

// ---- 2.5 preco ----
export interface ContextoPreco {
  /** `referencia(tabela_preco)` (`tabelaDaReferencia`); sem ela a linha é `referencia_ausente` (C-2). `chave` = `dados.chave` (RD-0318). */
  tabela: { chave: string; nome: string } | null;
  /** `referencia(filial_padrao)`. */
  filialPadraoId: string | null;
}

/**
 * `agregadoId` = `agregado_id` do evento (UUID v5 de tabela+filial+produto do cadastros, M2). Sem a referência da tabela
 * (C-2 ainda não chegou) o registro entra no espelho sem `tabela_nome`: `validarRegistro` o aponta como `referencia_ausente`
 * e a chegada da tabela o recompõe (M10).
 */
export function mapearPreco(agregadoId: string, ev: EventoPreco, ocorridoEm: string, ctx: ContextoPreco): RegistroEspelho {
  const naPadrao = ctx.filialPadraoId !== null && ev.filial_id === ctx.filialPadraoId;
  return registro(
    'preco',
    ocorridoEm,
    {
      // ADR 0010: chave do Hub = external_id do evento ?? agregado_id (o erp_id segue o agregado_id)
      external_id: chaveHub({ id: agregadoId, external_id: ev.external_id }),
      // O evento repete o `inativo` da tabela: tabela inativa = preço inativo.
      ativo: !ev.inativo,
      // RD-0318: a chave do Hub da tabela vem da referência, nunca o UUID cru do evento (sem referência, o campo falta)
      tabela_external_id: ctx.tabela?.chave,
      tabela_nome: ctx.tabela?.nome,
      vigencia_inicio: ev.vigencia_inicio,
      vigencia_fim: ev.vigencia_fim,
      produto_external_id: ev.produto_id,
      preco_cents: ev.preco_centavos,
      // Premissa P-1: a filial padrão vale para as filiais sem item, e no Hub "sem filial = todas".
      filial_external_id: naPadrao ? undefined : ev.filial_id,
    },
    agregadoId,
    { tabela_preco_id: ev.tabela_preco_id, produto_id: ev.produto_id, filial_id: ev.filial_id },
  );
}

// ---- 2.6 estoque ----
/** `agregadoId` = UUID v5 (filial + produto) do cadastros. Um depósito por filial na v1; sem `inativo`, sempre ativo. */
export function mapearEstoque(agregadoId: string, ev: EventoEstoque, ocorridoEm: string, ctx: { depositoNome: string | null }): RegistroEspelho {
  return registro(
    'estoque',
    ocorridoEm,
    {
      external_id: agregadoId,
      ativo: true,
      deposito_external_id: ev.filial_id,
      deposito_nome: ctx.depositoNome ?? undefined,
      produto_external_id: ev.produto_id,
      saldo: quantidade4(ev.quantidade),
      filial_external_id: ev.filial_id,
    },
    agregadoId,
    { filial_id: ev.filial_id, produto_id: ev.produto_id },
  );
}

// ---- 2.7 cliente e 2.8 cliente_endereco ----

/**
 * Minimização (M9, RN-CAD LGPD): só documento, nome, IE, carteira, filial, endereço principal, limite e prazo médio máximo. Sem
 * e-mail, contato, coordenada nem observação. A carteira (D7) é `vendedor_external_id`. Endereço sem `id` (evento antigo,
 * C-3 opcional) não gera `cliente_endereco`; com `id` e sem `municipio_nome` gera o registro e `validarRegistro` aponta `cidade`.
 */
export function mapearCliente(ev: EventoCliente, ocorridoEm: string): { cliente: RegistroEspelho; enderecos: RegistroEspelho[] } {
  const principal = ev.enderecos.find((e) => e.tipo === 'principal');
  const endereco = principal
    ? limpar({
        logradouro: principal.logradouro,
        numero: principal.numero,
        complemento: principal.complemento,
        bairro: principal.bairro,
        cidade: principal.municipio_nome,
        uf: principal.uf,
        cep: principal.cep,
      })
    : undefined;
  const cliente = registro(
    'cliente',
    ocorridoEm,
    {
      external_id: chaveHub(ev),
      ativo: !ev.inativo,
      razao_social: ev.razao_social,
      nome_fantasia: ev.nome_fantasia,
      documento: ev.documento,
      inscricao_estadual: ev.ie,
      vendedor_external_id: ev.vendedor_id,
      filial_external_id: ev.filial_id,
      endereco,
      limite_credito_cents: ev.limite_credito_centavos,
      // RN-CAD-16: o prazo médio máximo é o do cliente; nulo = sem limite (o campo sai omitido). `formas_pagamento` deixou de sair.
      prazo_medio_max_dias: ev.prazo_medio_dias ?? undefined,
    },
    ev.id,
    { vendedor_id: ev.vendedor_id, filial_id: ev.filial_id },
  );
  const enderecos = ev.enderecos.flatMap((e) =>
    e.id
      ? [
          registro(
            'cliente_endereco',
            ocorridoEm,
            {
              external_id: chaveHub({ id: e.id, external_id: e.external_id }),
              ativo: !ev.inativo,
              cliente_external_id: chaveHub(ev),
              logradouro: e.logradouro,
              numero: e.numero,
              complemento: e.complemento,
              bairro: e.bairro,
              cidade: e.municipio_nome,
              uf: e.uf,
              cep: e.cep,
              tipo: e.tipo,
              principal: e.tipo === 'principal',
            },
            e.id,
            { cliente_id: ev.id },
          ),
        ]
      : [],
  );
  return { cliente, enderecos };
}

/** Endereço/unidade retirado da lista: o registro do espelho vai com `ativo = false` (RN-CAD-08). */
export function inativarRegistro(r: RegistroEspelho, ocorridoEm: string): RegistroEspelho {
  const payload = { ...r.payload, ativo: false };
  return { ...r, ativo: false, payload, hash: hashRegistro(payload), alterado_em: instanteUtc(ocorridoEm) };
}

// ---- Validação local (M5) ----
const OBRIGATORIOS: Record<string, readonly string[]> = {
  filial: ['codigo', 'nome', 'cnpj', 'logradouro', 'numero', 'bairro', 'cep', 'cidade', 'uf'],
  vendedor: ['nome'],
  forma_pagamento: ['codigo', 'nome'],
  prazo_pagamento: ['forma_external_id', 'codigo', 'parcelas_dias', 'descricao', 'prazo_medio_dias'],
  produto: ['sku', 'nome', 'unidade'],
  produto_unidade: ['produto_external_id', 'unidade', 'fator'],
  preco: ['tabela_external_id', 'tabela_nome', 'vigencia_inicio', 'produto_external_id', 'preco_cents'],
  estoque: ['deposito_external_id', 'produto_external_id', 'saldo'],
  cliente: ['razao_social', 'filial_external_id'],
  cliente_endereco: ['cliente_external_id', 'logradouro', 'cidade', 'uf'],
};

/** Campos obrigatórios compostos de outra referência do ERP (M10): ausentes = `referencia_ausente`. */
const CAMPOS_DE_REFERENCIA: Record<string, readonly string[]> = { preco: ['tabela_external_id', 'tabela_nome'] };

/** Referências que precisam estar confirmadas no Hub: campo → entidade alvo (RN-INF-02, ordem de carga). */
export const REFERENCIAS_HUB: Record<string, ReadonlyArray<readonly [string, EntidadeHub]>> = {
  vendedor: [['filial_external_id', 'filial']],
  prazo_pagamento: [['forma_external_id', 'forma_pagamento']],
  produto_unidade: [['produto_external_id', 'produto']],
  preco: [['produto_external_id', 'produto'], ['filial_external_id', 'filial']],
  estoque: [['produto_external_id', 'produto'], ['filial_external_id', 'filial']],
  cliente: [['filial_external_id', 'filial'], ['vendedor_external_id', 'vendedor']],
  cliente_endereco: [['cliente_external_id', 'cliente']],
};

/**
 * Valida o registro antes do envio (M5): campo obrigatório vazio, formato do Hub, referência não confirmada. Devolve a linha
 * inválida (código e campo, nunca o valor — RN-INF-04) ou `null` se pode ir em `registros`.
 * `confirmado(entidade, external_id)`: o registro alvo já foi confirmado no Hub.
 */
export function validarRegistro(r: RegistroEspelho, confirmado: (entidade: EntidadeHub, externalId: string) => boolean, opcoes: { prazoV2?: boolean } = {}): LinhaInvalida | null {
  const falta = (OBRIGATORIOS[r.entidade] ?? []).find((c) => {
    const v = r.payload[c];
    return v === undefined || v === null || v === '';
  });
  // Campo composto de outra referência (C-2): ausente = a referência ainda não chegou (reprocessável), não erro do cadastro.
  if (falta) return { external_id: r.external_id, codigo: (CAMPOS_DE_REFERENCIA[r.entidade] ?? []).includes(falta) ? 'referencia_ausente' : 'campo_obrigatorio', campo: falta };
  const schema = PAYLOADS_HUB[r.entidade as keyof typeof PAYLOADS_HUB];
  if (r.entidade === 'prazo_pagamento' && opcoes.prazoV2) {
    // contrato v2 do prazo (ADR 0072 do FDV): limites próprios; `alterado_em` entra no registro do lote, não no payload do espelho
    const res = PrazoPagamentoHubV2.safeParse({ ...r.payload, alterado_em: r.alterado_em });
    if (!res.success) {
      const issue = res.error.issues[0];
      return { external_id: r.external_id, codigo: 'campo_invalido', campo: String(issue?.path[0] ?? '') || null };
    }
  } else if (schema) {
    // `strict`: chave a mais no payload também é `campo_invalido`.
    const res = schema.strict().safeParse(r.payload);
    if (!res.success) {
      const issue = res.error.issues[0];
      const chave = issue?.code === 'unrecognized_keys' ? issue.keys[0] : issue?.path[0];
      const campo = String(chave ?? '') || null;
      return { external_id: r.external_id, codigo: 'campo_invalido', campo };
    }
  }
  // A-01: o Hub confere o dígito verificador do CNPJ da filial (RN-CORE-39 do FDV); o valor nunca vai na linha (RN-INF-04).
  if (r.entidade === 'filial' && !cnpjValido(String(r.payload.cnpj))) return { external_id: r.external_id, codigo: 'campo_invalido', campo: 'cnpj' };
  for (const [campo, alvo] of REFERENCIAS_HUB[r.entidade] ?? []) {
    const v = r.payload[campo];
    if (typeof v === 'string' && !confirmado(alvo, v)) return { external_id: r.external_id, codigo: 'referencia_ausente', campo };
  }
  return null;
}

/** Duas filiais do tenant com a mesma ordem de CNPJ (P-5): todas as repetidas viram linha inválida. */
export function filiaisComCodigoRepetido(filiais: readonly RegistroEspelho[]): LinhaInvalida[] {
  const por = new Map<string, RegistroEspelho[]>();
  for (const f of filiais) if (f.ativo) por.set(String(f.payload.codigo), [...(por.get(String(f.payload.codigo)) ?? []), f]);
  return [...por.values()].filter((g) => g.length > 1).flatMap((g) => g.map((f) => ({ external_id: f.external_id, codigo: 'filial_codigo_repetido', campo: 'codigo' })));
}
