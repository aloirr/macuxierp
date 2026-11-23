/**
 * DANFE da NF-e 55 (RF-FAT-03; leiaute do MOC, Anexo II): modelo em blocos montado, como função pura, a partir do `nfeProc` autorizado
 * guardado (RN-FAT-03: a fonte é o XML, nada é recalculado). O desenho em PDF fica em `api/danfe-pdf.ts`.
 * Retrato, preto e branco. Ambiente 2 (homologação) leva a marca d'água "SEM VALOR FISCAL" e o aviso, obrigatórios; nota cancelada leva a tarja.
 * Valores em pt-BR; datas no fuso informado (padrão Manaus). Sem dado pessoal em log: só se lê e devolve o que está no XML.
 */
import { formatarDocumento, formatarReaisDecimal } from '@macuxierp/platform-sdk/formatar';
import { FUSO_MANAUS_MINUTOS } from './fuso';
import { achar, lerXml, textoDe, todos, type NoXml } from './xml-leve';

/** Corpo do conteúdo do DANFE (marca §3): 7 pt, o mínimo aceito; única fonte desse número (rodapé, legenda do quadro e tabela). */
export const FONTE_CONTEUDO_PT = 7;
/** Rodapé "Emitido pelo" + assinatura A mono preto (marca §4; números na constante). */
export const RODAPE_DANFE = { texto: 'Emitido pelo', fontePt: FONTE_CONTEUDO_PT, alturaAssinaturaPt: 24, larguraAssinaturaPt: 111.4, protecaoPt: 14.9, baseTextoPt: 8.3 } as const;
/** Marca d'água: Helvetica negrito 60 pt, 45°, no centro da folha, #D9D9D9 (0,85), por baixo do conteúdo. */
export const MARCA_DAGUA = { fontePt: 60, anguloGraus: 45, cinza: 0.85 } as const;
export const MM = 72 / 25.4;
/** Respiro do logo do emitente no quadro: 1,5 mm em cima e embaixo; caixa de até 1/3 da largura, começando 1,5 mm dentro da linha esquerda; mínimo de 150 dpi (marca §1). */
export const LOGO_RESPIRO_PT = 1.5 * MM;
export const LOGO_DPI_MINIMO = 150;

export interface CaixaLogo {
  x: number;
  y: number;
  largura: number;
  altura: number;
}
/**
 * Marca §1: posição e tamanho do logo do emitente dentro do quadro (origem no canto inferior esquerdo do quadro). Proporção preservada
 * ("caber inteiro" na caixa de 1/3 da largura por altura menos 2 x 1,5 mm), centrado na vertical, à esquerda da caixa. Nunca passa de
 * `LOGO_DPI_MINIMO`: logo pequeno sai menor, nunca ampliado, com o mesmo alinhamento de todo logo (1,5 mm do eixo, centrado na vertical).
 */
export function caixaDoLogo(quadro: { largura: number; altura: number }, imagem: { largura: number; altura: number }): CaixaLogo {
  const caixaL = quadro.largura / 3 - LOGO_RESPIRO_PT; // a caixa começa 1,5 mm para dentro da linha esquerda do quadro (manual)
  const caixaA = quadro.altura - 2 * LOGO_RESPIRO_PT;
  const escalaCaixa = Math.min(caixaL / imagem.largura, caixaA / imagem.altura);
  const escalaDpi = 72 / LOGO_DPI_MINIMO; // pt por pixel com 150 dpi
  const escala = Math.min(escalaCaixa, escalaDpi);
  const largura = imagem.largura * escala;
  const altura = imagem.altura * escala;
  return { x: LOGO_RESPIRO_PT, y: (quadro.altura - altura) / 2, largura, altura };
}
export const AVISO_HOMOLOGACAO = 'EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL';
export const MARCA_DAGUA_HOMOLOGACAO = 'SEM VALOR FISCAL';
export const TARJA_CANCELADA = 'CANCELADA';
/** RN-FAT-08 (MOC Anexo II): textos do DANFE impresso em contingência (tpEmis 4, 6 ou 7). Curtos, pt-BR; a marca valida o layout. */
export const TITULO_DANFE_CONTINGENCIA = 'DANFE EM CONTINGÊNCIA';
export const NOME_CONTINGENCIA: Readonly<Record<'4' | '6' | '7', string>> = { '4': 'EPEC', '6': 'SVC-AN', '7': 'SVC-RS' };
/** EPEC: o protocolo e a data do evento 110140 (não o da NF-e, que ainda não foi autorizada). */
export const textoEpecDanfe = (protocolo: string, dataHora: string): string => `Impresso em contingência — EPEC, protocolo nº ${protocolo} de ${dataHora}`;
export const textoSvcDanfe = (modalidade: string): string => `Impresso em contingência — ${modalidade}`;
export const textoEntradaContingenciaDanfe = (dhCont: string, xJust: string): string => `Entrada em contingência em ${dhCont}. Justificativa: ${xJust}`;

export class ErroDanfe extends Error {}

export interface LinhaProduto {
  codigo: string;
  descricao: string;
  ncm: string;
  cst: string;
  cfop: string;
  unidade: string;
  quantidade: string;
  valorUnitario: string;
  valorDesconto: string;
  valorTotal: string;
  baseIcms: string;
  valorIcms: string;
  valorIpi: string;
  aliquotaIcms: string;
  aliquotaIpi: string;
}
export interface Campo {
  rotulo: string;
  valor: string;
}
export interface ModeloDanfe {
  /** `null` = nota não cancelada; texto presente = cancelada. */
  tarjaCancelada: string | null;
  marcaDagua: string | null;
  /** `marcaDagua` e `avisoHomologacao` só existem em homologação (tpAmb 2). */
  avisoHomologacao: string | null;
  canhoto: { texto: string };
  cabecalho: {
    emitente: { nome: string; linhasEndereco: string[]; fone: string };
    /** Legenda do quadro DANFE em 2 linhas, no tamanho de conteúdo (7 pt): a marca não aceita legenda abaixo disso. */
    subtituloLinhas: [string, string];
    /** Código do tipo (tpNF) e as duas legendas fixas do quadro, na ordem 0, 1. */
    tipoOperacao: { codigo: string; legendas: [string, string] };
    numero: string;
    serie: string;
    chave: string;
    chaveFormatada: string;
    consultaTexto: string;
  };
  operacao: { naturezaOperacao: string; protocolo: string; ie: string; ieSubstituicao: string; cnpj: string };
  destinatario: { nome: string; documento: string; endereco: string; bairro: string; cep: string; municipio: string; uf: string; fone: string; ie: string; emissao: string; saida: string };
  duplicatas: { numero: string; vencimento: string; valor: string }[];
  imposto: Campo[];
  transportador: Campo[];
  /** Todas as linhas de produto; a paginação (por altura) é do renderizador do PDF. */
  itens: LinhaProduto[];
  dadosAdicionais: { informacoesComplementares: string; fisco: string };
  /** RN-FAT-08: só nas notas tpEmis 4, 6 e 7. `titulo` vai no topo de todas as folhas; `linhas` (modalidade e dhCont/xJust) abrem os dados adicionais. */
  contingencia: { tpEmis: 4 | 6 | 7; titulo: string; linhas: string[] } | null;
}

// ---------- formatação pt-BR ----------

/** Decimal do XML ("1234.5678") em pt-BR com `casas` casas, arredondando metade para cima, sem passar por ponto flutuante. */
export function formatarDecimalXml(valor: string, casas: number): string {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(valor.trim());
  if (!m || (m[2] === '' && !m[3])) return valor.trim() === '' ? '' : valor.trim();
  const frac = m[3] ?? '';
  let n = BigInt((m[2] || '0') + frac.slice(0, casas).padEnd(casas, '0'));
  if (frac.length > casas && frac.charCodeAt(casas) >= 53) n += 1n;
  const s = n.toString().padStart(casas + 1, '0');
  const inteiro = s.slice(0, s.length - casas).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const negativo = m[1] === '-' && n !== 0n ? '-' : '';
  return `${negativo}${inteiro}${casas ? `,${s.slice(s.length - casas)}` : ''}`;
}

/** Telefone (premissa do modulo-fiscal, a conferir no MOC 7.0 Anexo II): 10 dígitos "(DD) NNNN-NNNN", 11 dígitos "(DD) NNNNN-NNNN"; outro tamanho sai só com os dígitos. */
export function formatarFone(f: string): string {
  const d = f.replace(/\D/g, '');
  const m = /^(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m && (d.length === 10 || d.length === 11) ? `(${m[1]}) ${m[2]}-${m[3]}` : d;
}
export const formatarCep = (c: string): string => (/^\d{8}$/.test(c) ? `${c.slice(0, 5)}-${c.slice(5)}` : c);
export const formatarChave = (chave: string): string => chave.replace(/(\d{4})(?=\d)/g, '$1 ');

/** Instante com deslocamento ("2026-11-21T10:00:00-04:00") no fuso pedido: "21/11/2026 10:00:00". Texto sem data válida volta como veio. */
export function formatarDataHoraXml(iso: string, fusoMinutos: number, soData = false): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return iso;
  const d = new Date(t + fusoMinutos * 60_000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const data = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return soData ? data : `${data} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
const dataSimples = (s: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : s);

// ---------- montagem ----------

const FRETE: Record<string, string> = {
  '0': '0 - Contratação do frete por conta do remetente (CIF)',
  '1': '1 - Contratação do frete por conta do destinatário (FOB)',
  '2': '2 - Contratação do frete por conta de terceiros',
  '3': '3 - Transporte próprio por conta do remetente',
  '4': '4 - Transporte próprio por conta do destinatário',
  '9': '9 - Sem ocorrência de transporte',
};

const linhaProduto = (det: NoXml): LinhaProduto => {
  const icms = achar(det, 'imposto', 'ICMS')?.filhos[0];
  const ipi = achar(det, 'imposto', 'IPI', 'IPITrib');
  const orig = textoDe(icms, 'orig');
  const cst = textoDe(icms, 'CST') || textoDe(icms, 'CSOSN');
  const adicional = textoDe(det, 'infAdProd');
  const desc = textoDe(det, 'prod', 'xProd');
  return {
    codigo: textoDe(det, 'prod', 'cProd'),
    descricao: adicional ? `${desc} - ${adicional}` : desc,
    ncm: textoDe(det, 'prod', 'NCM'),
    cst: `${orig}${cst}`,
    cfop: textoDe(det, 'prod', 'CFOP'),
    unidade: textoDe(det, 'prod', 'uCom'),
    quantidade: formatarDecimalXml(textoDe(det, 'prod', 'qCom'), 4),
    valorUnitario: formatarDecimalXml(textoDe(det, 'prod', 'vUnCom'), 4),
    valorDesconto: formatarDecimalXml(textoDe(det, 'prod', 'vDesc') || '0', 2),
    valorTotal: formatarDecimalXml(textoDe(det, 'prod', 'vProd'), 2),
    baseIcms: formatarDecimalXml(textoDe(icms, 'vBC') || '0', 2),
    valorIcms: formatarDecimalXml(textoDe(icms, 'vICMS') || '0', 2),
    valorIpi: formatarDecimalXml(textoDe(ipi, 'vIPI') || '0', 2),
    aliquotaIcms: formatarDecimalXml(textoDe(icms, 'pICMS') || '0', 2),
    aliquotaIpi: formatarDecimalXml(textoDe(ipi, 'pIPI') || '0', 2),
  };
};

export interface EntradaDanfe {
  /** `nfeProc` autorizado guardado (`nfe_autorizada`). */
  nfeProc: string;
  /** Nota com o evento de cancelamento registrado: leva a tarja. */
  cancelada?: boolean;
  /** Deslocamento do fuso de exibição em minutos (padrão Manaus, −240). */
  fusoMinutos?: number;
  /**
   * RN-FAT-08: DANFE da EPEC ANTES da autorização da NF-e. `nfeProc` é então a `<NFe>` assinada (`nfe_assinada`, sem protNFe) e o protocolo impresso é o do evento
   * EPEC (`epec_protocolo`, `dhRegistro` = `epec_autorizada_em`, ISO UTC). Sem este campo o XML precisa ser o nfeProc autorizado.
   */
  epec?: { protocolo: string; dhRegistro: string };
}

/** RF-FAT-03: monta o DANFE do `nfeProc`. Lança `ErroDanfe` se o XML não for um `nfeProc` autorizado (sem `protNFe`/`infNFe`). */
const valorDuplicata = (v: string): string => (v === '' ? '' : formatarReaisDecimal(v, 2));

/** RN-FAT-08: aviso do DANFE em contingência. EPEC leva o protocolo do evento (quando o chamador o informa); SVC, a modalidade; dhCont e xJust vêm do ide da própria NF-e. */
function avisoContingencia(tpEmis: '4' | '6' | '7', ide: NoXml | undefined, epec: EntradaDanfe['epec'], fuso: number): NonNullable<ModeloDanfe['contingencia']> {
  const linhas: string[] = [];
  if (tpEmis === '4') linhas.push(epec ? textoEpecDanfe(epec.protocolo, formatarDataHoraXml(epec.dhRegistro, fuso)) : textoSvcDanfe(NOME_CONTINGENCIA['4']));
  else linhas.push(textoSvcDanfe(NOME_CONTINGENCIA[tpEmis]));
  const dhCont = textoDe(ide, 'dhCont');
  const xJust = textoDe(ide, 'xJust');
  if (dhCont && xJust) linhas.push(textoEntradaContingenciaDanfe(formatarDataHoraXml(dhCont, fuso), xJust));
  return { tpEmis: Number(tpEmis) as 4 | 6 | 7, titulo: TITULO_DANFE_CONTINGENCIA, linhas };
}

export function montarDanfe(entrada: EntradaDanfe): ModeloDanfe {
  const fuso = entrada.fusoMinutos ?? FUSO_MANAUS_MINUTOS;
  let proc: NoXml;
  try {
    proc = lerXml(entrada.nfeProc);
  } catch (e) {
    throw new ErroDanfe(`nfeProc ilegível: ${(e as Error).message}`);
  }
  const soEpec = entrada.epec !== undefined && proc.nome === 'NFe';
  const nfe = soEpec ? proc : achar(proc, 'NFe');
  const inf = achar(nfe, 'infNFe');
  const prot = achar(proc, 'protNFe', 'infProt');
  if (!soEpec && (proc.nome !== 'nfeProc' || !inf || !prot)) throw new ErroDanfe('o XML não é um nfeProc autorizado (faltam infNFe ou protNFe)');
  if (!inf) throw new ErroDanfe('o XML não tem infNFe');
  const ide = achar(inf, 'ide');
  const emit = achar(inf, 'emit');
  const dest = achar(inf, 'dest');
  const chave = (inf.atributos.Id ?? '').replace(/^NFe/, '') || textoDe(prot, 'chNFe');
  const ambiente = textoDe(ide, 'tpAmb') === '1' ? 'producao' : 'homologacao';
  const numero = textoDe(ide, 'nNF').padStart(9, '0').replace(/(\d{3})(?=\d)/g, '$1.');
  const serie = textoDe(ide, 'serie');
  const tpNF = textoDe(ide, 'tpNF');
  const protocolo = soEpec && entrada.epec
    ? `${entrada.epec.protocolo} - ${formatarDataHoraXml(entrada.epec.dhRegistro, fuso)}`
    : `${textoDe(prot, 'nProt')} - ${formatarDataHoraXml(textoDe(prot, 'dhRecbto'), fuso)}`;
  const tpEmis = textoDe(ide, 'tpEmis');
  const contingencia = tpEmis === '4' || tpEmis === '6' || tpEmis === '7' ? avisoContingencia(tpEmis, ide, entrada.epec, fuso) : null;
  const end = (n: NoXml | undefined) => [textoDe(n, 'xLgr'), textoDe(n, 'nro'), textoDe(n, 'xCpl')].filter(Boolean).join(', ');
  const ee = achar(emit, 'enderEmit');
  const ed = achar(dest, 'enderDest');
  const tot = achar(inf, 'total', 'ICMSTot');
  const m = (nome: string) => formatarDecimalXml(textoDe(tot, nome) || '0', 2); // sem "R$": o quadro do imposto é só número, como a tabela de itens (marca §3)

  const transp = achar(inf, 'transp');
  const tr = achar(transp, 'transporta');
  const vol = achar(transp, 'vol');
  const veic = achar(transp, 'veicTransp');
  const transportador: Campo[] = [
    { rotulo: 'Nome / razão social', valor: textoDe(tr, 'xNome') },
    { rotulo: 'Frete por conta', valor: FRETE[textoDe(transp, 'modFrete')] ?? textoDe(transp, 'modFrete') },
    { rotulo: 'Placa do veículo', valor: textoDe(veic, 'placa') },
    { rotulo: 'UF (veículo)', valor: textoDe(veic, 'UF') },
    { rotulo: 'CNPJ / CPF', valor: formatarDocumento(textoDe(tr, 'CNPJ') || textoDe(tr, 'CPF')) },
    { rotulo: 'Endereço', valor: textoDe(tr, 'xEnder') },
    { rotulo: 'Município', valor: textoDe(tr, 'xMun') },
    { rotulo: 'UF', valor: textoDe(tr, 'UF') },
    { rotulo: 'Inscrição estadual', valor: textoDe(tr, 'IE') },
    { rotulo: 'Quantidade', valor: textoDe(vol, 'qVol') },
    { rotulo: 'Espécie', valor: textoDe(vol, 'esp') },
    { rotulo: 'Marca', valor: textoDe(vol, 'marca') },
    { rotulo: 'Numeração', valor: textoDe(vol, 'nVol') },
    { rotulo: 'Peso bruto', valor: textoDe(vol, 'pesoB') ? formatarDecimalXml(textoDe(vol, 'pesoB'), 3) : '' },
    { rotulo: 'Peso líquido', valor: textoDe(vol, 'pesoL') ? formatarDecimalXml(textoDe(vol, 'pesoL'), 3) : '' },
  ];

  const emissao = formatarDataHoraXml(textoDe(ide, 'dhEmi'), fuso, true);
  const saidaTxt = textoDe(ide, 'dhSaiEnt');

  return {
    tarjaCancelada: entrada.cancelada === true ? TARJA_CANCELADA : null,
    marcaDagua: ambiente === 'homologacao' ? MARCA_DAGUA_HOMOLOGACAO : null,
    avisoHomologacao: ambiente === 'homologacao' ? AVISO_HOMOLOGACAO : null,
    canhoto: {
      texto: `RECEBEMOS DE ${textoDe(emit, 'xNome')} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA AO LADO`,
    },
    cabecalho: {
      emitente: {
        nome: textoDe(emit, 'xNome'),
        linhasEndereco: [
          end(ee),
          [textoDe(ee, 'xBairro'), formatarCep(textoDe(ee, 'CEP'))].filter(Boolean).join(' - '),
          [textoDe(ee, 'xMun'), textoDe(ee, 'UF')].filter(Boolean).join(' - '),
        ].filter(Boolean),
        fone: formatarFone(textoDe(ee, 'fone')),
      },
      subtituloLinhas: ['Documento Auxiliar da', 'Nota Fiscal Eletrônica'],
      tipoOperacao: { codigo: tpNF, legendas: ['0 - ENTRADA', '1 - SAÍDA'] },
      numero,
      serie,
      chave,
      chaveFormatada: formatarChave(chave),
      consultaTexto: 'Consulta de autenticidade no portal nacional da NF-e (www.nfe.fazenda.gov.br/portal) ou no site da SEFAZ autorizadora',
    },
    operacao: {
      naturezaOperacao: textoDe(ide, 'natOp'),
      protocolo,
      ie: textoDe(emit, 'IE'),
      ieSubstituicao: textoDe(emit, 'IEST'),
      cnpj: formatarDocumento(textoDe(emit, 'CNPJ') || textoDe(emit, 'CPF')),
    },
    destinatario: {
      nome: textoDe(dest, 'xNome'),
      documento: formatarDocumento(textoDe(dest, 'CNPJ') || textoDe(dest, 'CPF')),
      endereco: end(ed),
      bairro: textoDe(ed, 'xBairro'),
      cep: formatarCep(textoDe(ed, 'CEP')),
      municipio: textoDe(ed, 'xMun'),
      uf: textoDe(ed, 'UF'),
      fone: formatarFone(textoDe(ed, 'fone')),
      ie: textoDe(dest, 'IE'),
      emissao,
      saida: saidaTxt ? formatarDataHoraXml(saidaTxt, fuso, true) : '',
    },
    duplicatas: todos(achar(inf, 'cobr'), 'dup').map((d) => ({ numero: textoDe(d, 'nDup'), vencimento: dataSimples(textoDe(d, 'dVenc')), valor: valorDuplicata(textoDe(d, 'vDup')) })),
    imposto: [
      { rotulo: 'Base de cálculo do ICMS', valor: m('vBC') },
      { rotulo: 'Valor do ICMS', valor: m('vICMS') },
      { rotulo: 'Base de cálculo do ICMS ST', valor: m('vBCST') },
      { rotulo: 'Valor do ICMS ST', valor: m('vST') },
      { rotulo: 'Valor total dos produtos', valor: m('vProd') },
      { rotulo: 'Valor do frete', valor: m('vFrete') },
      { rotulo: 'Valor do seguro', valor: m('vSeg') },
      { rotulo: 'Desconto', valor: m('vDesc') },
      { rotulo: 'Outras despesas', valor: m('vOutro') },
      { rotulo: 'Valor do IPI', valor: m('vIPI') },
      { rotulo: 'Valor total da nota', valor: m('vNF') },
    ],
    transportador,
    itens: todos(inf, 'det').map(linhaProduto),
    dadosAdicionais: { informacoesComplementares: [...(contingencia?.linhas ?? []), textoDe(inf, 'infAdic', 'infCpl')].filter(Boolean).join(' '), fisco: textoDe(inf, 'infAdic', 'infAdFisco') },
    contingencia,
  };
}
