/**
 * T-0022 (F4): matriz das 20 notas no simulador da SEFAZ-AM, fonte única do plano (docs/testes/T-0022.md) e do texto
 * de cada `it.todo`. Critério da F4 no simulador (decisão de 21/11/2026, 22h59, Manaus); homologação real na T-0046.
 */
import type { AmbienteFiscal } from '../../../modules/core/contracts';
import type { FaixaInutilizada, NumeroEmitido } from './numeracao';

export const COBERTURA_OBRIGATORIA = [
  'autorizacao',
  'rejeicao',
  'cancelamento',
  'cce',
  'inutilizacao',
  'danfe',
  'ibs-cbs-is',
  'xml-guardado-antes',
  'xml-imutavel',
  'nota-nao-editada',
  'guarda-fiscal',
  'numeracao',
  'concorrencia',
  'idempotencia',
  'producao-bloqueada',
  'rls-multitenant',
  'licenca',
  'valor-regra',
  'mei',
] as const;
export type Cobertura = (typeof COBERTURA_OBRIGATORIA)[number];

/** O que falta para a nota passar pelo PRODUTO (API ou worker do faturamento), por chave de `alemDaBase`. */
export const DEPENDENCIAS = {
  'T-0019-0013': 'migração 0013 do faturamento (banco-dados): numeração por série, nota, nota_xml imutável e inutilização',
  'T-0021-emissao':
    'faturamento P-3b (branches nuvem/T-0021-faturamento-emissao e -1b): rotas /v1/faturamento, repositório SQL e worker da emissão, ' +
    'com a porta SefazTransporte do @macuxierp/nfe-sefaz (no lugar do dublê de api/portas.ts) obtida pelo criarSeletorTransporte ' +
    'e a FabricaTransporteSimulador injetável no worker (o contador do teste fica em volta dela)',
  'T-0021-eventos': 'faturamento P-5: cancelamento (110111), CC-e (110110) e inutilização pela API/worker',
  'T-0021-danfe': 'faturamento P-5: DANFE em PDF',
  'T-0021-titulos': 'faturamento P-5: títulos a receber da nota (RF-FAT-07)',
  'T-0021-rejeicoes': 'faturamento P-5: painel de rejeições com código, mensagem e ação sugerida (RF-FAT-08)',
  'T-0020-ibs-cbs-is': 'motor fiscal: IBS, CBS e IS (NT 2025.002-RTC)',
  'T-0018-nfe-emissor':
    'montador do XML da NF-e, do evento e da inutilização (packages/nfe-emissor): é quem gera as tags CRT 4, ICMSSN102 e ' +
    'PISOutr/COFINSOutr (RD-0254)',
  'T-0020-lote-4c':
    'motor fiscal, lote 4c: barreira de CSOSN com crédito (101/201/900) e de IPI no CRT 4, caso MEI revendedor, com código de erro novo',
  'T-0019-filial-crt4':
    'banco/cadastro: filial emissora com CRT 4 (MEI) no tenant de teste, com série 1 e core.ambiente_fiscal em homologação, ' +
    'lida pelo faturamento ao montar o emitente (tag CRT do XML)',
  'T-0045-rejeicao-roteirizada':
    'simulador: controle para rejeitar o próximo envio de uma filial com um cStat escolhido (hoje só paralisar, ' +
    'atrasarRecibo, falharTransporte e denegar); sem ele, a rejeição pelo produto exige forjar o XML ou o A1',
} as const;
export type Dependencia = keyof typeof DEPENDENCIAS;

/** Toda nota depende disto para passar pela API ou pelo worker. */
export const BASE_PENDENTE: readonly Dependencia[] = ['T-0019-0013', 'T-0021-emissao', 'T-0018-nfe-emissor'];

export interface NotaDaMatriz extends NumeroEmitido {
  id: `N${string}`;
  cenario: string;
  entrada: string;
  esperado: string;
  /** RN do doc 03 e/ou regra do CLAUDE.md (`CLAUDE-7` = regra inegociável 7, fiscal). */
  regras: string[];
  cobertura: Cobertura[];
  /** Pendências da nota além de `BASE_PENDENTE`; a lista completa é `dependeDe(nota)`. */
  alemDaBase: Dependencia[];
}

/** Tudo o que falta para a nota virar `it`: `BASE_PENDENTE` e o específico do cenário. */
export const dependeDe = (n: Pick<NotaDaMatriz, 'alemDaBase'>): Dependencia[] => [...BASE_PENDENTE, ...n.alemDaBase];

/** Nomes lógicos do lote (os UUIDs são gerados no banco efêmero); distintos dos de tests/apoio/api-memoria.ts. */
export const TENANT_LOTE_A = 'tenant-lote-a';
export const TENANT_LOTE_B = 'tenant-lote-b';
/** Tenant que espelha o piloto (a thathyany é MEI, R-20261122-003721-alexandre): dados fictícios. */
export const TENANT_LOTE_M = 'tenant-lote-m';
export const FILIAL_LOTE_A1 = 'a1';
export const FILIAL_LOTE_A2 = 'a2';
export const FILIAL_LOTE_A3 = 'a3';
export const FILIAL_LOTE_B1 = 'b1';
export const FILIAL_LOTE_M1 = 'm1';

export interface FilialDoLote {
  tenant: string;
  /** Lido de core.ambiente_fiscal (contrato `AmbienteFiscal`), nunca do tpAmb. */
  ambiente: AmbienteFiscal['ambiente'];
  /** Código de regime tributário: 1 Simples Nacional, 3 regime normal, 4 MEI (Simples, com CSOSN). */
  crt: 1 | 3 | 4;
  uf: 'AM';
}

/** A A3 vai a produção pelo script do operador (ADR 0006): nunca emite no arnês, só prova o bloqueio. */
export const FILIAIS: Readonly<Record<string, FilialDoLote>> = {
  [FILIAL_LOTE_A1]: { tenant: TENANT_LOTE_A, ambiente: 'homologacao', crt: 3, uf: 'AM' },
  [FILIAL_LOTE_A2]: { tenant: TENANT_LOTE_A, ambiente: 'homologacao', crt: 1, uf: 'AM' },
  [FILIAL_LOTE_A3]: { tenant: TENANT_LOTE_A, ambiente: 'producao', crt: 3, uf: 'AM' },
  [FILIAL_LOTE_B1]: { tenant: TENANT_LOTE_B, ambiente: 'homologacao', crt: 3, uf: 'AM' },
  [FILIAL_LOTE_M1]: { tenant: TENANT_LOTE_M, ambiente: 'homologacao', crt: 4, uf: 'AM' },
};

const a1 = (serie: number, numero: number) => ({
  tenant: TENANT_LOTE_A,
  filial: FILIAL_LOTE_A1,
  serie,
  numero,
});

const m1 = (numero: number) => ({ tenant: TENANT_LOTE_M, filial: FILIAL_LOTE_M1, serie: 1, numero });

/** O que vale em toda nota MEI (CRT 4) do lote; IBS/CBS/IS: ver docs/testes/T-0022.md, seção MEI. */
const ESPERADO_MEI =
  'tag CRT 4 no emit; ICMS em grupo ICMSSN102 com CSOSN (nunca CST), sem vBC, pICMS nem vICMS e sem pCredSN/vCredICMSSN; ' +
  'PIS e COFINS CST 99 (no DAS) em PISOutr e COFINSOutr com vBC, pPIS/pCOFINS e vPIS/vCOFINS zerados, não ausentes; ' +
  'sem IPI destacado; vICMS e vIPI zerados no total; grupos IBS/CBS/IS a conferir na T-0046';

/** Toda nota autorizada consome número da série (RN-FAT-01), por isso todas cobrem `numeracao`. */
export const MATRIZ: readonly NotaDaMatriz[] = [
  {
    id: 'N01',
    ...a1(1, 1),
    cenario: 'Autorização simples, venda interna AM, ICMS CST 00, com DANFE',
    entrada: 'Pedido aprovado com 2 itens e informações complementares, cliente contribuinte AM, CFOP 5102',
    esperado:
      'cStat 100 com nProt do simulador; o nfeProc (montarNfeProc, válido no XSD procNFe, verAplic do simulador) guardado antes do DANFE e do evento; tpAmb 2; ' +
      'DANFE em PDF gerado só depois do XML guardado, com chave, protocolo, totais e "sem valor fiscal" no texto',
    regras: ['RN-FAT-03', 'RN-FAT-04', 'RF-FAT-03', 'CLAUDE-7'],
    cobertura: ['autorizacao', 'xml-guardado-antes', 'danfe', 'valor-regra', 'numeracao'],
    alemDaBase: ['T-0021-danfe'],
  },
  {
    id: 'N02',
    ...a1(1, 2),
    cenario: 'Venda interestadual AM para PA com IPI e 3 itens',
    entrada: 'Pedido com 3 itens, CFOP 6102, IPI 10% num item',
    esperado:
      'Autorizada; ICMS, IPI, PIS e COFINS por item e totais iguais à fórmula da RN com o arredondamento do Manual, na tela, no XML e no DANFE',
    regras: ['RN-FIS-01', 'RN-FIS-02', 'RN-CORE-03'],
    cobertura: ['autorizacao', 'valor-regra', 'numeracao'],
    alemDaBase: ['T-0021-danfe'],
  },
  {
    id: 'N03',
    ...a1(1, 3),
    cenario: 'Grupos IBS e CBS (NT 2025.002-RTC)',
    entrada: 'Pedido com 2 itens de cClassTrib diferentes',
    esperado:
      'Autorizada; grupos IBS (UF e município) e CBS por item e no total, conferidos contra a NT na versão da ADR',
    regras: ['RN-FIS-03', 'RN-FIS-04', 'RN-CORE-03'],
    cobertura: ['autorizacao', 'ibs-cbs-is', 'valor-regra', 'numeracao'],
    alemDaBase: ['T-0020-ibs-cbs-is'],
  },
  {
    id: 'N04',
    ...a1(1, 4),
    cenario: 'Grupo IS (Imposto Seletivo) junto com IBS e CBS',
    entrada: 'Pedido com 1 item sujeito ao IS (NCM de bebida açucarada) e 1 item sem IS',
    esperado: 'Autorizada; grupo IS só no item sujeito; total do IS e a base do IBS/CBS conforme a NT',
    regras: ['RN-FIS-03', 'RN-CORE-03'],
    cobertura: ['autorizacao', 'ibs-cbs-is', 'valor-regra', 'numeracao'],
    alemDaBase: ['T-0020-ibs-cbs-is'],
  },
  {
    id: 'N05',
    ...a1(1, 5),
    cenario: 'Rejeição e reenvio com o mesmo número',
    entrada:
      'O simulador rejeita o próximo envio da A1 (cStat e xMotivo no protNFe; controle pendente na T-0045); o usuário corrige o dado e reenvia',
    esperado:
      'Painel mostra código, mensagem e ação sugerida; o reenvio usa o nº 5 (a tentativa rejeitada não é linha à parte); a próxima nota (N06) é o nº 6',
    regras: ['RN-FAT-07', 'RN-FAT-01', 'CLAUDE-7'],
    cobertura: ['rejeicao', 'autorizacao', 'numeracao'],
    alemDaBase: ['T-0021-rejeicoes', 'T-0045-rejeicao-roteirizada'],
  },
  {
    id: 'N06',
    ...a1(1, 6),
    cenario: 'Idempotência: reenvio com a mesma chave',
    entrada: 'Mesmo pedido de emissão enviado 3 vezes com a mesma chave de idempotência/external_id',
    esperado:
      'Uma nota só, nº 6, a mesma chave de acesso nas 3 respostas; 1 chamada de autorização no contador do simulador',
    regras: ['RN-CORE-05', 'RN-FAT-01', 'CLAUDE-4'],
    cobertura: ['idempotencia', 'numeracao', 'autorizacao'],
    alemDaBase: [],
  },
  {
    id: 'N07',
    ...a1(1, 7),
    cenario: 'Nota autorizada não se edita; cancelamento no prazo',
    entrada:
      'Nota autorizada; tentativa de editar itens e valores pela API e por UPDATE do papel macuxierp_app; depois evento 110111 com justificativa de 15+ caracteres',
    esperado:
      'Edição: API responde 422 citando RN-FAT-02 e o UPDATE no banco falha, nota intacta; cancelamento: evento homologado e guardado, XML autorizado byte a byte igual, status cancelada, DANFE marca cancelada',
    regras: ['RN-FAT-02', 'CLAUDE-7'],
    cobertura: ['autorizacao', 'nota-nao-editada', 'cancelamento', 'xml-imutavel', 'danfe', 'numeracao'],
    alemDaBase: ['T-0021-eventos', 'T-0021-danfe'],
  },
  {
    id: 'N08',
    ...a1(1, 8),
    cenario: 'Carta de correção (CC-e) duas vezes',
    entrada: 'CC-e seq 1 e seq 2 em campo permitido; tentativa de CC-e em valor ou imposto',
    esperado:
      'Seq 1 e 2 homologadas e guardadas; a de valor/imposto recusada antes do simulador; XML autorizado intacto',
    regras: ['RN-FAT-02', 'CLAUDE-7'],
    cobertura: ['autorizacao', 'cce', 'xml-imutavel', 'numeracao'],
    alemDaBase: ['T-0021-eventos'],
  },
  {
    id: 'N09',
    ...a1(1, 11),
    cenario: 'Inutilização da faixa 9 a 10 e emissão seguinte',
    entrada: 'Inutilizar 9 a 10 da série 1 da A1 com justificativa; emitir a próxima nota',
    esperado:
      'Inutilização homologada e guardada; a nota sai com o nº 11; a série 1 da A1 não tem buraco fora da faixa',
    regras: ['RN-FAT-01', 'CLAUDE-7'],
    cobertura: ['inutilizacao', 'numeracao', 'autorizacao'],
    alemDaBase: ['T-0021-eventos'],
  },
  {
    id: 'N10',
    ...a1(1, 12),
    cenario: 'Concorrência: 1ª de duas emissões simultâneas na mesma série',
    entrada: 'Duas emissões disparadas ao mesmo tempo (Promise.all) na série 1 da A1',
    esperado: 'Recebem 12 e 13, sem número repetido nem buraco, cada uma com a sua chave',
    regras: ['RN-FAT-01', 'CLAUDE-7'],
    cobertura: ['concorrencia', 'numeracao', 'autorizacao'],
    alemDaBase: [],
  },
  {
    id: 'N11',
    ...a1(1, 13),
    cenario: 'Concorrência: 2ª de duas emissões simultâneas na mesma série',
    entrada: 'A emissão gêmea da N10',
    esperado: 'O outro número da dupla (12/13); a ordem entre as duas pode variar, o conjunto não',
    regras: ['RN-FAT-01', 'CLAUDE-7'],
    cobertura: ['concorrencia', 'numeracao', 'autorizacao'],
    alemDaBase: [],
  },
  {
    id: 'N12',
    ...a1(2, 1),
    cenario: 'Série 2 da mesma filial é independente; XML guardado antes de tudo e imutável',
    entrada:
      'Emissão na série 2 da A1 depois da série 1 já estar no 13, com falha simulada no armazenamento na 1ª guarda; depois UPDATE e DELETE no XML guardado pelo papel macuxierp_app',
    esperado:
      'Sai com o nº 1 da série 2 e a série 1 não anda; nota "autorizada, guarda pendente" sem DANFE, evento nem outbox até guardar; depois UPDATE e DELETE falham',
    regras: ['RN-FAT-01', 'RN-FAT-03', 'RF-FAT-06', 'CLAUDE-7'],
    cobertura: ['xml-guardado-antes', 'xml-imutavel', 'autorizacao', 'numeracao'],
    alemDaBase: [],
  },
  {
    id: 'N13',
    tenant: TENANT_LOTE_A,
    filial: FILIAL_LOTE_A2,
    serie: 1,
    numero: 1,
    cenario: 'Filial em produção nunca alcança o simulador; outra filial, Simples Nacional (CSOSN)',
    entrada:
      'Emissão pedida na A3 (produção) pela API de produção; em seguida a mesma emissão na série 1 da A2 (CRT 1), CSOSN 102',
    esperado:
      'A3: a API ou o worker bloqueia antes de reservar número e antes da rede (SimuladorEmProducaoErro, SEFAZ_SIMULADOR_EM_PRODUCAO, do seletor); 0 chamadas para o filial_id da A3 no contador da FabricaTransporteSimulador; ' +
      'A2: nº 1 autorizado (sequência por filial), tag CRT 1, CSOSN no lugar do CST',
    regras: ['RN-CORE-08', 'RN-FAT-04', 'RN-FAT-01', 'RN-FIS-02', 'CLAUDE-7'],
    cobertura: ['producao-bloqueada', 'autorizacao', 'valor-regra', 'numeracao'],
    alemDaBase: [],
  },
  {
    id: 'N14',
    tenant: TENANT_LOTE_B,
    filial: FILIAL_LOTE_B1,
    serie: 1,
    numero: 1,
    cenario: 'Outro tenant: numeração própria e RLS',
    entrada: 'Emissão no tenant B; leitura da nota e do XML pelo tenant A (lista, id e chave de acesso)',
    esperado: 'B sai com o nº 1; A não vê a nota nem o XML de B (lista vazia, 404 pelo id, nada pela chave)',
    regras: ['CLAUDE-5', 'RN-CORE-02', 'RN-FAT-01'],
    cobertura: ['rls-multitenant', 'numeracao', 'autorizacao'],
    alemDaBase: [],
  },
  {
    id: 'N15',
    tenant: TENANT_LOTE_B,
    filial: FILIAL_LOTE_B1,
    serie: 1,
    numero: 2,
    cenario: 'Licença do módulo faturamento',
    entrada: 'Tenant B sem a licença do faturamento pede emissão; o operador liga a licença; nova emissão',
    esperado: 'Sem licença: 403 MODULO_INATIVO, nada reservado nem enviado; com licença: nº 2 autorizado',
    regras: ['RN-CORE-02', 'CLAUDE-6'],
    cobertura: ['licenca', 'autorizacao', 'numeracao'],
    alemDaBase: [],
  },
  {
    id: 'N16',
    ...m1(1),
    cenario: 'MEI: venda intraestadual AM com CSOSN 102, sem destaque de ICMS',
    entrada:
      'Pedido com 2 itens na M1, cliente contribuinte AM, CFOP 5102, regra CSOSN 102, sem regra de PIS/COFINS cadastrada; antes, tentativa de aplicar no cálculo da emissão regra com CST 00, com CSOSN 101 e com IPI 10%',
    esperado:
      'Regra com CST recusada na seleção da regra (CODIGO_INCOMPATIVEL_CRT); CSOSN 101 recusado antes do simulador; a de IPI recusada (código a fixar no lote 4c da T-0020); ' +
      'todas antes de reservar número e antes do simulador; ' +
      `depois nº 1 da série 1 da M1 autorizado (numeração própria, independente dos tenants A e B); ${ESPERADO_MEI}; vNF = soma dos itens`,
    regras: ['RN-FIS-01', 'RN-FIS-02', 'RN-FAT-01', 'RN-CORE-03'],
    cobertura: ['mei', 'autorizacao', 'valor-regra', 'numeracao'],
    alemDaBase: ['T-0019-filial-crt4', 'T-0020-lote-4c'],
  },
  {
    id: 'N17',
    ...m1(2),
    cenario: 'MEI: venda interestadual AM para PA',
    entrada: 'Pedido com 1 item na M1, cliente contribuinte PA, CFOP 6102, CSOSN 102',
    esperado: `nº 2 da M1 autorizado; ${ESPERADO_MEI}; sem ICMS interestadual destacado nem DIFAL na nota`,
    regras: ['RN-FIS-01', 'RN-FIS-02', 'RN-FAT-01'],
    cobertura: ['mei', 'autorizacao', 'valor-regra', 'numeracao'],
    alemDaBase: ['T-0019-filial-crt4', 'T-0020-lote-4c'],
  },
  {
    id: 'N18',
    ...m1(3),
    cenario: 'MEI: faturamento parcial do pedido com títulos a receber',
    entrada:
      'Pedido de 3 itens na M1 faturado em parte (2 itens), forma Boleto (RN-FAT-06: só boleto gera título), condição 30/60/90 com total que não divide por 3',
    esperado: `nº 3 da M1 autorizado; ${ESPERADO_MEI}; 3 títulos, rateio sem perder centavo (diferença na 1ª parcela); pedido faturado_parcial`,
    regras: ['RN-FAT-06', 'RN-CORE-03', 'RN-PED-02', 'RN-FIS-02'],
    cobertura: ['mei', 'autorizacao', 'valor-regra', 'numeracao'],
    alemDaBase: ['T-0019-filial-crt4', 'T-0020-lote-4c', 'T-0021-titulos'],
  },
  {
    id: 'N19',
    ...m1(4),
    cenario: 'MEI: CC-e e cancelamento',
    entrada:
      'Nota MEI autorizada; CC-e seq 1 em campo permitido; tentativa de CC-e que acrescenta ICMS destacado; depois evento 110111 com justificativa de 15+ caracteres',
    esperado:
      'nº 4 da M1 autorizado; CC-e seq 1 homologada e guardada; a CC-e de imposto recusada antes do simulador; cancelamento homologado e guardado, status cancelada; XML autorizado byte a byte igual depois dos dois eventos',
    regras: ['RN-FAT-02', 'RN-FIS-02', 'CLAUDE-7'],
    cobertura: ['mei', 'autorizacao', 'cce', 'cancelamento', 'xml-imutavel', 'numeracao'],
    alemDaBase: ['T-0019-filial-crt4', 'T-0020-lote-4c', 'T-0021-eventos'],
  },
  {
    id: 'N20',
    ...a1(1, 14),
    cenario: 'Fechamento do lote: conferência final',
    entrada:
      'Última emissão; leitura por tenant (A, B e M) de notas, inutilizações, último número reservado por série, XML guardados, contador do simulador e logs; UPDATE de deleted_at no XML guardado pelo papel macuxierp_app',
    esperado:
      '20 autorizadas e 20 XML guardados (4 delas da M1); séries sem buraco fora da 9-10, contando o último reservado; 0 chamadas para a A3 no contador da FabricaTransporteSimulador; deleted_at do XML não é marcado (o UPDATE falha); log sem A1, senha nem dado pessoal',
    regras: ['RN-FAT-01', 'RN-FAT-03', 'RN-CORE-07', 'CLAUDE-7', 'CLAUDE-8', 'CLAUDE-9'],
    cobertura: [
      'autorizacao',
      'numeracao',
      'inutilizacao',
      'xml-guardado-antes',
      'guarda-fiscal',
      'producao-bloqueada',
    ],
    alemDaBase: ['T-0021-eventos'],
  },
];

/** A única inutilização do lote (N09). */
export const INUTILIZACOES: readonly FaixaInutilizada[] = [
  { tenant: TENANT_LOTE_A, filial: FILIAL_LOTE_A1, serie: 1, inicio: 9, fim: 10 },
];
