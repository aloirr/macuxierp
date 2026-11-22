/**
 * XML da NF-e 4.00 (`<NFe><infNFe>` sem assinatura). Determinístico: mesma entrada, mesmos bytes (sem relógio nem
 * sorteio aqui; `cNF` e a chave vêm prontos). A assinatura com o A1 é da porta `AssinadorA1`.
 * Lê o `ItemResultado` de `fiscal.calculo@1` (alíquotas em décimos de milésimo de ponto percentual). IBS/CBS/IS: ver `habilitarIbsCbs`.
 */
import { normalizarDocumento } from '@macuxierp/platform-sdk';
import type { Crt as CrtFiscal, IcmsItem, ItemResultado } from '@macuxierp/fiscal/contracts';
import type { Ambiente, TipoEmissao } from '../contracts';
import { chaveValida, CUF_AM, instanteManaus, MODELO_NFE } from './chave';
import { pisCofinsComValor, valoresFiscais, xNomeDestinatario, type NotaItemMontado, type NotaMontada } from './nota';
import { ErroViolacao, violacao, type Violacao } from './violacao';

const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
const VERSAO_LEIAUTE = '4.00';

/** CRT do emitente, do contrato do fiscal (1, 2, 3 e 4/MEI); indIEDest do destinatário (no retrato vem como texto). */
export type Crt = CrtFiscal;
export type IndIeDest = 1 | 2 | 9;

export interface EnderecoXml {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio_ibge: string;
  municipio_nome: string;
  uf: string;
  cep: string;
}

export interface DadosXml {
  chave: string;
  cnf: string;
  tpEmis: TipoEmissao;
  natOp: string;
  serie: number;
  numero: number;
  emitida_em: Date;
  verProc: string;
  emitente: { cnpj: string; nome: string; fantasia?: string | null; ie: string; crt: Crt; endereco: EnderecoXml };
  destinatario: { documento: string; nome: string; ind_ie_dest: IndIeDest; ie?: string | null; endereco: EnderecoXml };
  nota: NotaMontada;
  /** 0 emitente, 1 destinatário, 9 sem frete (padrão). */
  modFrete?: 0 | 1 | 2 | 3 | 4 | 9;
  /** 1 presencial, 2 internet, 3 teleatendimento, 9 outros. Padrão 9 (pedido de força de vendas). */
  indPres?: 1 | 2 | 3 | 4 | 5 | 9;
  /** Padrão: 0 em venda a contribuinte (ind_ie_dest 1), 1 nos demais casos. */
  indFinal?: 0 | 1;
  pagamentos: { tPag: string; xPag?: string; valor_centavos: number }[];
  infCpl?: string | null;
  /**
   * Só teste. O leiaute final de IBS/CBS/IS (NT 2025.002-RTC) vem do fiscal no lote 3 da T-0020: até lá, item com esses grupos
   * gera violação e nenhum XML sai. Nenhum serviço da api liga esta flag; ligar em produção exige trocar este código (T-0020).
   */
  habilitarIbsCbs?: boolean;
}

/** Escape de XML 1.0: 5 entidades; caracteres de controle proibidos são removidos. */
export function escaparXml(texto: string): string {
  return (
    texto
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  );
}

/** Local até o platform-sdk exportar (RD-0273 a RD-0276). Centavos → "0.00" (inteiros, sem float). */
export const dinheiroXml = (c: number): string => {
  const neg = c < 0 ? '-' : '';
  const abs = Math.abs(c);
  return `${neg}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};
/** Quantidade escala 4 → "0.0000". */
export const quantidadeXml = (q4: number): string => `${Math.trunc(q4 / 10_000)}.${String(q4 % 10_000).padStart(4, '0')}`;
/** Preço unitário em centavos → "0.0000" (vUnCom com 4 casas). */
const unitarioXml = (c: number): string => `${Math.trunc(c / 100)}.${String(c % 100).padStart(2, '0')}00`;

/** dhEmi no fuso de Manaus, `AAAA-MM-DDThh:mm:ss-04:00`. */
export function dhEmiManaus(instante: Date): string {
  const l = instanteManaus(instante).toISOString();
  return `${l.slice(0, 19)}-04:00`;
}

const t = (tag: string, valor: string | number): string => `<${tag}>${escaparXml(String(valor))}</${tag}>`;
const g = (tag: string, ...filhos: (string | false | null | undefined)[]): string => `<${tag}>${filhos.filter(Boolean).join('')}</${tag}>`;
/** IE, CPF, CEP e NCM: só dígitos. */
const so = (s: string): string => s.replace(/\D/g, '');
/** CNPJ alfanumérico (NT 2025.001): o `normalizarDocumento` do SDK tira só máscara e espaço (mantém as letras) e passa para maiúsculas. */
const soCnpj = normalizarDocumento;

function enderecoXml(tag: string, e: EnderecoXml): string {
  return g(
    tag,
    t('xLgr', e.logradouro),
    t('nro', e.numero),
    e.complemento ? t('xCpl', e.complemento) : null,
    t('xBairro', e.bairro),
    t('cMun', e.municipio_ibge),
    t('xMun', e.municipio_nome),
    t('UF', e.uf),
    t('CEP', so(e.cep)),
    t('cPais', '1058'),
    t('xPais', 'BRASIL'),
  );
}

/** Alíquota em décimos de milésimo de ponto percentual (180000 = 18,0000%) → "18.0000", em inteiros. */
const pctXml = (p4: number): string => `${Math.trunc(p4 / 10_000)}.${String(p4 % 10_000).padStart(4, '0')}`;

const CSOSN_SEM_CREDITO = new Set(['102', '103', '300', '400']);
const CST_SEM_TRIBUTO = new Set(['40', '41', '50']);
const CST_SUPORTADOS = new Set(['00', '10', '20', ...CST_SEM_TRIBUTO]);

const faltam = (o: object, campos: readonly string[]): string[] => campos.filter((c) => (o as Record<string, unknown>)[c] === undefined);

const CST_PIS_NT = /^0[4-9]$/;
/** PIS/COFINS: 01/02 → Aliq; 03 → Qtde (o contrato não traz quantidade e alíquota por unidade: violação); 04 a 09 → NT; 49 a 99 → Outr. */
function violacoesPisCofins(nome: string, rotulo: string, g: ItemResultado['pis'], campo: (f: string) => string): Violacao[] {
  if (!g?.cst) return (g?.v_valor ?? 0) > 0 ? [violacao('RF-FAT-01', campo(nome), `${rotulo} com valor exige cst (fiscal.calculo@1).`)] : [];
  const cst = g.cst;
  if (cst === '03') return [violacao('RF-FAT-01', campo(nome), `${rotulo} CST 03 (por quantidade) sem suporte: o cálculo não traz quantidade e alíquota por unidade (fiscal.calculo@1).`)];
  if (CST_PIS_NT.test(cst)) return (g.v_valor ?? 0) > 0 ? [violacao('RF-FAT-01', campo(nome), `${rotulo} CST ${cst} (não tributado) não leva valor.`)] : [];
  if (!pisCofinsComValor(cst)) return [violacao('RF-FAT-01', campo(nome), `${rotulo} CST ${cst} sem suporte (só 01, 02, 04 a 09 e 49 a 99).`)];
  const f = ['v_bc', 'p_aliq'].filter((c) => (g as Record<string, unknown>)[c] === undefined);
  return f.length > 0 && (g.v_valor ?? 0) > 0 ? [violacao('RF-FAT-01', campo(nome), `${rotulo} com valor exige ${f.join(', ')} (fiscal.calculo@1).`)] : [];
}

/** Erros que a SEFAZ rejeitaria ou que o contrato do cálculo não permite montar: o XML não é gerado (RF-FAT-01). */
function violacoesItem(i: NotaItemMontado, habilitarIbsCbs: boolean): Violacao[] {
  const v: Violacao[] = [];
  const r = i.calculo.resultado;
  const campo = (f: string): string => `itens.${i.sequencia}.${f}`;
  const exige = (grupo: string, o: object | undefined, campos: readonly string[], motivo: string): void => {
    const f = o ? faltam(o, campos) : [...campos];
    if (f.length > 0) v.push(violacao('RF-FAT-01', campo(grupo), `${motivo} exige ${f.join(', ')} (fiscal.calculo@1).`));
  };
  if (!/^\d{4}$/.test(i.calculo.cfop)) v.push(violacao('RF-FAT-01', campo('cfop'), 'CFOP ausente ou inválido.'));
  const icms = r.icms;
  const st = ['mod_bc_st', 'v_bc_st', 'p_icms_st', 'v_icms_st'] as const;
  if (icms.csosn) {
    if (icms.csosn === '101') exige('icms', icms, ['p_cred_sn', 'v_cred_icms_sn'], 'CSOSN 101');
    else if (icms.csosn === '201') exige('icms', icms, [...st, 'p_cred_sn', 'v_cred_icms_sn'], 'CSOSN 201');
    else if (icms.csosn === '202' || icms.csosn === '203') exige('icms', icms, st, `CSOSN ${icms.csosn}`);
    else if (!CSOSN_SEM_CREDITO.has(icms.csosn)) {
      v.push(violacao('RF-FAT-01', campo('icms'), `CSOSN ${icms.csosn} sem suporte (só 101, 102, 103, 201, 202, 203, 300 e 400; o 500 exige o ICMS retido anteriormente, que o contrato não traz).`));
    }
  } else if (!icms.cst) {
    v.push(violacao('RF-FAT-01', campo('icms'), 'ICMS sem CST nem CSOSN.'));
  } else if (!CST_SUPORTADOS.has(icms.cst)) {
    v.push(violacao('RF-FAT-01', campo('icms'), `CST ${icms.cst} sem suporte (só 00, 10, 20, 40, 41 e 50; 30, 51, 60, 70 e 90 pedem campos que o contrato não traz).`));
  } else if (icms.cst === '00') exige('icms', icms, ['v_bc', 'p_icms', 'v_icms'], 'CST 00');
  else if (icms.cst === '10') exige('icms', icms, ['v_bc', 'p_icms', 'v_icms', ...st], 'CST 10');
  else if (icms.cst === '20') exige('icms', icms, ['v_bc', 'p_icms', 'v_icms', 'p_red_bc'], 'CST 20');
  if ((icms.v_fcp ?? 0) > 0) exige('icms', icms, ['v_bc_fcp', 'p_fcp'], 'FCP');
  if ((icms.v_fcp_st ?? 0) > 0) exige('icms', icms, ['v_bc_fcp_st', 'p_fcp_st'], 'FCP-ST');
  const f = valoresFiscais(r);
  if (f.vIPI > 0) exige('ipi', r.ipi, ['cst', 'c_enq', 'v_bc', 'p_ipi'], 'IPI com valor');
  v.push(...violacoesPisCofins('pis', 'PIS', r.pis, campo));
  v.push(...violacoesPisCofins('cofins', 'COFINS', r.cofins, campo));
  if ((r.ibs || r.cbs || r.is) && !habilitarIbsCbs) {
    v.push(violacao('RF-FAT-01', campo('ibs_cbs'), 'IBS/CBS/IS aguardando leiaute NT 2025.002 (T-0020): a nota não é emitida com esses grupos.'));
  } else {
    if (r.ibs || r.cbs) exige('ibs_cbs', r.ibs ?? r.cbs, ['cst', 'c_class_trib', 'v_bc'], 'IBS/CBS');
    if (r.is) exige('is', r.is, ['cst_is', 'c_class_trib_is', 'v_bc_is', 'v_is'], 'IS');
  }
  return v;
}

const dinOpc = (n: number | undefined): string => dinheiroXml(n ?? 0);
const grupoFcp = (c: IcmsItem): (string | false)[] =>
  (c.v_fcp ?? 0) > 0 ? [t('vBCFCP', dinOpc(c.v_bc_fcp)), t('pFCP', pctXml(c.p_fcp ?? 0)), t('vFCP', dinOpc(c.v_fcp))] : [];
const grupoFcpSt = (c: IcmsItem): (string | false)[] =>
  (c.v_fcp_st ?? 0) > 0 ? [t('vBCFCPST', dinOpc(c.v_bc_fcp_st)), t('pFCPST', pctXml(c.p_fcp_st ?? 0)), t('vFCPST', dinOpc(c.v_fcp_st))] : [];
const grupoSt = (c: IcmsItem): (string | false)[] => [
  t('modBCST', c.mod_bc_st ?? 4),
  c.p_mva_st !== undefined && t('pMVAST', pctXml(c.p_mva_st)),
  c.p_red_bc_st !== undefined && t('pRedBCST', pctXml(c.p_red_bc_st)),
  t('vBCST', dinOpc(c.v_bc_st)),
  t('pICMSST', pctXml(c.p_icms_st ?? 0)),
  t('vICMSST', dinOpc(c.v_icms_st)),
];

function icmsXml(c: IcmsItem): string {
  const orig = t('orig', c.orig);
  if (c.csosn === '101') return g('ICMS', g('ICMSSN101', orig, t('CSOSN', '101'), t('pCredSN', pctXml(c.p_cred_sn ?? 0)), t('vCredICMSSN', dinOpc(c.v_cred_icms_sn))));
  if (c.csosn === '201') {
    return g('ICMS', g('ICMSSN201', orig, t('CSOSN', '201'), ...grupoSt(c), ...grupoFcpSt(c), t('pCredSN', pctXml(c.p_cred_sn ?? 0)), t('vCredICMSSN', dinOpc(c.v_cred_icms_sn))));
  }
  if (c.csosn === '202' || c.csosn === '203') return g('ICMS', g('ICMSSN202', orig, t('CSOSN', c.csosn), ...grupoSt(c), ...grupoFcpSt(c)));
  if (c.csosn) return g('ICMS', g('ICMSSN102', orig, t('CSOSN', c.csosn)));
  const cst = c.cst as string;
  const mod = t('modBC', c.mod_bc ?? 3);
  if (cst === '00') {
    return g('ICMS', g('ICMS00', orig, t('CST', '00'), mod, t('vBC', dinOpc(c.v_bc)), t('pICMS', pctXml(c.p_icms ?? 0)), t('vICMS', dinOpc(c.v_icms)), ...grupoFcp(c)));
  }
  if (cst === '10') {
    return g('ICMS', g('ICMS10', orig, t('CST', '10'), mod, t('vBC', dinOpc(c.v_bc)), t('pICMS', pctXml(c.p_icms ?? 0)), t('vICMS', dinOpc(c.v_icms)), ...grupoFcp(c), ...grupoSt(c), ...grupoFcpSt(c)));
  }
  if (cst === '20') {
    return g('ICMS', g('ICMS20', orig, t('CST', '20'), mod, t('pRedBC', pctXml(c.p_red_bc ?? 0)), t('vBC', dinOpc(c.v_bc)), t('pICMS', pctXml(c.p_icms ?? 0)), t('vICMS', dinOpc(c.v_icms)), ...grupoFcp(c)));
  }
  return g('ICMS', g('ICMS40', orig, t('CST', cst)));
}

function ipiXml(r: ItemResultado): string | null {
  const ipi = r.ipi;
  if (!ipi || !(ipi.v_ipi && ipi.v_ipi > 0)) return null;
  return g('IPI', t('cEnq', ipi.c_enq ?? ''), g('IPITrib', t('CST', ipi.cst ?? ''), t('vBC', dinOpc(ipi.v_bc)), t('pIPI', pctXml(ipi.p_ipi ?? 0)), t('vIPI', dinOpc(ipi.v_ipi))));
}

/** PIS e COFINS por CST (as violações de CST sem suporte já barraram antes): 01/02 Aliq; 04 a 09 NT com a CST informada; 49 a 99 Outr; sem grupo, Outr 99 zerado. */
function pisCofinsXml(nome: 'PIS' | 'COFINS', grupo: ItemResultado['pis']): string {
  const cst = grupo?.cst ?? '99';
  if (CST_PIS_NT.test(cst)) return g(nome, g(`${nome}NT`, t('CST', cst)));
  const tag = `${nome}${cst === '01' || cst === '02' ? 'Aliq' : 'Outr'}`;
  const dados = grupo?.cst ? grupo : undefined;
  return g(nome, g(tag, t('CST', cst), t('vBC', dinheiroXml(dados?.v_bc ?? 0)), t(`p${nome}`, pctXml(dados?.p_aliq ?? 0)), t(`v${nome}`, dinheiroXml(dados?.v_valor ?? 0))));
}

function detXml(i: NotaItemMontado, habilitarIbsCbs: boolean): string {
  const r = i.calculo.resultado;
  const ean = i.gtin ?? 'SEM GTIN';
  const prod = g(
    'prod',
    t('cProd', i.codigo),
    t('cEAN', ean),
    t('xProd', i.descricao),
    t('NCM', so(i.ncm)),
    t('CFOP', i.calculo.cfop),
    t('uCom', i.unidade),
    t('qCom', quantidadeXml(i.quantidade)),
    t('vUnCom', unitarioXml(i.preco_unitario_centavos)),
    t('vProd', dinheiroXml(i.valor_produto_centavos)),
    t('cEANTrib', ean),
    t('uTrib', i.unidade),
    t('qTrib', quantidadeXml(i.quantidade)),
    t('vUnTrib', unitarioXml(i.preco_unitario_centavos)),
    i.frete_centavos > 0 && t('vFrete', dinheiroXml(i.frete_centavos)),
    i.desconto_centavos > 0 && t('vDesc', dinheiroXml(i.desconto_centavos)),
    i.outras_centavos > 0 && t('vOutro', dinheiroXml(i.outras_centavos)),
    t('indTot', 1),
  );
  const ib = habilitarIbsCbs ? (r.ibs ?? r.cbs) : undefined;
  const ibs = ib
    ? g(
        'IBSCBS',
        t('CST', ib.cst ?? ''),
        t('cClassTrib', ib.c_class_trib ?? ''),
        g(
          'gIBSCBS',
          t('vBC', dinOpc(ib.v_bc)),
          g('gIBSUF', ib.p_ibs_uf !== undefined && t('pIBSUF', pctXml(ib.p_ibs_uf)), t('vIBSUF', dinOpc(r.ibs?.v_ibs_uf))),
          g('gIBSMun', r.ibs?.p_ibs_mun !== undefined && t('pIBSMun', pctXml(r.ibs.p_ibs_mun)), t('vIBSMun', dinOpc(r.ibs?.v_ibs_mun))),
          t('vIBS', dinheiroXml(valoresFiscais(r).vIBS)),
          g('gCBS', (r.cbs?.p_cbs ?? r.ibs?.p_cbs) !== undefined && t('pCBS', pctXml((r.cbs?.p_cbs ?? r.ibs?.p_cbs) as number)), t('vCBS', dinheiroXml(valoresFiscais(r).vCBS))),
        ),
      )
    : null;
  const is = habilitarIbsCbs && r.is
    ? g('IS', t('CSTIS', r.is.cst_is ?? ''), t('cClassTribIS', r.is.c_class_trib_is ?? ''), t('vBCIS', dinOpc(r.is.v_bc_is)), r.is.p_is !== undefined && t('pIS', pctXml(r.is.p_is)), t('vIS', dinOpc(r.is.v_is)))
    : null;
  const imposto = g('imposto', icmsXml(r.icms), ipiXml(r), pisCofinsXml('PIS', r.pis), pisCofinsXml('COFINS', r.cofins), is, ibs);
  return `<det nItem="${i.sequencia}">${prod}${imposto}</det>`;
}

/**
 * Gera o XML ou lança `ErroViolacao` quando a SEFAZ o rejeitaria (chave inválida, ICMS/IPI/PIS/COFINS incompletos,
 * soma dos vPag diferente do vNF).
 */
export function gerarXmlNFe(d: DadosXml): string {
  const tot = d.nota.totais;
  const v: Violacao[] = d.nota.itens.flatMap((i) => violacoesItem(i, d.habilitarIbsCbs === true));
  if (!chaveValida(d.chave)) v.push(violacao('RN-FAT-01', 'chave', 'Chave de acesso inválida (formato ou DV).'));
  const somaPag = d.pagamentos.reduce((a, p) => a + p.valor_centavos, 0);
  if (somaPag !== tot.vNF) v.push(violacao('RF-FAT-01', 'pagamentos', `Soma dos vPag (${somaPag}) difere do vNF (${tot.vNF}).`));
  if (v.length > 0) throw new ErroViolacao(v);
  const amb: Ambiente = d.nota.ambiente;
  const interna = d.emitente.endereco.uf === d.destinatario.endereco.uf;
  const doc = soCnpj(d.destinatario.documento);
  const cpf = so(d.destinatario.documento);
  const ide = g(
    'ide',
    t('cUF', CUF_AM),
    t('cNF', d.cnf),
    t('natOp', d.natOp),
    t('mod', MODELO_NFE),
    t('serie', d.serie),
    t('nNF', d.numero),
    t('dhEmi', dhEmiManaus(d.emitida_em)),
    t('tpNF', 1),
    t('idDest', interna ? 1 : 2),
    t('cMunFG', d.emitente.endereco.municipio_ibge),
    t('tpImp', 1),
    t('tpEmis', d.tpEmis),
    t('cDV', d.chave.slice(43)),
    t('tpAmb', amb === 'producao' ? 1 : 2),
    t('finNFe', 1),
    t('indFinal', d.indFinal ?? (d.destinatario.ind_ie_dest === 1 ? 0 : 1)),
    t('indPres', d.indPres ?? 9),
    t('procEmi', 0),
    t('verProc', d.verProc),
  );
  const emit = g(
    'emit',
    t('CNPJ', soCnpj(d.emitente.cnpj)),
    t('xNome', d.emitente.nome),
    d.emitente.fantasia ? t('xFant', d.emitente.fantasia) : null,
    enderecoXml('enderEmit', d.emitente.endereco),
    t('IE', so(d.emitente.ie)),
    t('CRT', d.emitente.crt),
  );
  const dest = g(
    'dest',
    doc.length === 14 ? t('CNPJ', doc) : t('CPF', cpf),
    t('xNome', xNomeDestinatario(amb, d.destinatario.nome)), // RN-FAT-04
    enderecoXml('enderDest', d.destinatario.endereco),
    t('indIEDest', d.destinatario.ind_ie_dest),
    d.destinatario.ind_ie_dest === 1 && d.destinatario.ie ? t('IE', so(d.destinatario.ie)) : null,
  );
  const total = g(
    'total',
    g(
      'ICMSTot',
      t('vBC', dinheiroXml(tot.vBC)),
      t('vICMS', dinheiroXml(tot.vICMS)),
      t('vICMSDeson', '0.00'),
      t('vFCP', dinheiroXml(tot.vFCP)),
      t('vBCST', dinheiroXml(tot.vBCST)),
      t('vST', dinheiroXml(tot.vST)),
      t('vFCPST', dinheiroXml(tot.vFCPST)),
      t('vFCPSTRet', '0.00'),
      t('vProd', dinheiroXml(tot.vProd)),
      t('vFrete', dinheiroXml(tot.vFrete)),
      t('vSeg', '0.00'),
      t('vDesc', dinheiroXml(tot.vDesc)),
      t('vII', '0.00'),
      t('vIPI', dinheiroXml(tot.vIPI)),
      t('vIPIDevol', '0.00'),
      t('vPIS', dinheiroXml(tot.vPIS)),
      t('vCOFINS', dinheiroXml(tot.vCOFINS)),
      t('vOutro', dinheiroXml(tot.vOutro)),
      t('vNF', dinheiroXml(tot.vNF)),
    ),
    tot.vIS > 0 ? g('ISTot', t('vIS', dinheiroXml(tot.vIS))) : null,
    tot.vIBS > 0 || tot.vCBS > 0 ? g('IBSCBSTot', t('vIBS', dinheiroXml(tot.vIBS)), t('vCBS', dinheiroXml(tot.vCBS))) : null,
  );
  const pag = g(
    'pag',
    ...d.pagamentos.map((p) => g('detPag', t('tPag', p.tPag), p.xPag && t('xPag', p.xPag), t('vPag', dinheiroXml(p.valor_centavos)))),
  );
  const infAdic = d.infCpl ? g('infAdic', t('infCpl', d.infCpl)) : null;
  const inf = `<infNFe versao="${VERSAO_LEIAUTE}" Id="NFe${d.chave}">${ide}${emit}${dest}${d.nota.itens.map((i) => detXml(i, d.habilitarIbsCbs === true)).join('')}${total}${g('transp', t('modFrete', d.modFrete ?? 9))}${pag}${infAdic ?? ''}</infNFe>`;
  return `<NFe xmlns="${NS_NFE}">${inf}</NFe>`;
}
