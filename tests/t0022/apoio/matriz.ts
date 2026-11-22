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
] as const;
export type Cobertura = (typeof COBERTURA_OBRIGATORIA)[number];

/** Tarefas da base: T-0045 simulador e A1 de teste, T-0019 banco, T-0020 motor fiscal, T-0021 emissão. */
export type Dependencia = 'T-0019' | 'T-0020' | 'T-0021' | 'T-0045';

/** Toda nota precisa da base inteira para sair autorizada; `destravadoPor` diz a peça específica que ela prova. */
export const BASE_NECESSARIA: readonly Dependencia[] = ['T-0045', 'T-0019', 'T-0020', 'T-0021'];

export interface NotaDaMatriz extends NumeroEmitido {
  id: `N${string}`;
  cenario: string;
  entrada: string;
  esperado: string;
  /** RN do doc 03 e/ou regra do CLAUDE.md (`CLAUDE-7` = regra inegociável 7, fiscal). */
  regras: string[];
  cobertura: Cobertura[];
  destravadoPor: Dependencia;
}

/** Nomes lógicos do lote (os UUIDs são gerados no banco efêmero); distintos dos de tests/apoio/api-memoria.ts. */
export const TENANT_LOTE_A = 'tenant-lote-a';
export const TENANT_LOTE_B = 'tenant-lote-b';
export const FILIAL_LOTE_A1 = 'a1';
export const FILIAL_LOTE_A2 = 'a2';
export const FILIAL_LOTE_A3 = 'a3';
export const FILIAL_LOTE_B1 = 'b1';

export interface FilialDoLote {
  tenant: string;
  /** Lido de core.ambiente_fiscal (contrato `AmbienteFiscal`), nunca do tpAmb. */
  ambiente: AmbienteFiscal['ambiente'];
  /** Código de regime tributário: 1 Simples Nacional, 3 regime normal. */
  crt: 1 | 3;
  uf: 'AM';
}

/** A A3 vai a produção pelo script do operador (ADR 0006): nunca emite no arnês, só prova o bloqueio. */
export const FILIAIS: Readonly<Record<string, FilialDoLote>> = {
  [FILIAL_LOTE_A1]: { tenant: TENANT_LOTE_A, ambiente: 'homologacao', crt: 3, uf: 'AM' },
  [FILIAL_LOTE_A2]: { tenant: TENANT_LOTE_A, ambiente: 'homologacao', crt: 1, uf: 'AM' },
  [FILIAL_LOTE_A3]: { tenant: TENANT_LOTE_A, ambiente: 'producao', crt: 3, uf: 'AM' },
  [FILIAL_LOTE_B1]: { tenant: TENANT_LOTE_B, ambiente: 'homologacao', crt: 3, uf: 'AM' },
};

const a1 = (serie: number, numero: number) => ({
  tenant: TENANT_LOTE_A,
  filial: FILIAL_LOTE_A1,
  serie,
  numero,
});

/** Toda nota autorizada consome número da série (RN-FAT-01), por isso todas cobrem `numeracao`. */
export const MATRIZ: readonly NotaDaMatriz[] = [
  {
    id: 'N01',
    ...a1(1, 1),
    cenario: 'Autorização simples, venda interna AM, ICMS CST 00',
    entrada: 'Pedido aprovado com 1 item, cliente contribuinte AM, CFOP 5102',
    esperado:
      'cStat 100 com protocolo; XML com o protocolo guardado antes do DANFE e do evento; tpAmb 2; marca "sem valor fiscal"',
    regras: ['RN-FAT-03', 'RN-FAT-04', 'CLAUDE-7'],
    cobertura: ['autorizacao', 'xml-guardado-antes', 'numeracao'],
    destravadoPor: 'T-0021',
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
    destravadoPor: 'T-0020',
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
    destravadoPor: 'T-0020',
  },
  {
    id: 'N04',
    ...a1(1, 4),
    cenario: 'Grupo IS (Imposto Seletivo) junto com IBS e CBS',
    entrada: 'Pedido com 1 item sujeito ao IS (NCM de bebida açucarada) e 1 item sem IS',
    esperado: 'Autorizada; grupo IS só no item sujeito; total do IS e a base do IBS/CBS conforme a NT',
    regras: ['RN-FIS-03', 'RN-CORE-03'],
    cobertura: ['autorizacao', 'ibs-cbs-is', 'valor-regra', 'numeracao'],
    destravadoPor: 'T-0020',
  },
  {
    id: 'N05',
    ...a1(1, 5),
    cenario: 'Rejeição e reenvio com o mesmo número',
    entrada:
      'Roteiro do simulador rejeita o próximo envio da A1 (código e motivo); o usuário corrige o dado e reenvia',
    esperado:
      'Painel mostra código, mensagem e ação sugerida; o reenvio usa o nº 5 (a tentativa rejeitada não é linha à parte); a próxima nota (N06) é o nº 6',
    regras: ['RN-FAT-07', 'RN-FAT-01', 'CLAUDE-7'],
    cobertura: ['rejeicao', 'autorizacao', 'numeracao'],
    destravadoPor: 'T-0045',
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
    destravadoPor: 'T-0021',
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
    destravadoPor: 'T-0021',
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
    destravadoPor: 'T-0021',
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
    destravadoPor: 'T-0021',
  },
  {
    id: 'N10',
    ...a1(1, 12),
    cenario: 'DANFE em PDF',
    entrada: 'Nota autorizada com 2 itens e informações complementares',
    esperado:
      'PDF gerado só depois do XML guardado; chave, protocolo, totais e "sem valor fiscal" no texto do PDF',
    regras: ['RN-FAT-03', 'RN-FAT-04', 'RF-FAT-03'],
    cobertura: ['autorizacao', 'danfe', 'xml-guardado-antes', 'valor-regra', 'numeracao'],
    destravadoPor: 'T-0021',
  },
  {
    id: 'N11',
    ...a1(1, 13),
    cenario: 'Concorrência: 1ª de duas emissões simultâneas na mesma série',
    entrada: 'Duas emissões disparadas ao mesmo tempo (Promise.all) na série 1 da A1',
    esperado: 'Recebem 13 e 14, sem número repetido nem buraco, cada uma com a sua chave',
    regras: ['RN-FAT-01', 'CLAUDE-7'],
    cobertura: ['concorrencia', 'numeracao', 'autorizacao'],
    destravadoPor: 'T-0019',
  },
  {
    id: 'N12',
    ...a1(1, 14),
    cenario: 'Concorrência: 2ª de duas emissões simultâneas na mesma série',
    entrada: 'A emissão gêmea da N11',
    esperado: 'O outro número da dupla (13/14); a ordem entre as duas pode variar, o conjunto não',
    regras: ['RN-FAT-01', 'CLAUDE-7'],
    cobertura: ['concorrencia', 'numeracao', 'autorizacao'],
    destravadoPor: 'T-0019',
  },
  {
    id: 'N13',
    ...a1(2, 1),
    cenario: 'Série 2 da mesma filial é independente',
    entrada: 'Emissão na série 2 da A1 depois da série 1 já estar no 14',
    esperado: 'Sai com o nº 1 da série 2; a série 1 não anda',
    regras: ['RN-FAT-01'],
    cobertura: ['numeracao', 'autorizacao'],
    destravadoPor: 'T-0019',
  },
  {
    id: 'N14',
    ...a1(2, 2),
    cenario: 'XML guardado antes de tudo e imutável',
    entrada:
      'Falha simulada no armazenamento na 1ª guarda; depois UPDATE e DELETE no XML guardado pelo papel macuxierp_app',
    esperado:
      'Nota "autorizada, guarda pendente" sem DANFE, evento nem outbox até guardar; depois UPDATE e DELETE falham',
    regras: ['RN-FAT-03', 'RF-FAT-06', 'CLAUDE-7'],
    cobertura: ['xml-guardado-antes', 'xml-imutavel', 'autorizacao', 'numeracao'],
    destravadoPor: 'T-0019',
  },
  {
    id: 'N15',
    tenant: TENANT_LOTE_A,
    filial: FILIAL_LOTE_A2,
    serie: 1,
    numero: 1,
    cenario: 'Outra filial, Simples Nacional (CSOSN)',
    entrada: 'Emissão na série 1 da A2 (CRT 1), CSOSN 102',
    esperado: 'Sai com o nº 1 (sequência por filial); CSOSN no lugar do CST',
    regras: ['RN-FAT-01', 'RN-FIS-02'],
    cobertura: ['numeracao', 'autorizacao', 'valor-regra'],
    destravadoPor: 'T-0020',
  },
  {
    id: 'N16',
    tenant: TENANT_LOTE_A,
    filial: FILIAL_LOTE_A2,
    serie: 1,
    numero: 2,
    cenario: 'Filial em produção nunca alcança o simulador',
    entrada: 'Emissão pedida na A3 (produção) pela API de produção; em seguida a mesma emissão na A2',
    esperado:
      'A3: a API ou o worker bloqueia antes de reservar número e antes da rede; contador do simulador com 0 chamadas para o CNPJ da A3; A2: nº 2 autorizado',
    regras: ['RN-CORE-08', 'RN-FAT-04', 'CLAUDE-7'],
    cobertura: ['producao-bloqueada', 'autorizacao', 'numeracao'],
    destravadoPor: 'T-0021',
  },
  {
    id: 'N17',
    tenant: TENANT_LOTE_B,
    filial: FILIAL_LOTE_B1,
    serie: 1,
    numero: 1,
    cenario: 'Outro tenant: numeração própria e RLS',
    entrada: 'Emissão no tenant B; leitura da nota e do XML pelo tenant A (lista, id e chave de acesso)',
    esperado: 'B sai com o nº 1; A não vê a nota nem o XML de B (lista vazia, 404 pelo id, nada pela chave)',
    regras: ['CLAUDE-5', 'RN-CORE-02', 'RN-FAT-01'],
    cobertura: ['rls-multitenant', 'numeracao', 'autorizacao'],
    destravadoPor: 'T-0019',
  },
  {
    id: 'N18',
    tenant: TENANT_LOTE_B,
    filial: FILIAL_LOTE_B1,
    serie: 1,
    numero: 2,
    cenario: 'Licença do módulo faturamento',
    entrada: 'Tenant B sem a licença do faturamento pede emissão; o operador liga a licença; nova emissão',
    esperado: 'Sem licença: 403 MODULO_INATIVO, nada reservado nem enviado; com licença: nº 2 autorizado',
    regras: ['RN-CORE-02', 'CLAUDE-6'],
    cobertura: ['licenca', 'autorizacao', 'numeracao'],
    destravadoPor: 'T-0021',
  },
  {
    id: 'N19',
    ...a1(1, 15),
    cenario: 'Faturamento parcial do pedido com títulos a receber',
    entrada:
      'Pedido de 3 itens faturado em parte (2 itens), condição 30/60/90 com total que não divide por 3',
    esperado:
      'Autorizada; 3 títulos, rateio sem perder centavo (diferença na 1ª parcela); pedido faturado_parcial',
    regras: ['RN-FAT-06', 'RN-CORE-03', 'RN-PED-02'],
    cobertura: ['autorizacao', 'valor-regra', 'numeracao'],
    destravadoPor: 'T-0021',
  },
  {
    id: 'N20',
    ...a1(1, 16),
    cenario: 'Fechamento do lote: conferência final',
    entrada:
      'Última emissão; leitura de notas, inutilizações, último número reservado por série, XML guardados, contador do simulador e logs; UPDATE de deleted_at no XML guardado pelo papel macuxierp_app',
    esperado:
      '20 autorizadas e 20 XML guardados; séries sem buraco fora da 9-10, contando o último reservado; 0 chamadas para a A3 no simulador; deleted_at do XML não é marcado (o UPDATE falha); log sem A1, senha nem dado pessoal',
    regras: ['RN-FAT-01', 'RN-FAT-03', 'RN-CORE-07', 'CLAUDE-7', 'CLAUDE-8', 'CLAUDE-9'],
    cobertura: [
      'autorizacao',
      'numeracao',
      'inutilizacao',
      'xml-guardado-antes',
      'guarda-fiscal',
      'producao-bloqueada',
    ],
    destravadoPor: 'T-0045',
  },
];

/** A única inutilização do lote (N09). */
export const INUTILIZACOES: readonly FaixaInutilizada[] = [
  { tenant: TENANT_LOTE_A, filial: FILIAL_LOTE_A1, serie: 1, inicio: 9, fim: 10 },
];
