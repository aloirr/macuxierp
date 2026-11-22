/**
 * XML da NF-e 4.00 (`<NFe><infNFe>` sem assinatura). Determinístico: mesma entrada, mesmos bytes (sem relógio nem
 * sorteio aqui; `cNF` e a chave vêm prontos). A assinatura com o A1 é da porta `AssinadorA1`.
 * Os grupos IBS/CBS/IS são estrutura mínima: DUBLÊ até a T-0020 (NT 2025.002-RTC), a ajustar ao leiaute vigente.
 */
import type { Ambiente, TipoEmissao } from '../contracts';
import { chaveValida, CUF_AM, instanteManaus, MODELO_NFE } from './chave';
import { xNomeDestinatario, type NotaItemMontado, type NotaMontada } from './nota';
import { ErroViolacao, violacao, type Violacao } from './violacao';

export const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
export const VERSAO_LEIAUTE = '4.00';

/** Alias dos domínios fechados que o contracts ainda não expõe (CRT do emitente, indIEDest do destinatário). */
export type Crt = 1 | 2 | 3;
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
  pagamentos: { tPag: string; valor_centavos: number }[];
  infCpl?: string | null;
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
/** CNPJ alfanumérico (NT 2025.001): mantém letras e dígitos, sem máscara; letras em maiúsculas. */
const soCnpj = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();

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

const CSOSN_SEM_CREDITO = new Set(['102', '103', '300', '400']);
const CST_SUPORTADOS = new Set(['00', '40', '41', '50']);

/** Erros que a SEFAZ rejeitaria; até a T-0020 trazer o cálculo completo, o XML não é gerado nestes casos. */
function violacoesItem(i: NotaItemMontado): Violacao[] {
  const v: Violacao[] = [];
  const c = i.calculo;
  const campo = (f: string): string => `itens.${i.sequencia}.${f}`;
  const icms = c.icms;
  if (icms.csosn) {
    if (icms.csosn === '101') {
      if (!(icms.pcredsn_pct && icms.pcredsn_pct > 0) || icms.vcredicmssn_centavos === undefined) {
        v.push(violacao('RF-FAT-01', campo('icms'), 'CSOSN 101 exige pCredSN e vCredICMSSN.'));
      }
    } else if (!CSOSN_SEM_CREDITO.has(icms.csosn)) {
      v.push(violacao('RF-FAT-01', campo('icms'), `CSOSN ${icms.csosn} sem suporte (só 101, 102, 103, 300 e 400 até a T-0020).`));
    }
  } else if (!icms.cst) {
    v.push(violacao('RF-FAT-01', campo('icms'), 'ICMS sem CST nem CSOSN.'));
  } else if (!CST_SUPORTADOS.has(icms.cst)) {
    v.push(violacao('RF-FAT-01', campo('icms'), `CST ${icms.cst} sem suporte (só 00, 40, 41 e 50 até a T-0020).`));
  }
  if (c.ipi_centavos > 0 && !c.ipi) v.push(violacao('RF-FAT-01', campo('ipi'), 'IPI maior que zero sem o grupo IPI do item.'));
  for (const [nome, valor, g] of [['pis', c.pis_centavos, c.pis], ['cofins', c.cofins_centavos, c.cofins]] as const) {
    if (valor > 0 && !(g && g.vbc_centavos > 0 && g.aliquota_pct > 0)) {
      v.push(violacao('RF-FAT-01', campo(nome), `${nome.toUpperCase()} com valor e base ou alíquota zeradas.`));
    }
  }
  return v;
}

function icmsXml(c: NotaItemMontado['calculo']['icms']): string {
  if (c.csosn === '101') {
    return g('ICMS', g('ICMSSN101', t('orig', c.orig), t('CSOSN', '101'), t('pCredSN', (c.pcredsn_pct ?? 0).toFixed(4)), t('vCredICMSSN', dinheiroXml(c.vcredicmssn_centavos ?? 0))));
  }
  if (c.csosn) return g('ICMS', g('ICMSSN102', t('orig', c.orig), t('CSOSN', c.csosn)));
  const cst = c.cst as string;
  if (cst === '00') {
    return g('ICMS', g('ICMS00', t('orig', c.orig), t('CST', '00'), t('modBC', 3), t('vBC', dinheiroXml(c.vbc_centavos)), t('pICMS', c.aliquota_pct.toFixed(4)), t('vICMS', dinheiroXml(c.valor_centavos))));
  }
  return g('ICMS', g(`ICMS${cst === '40' || cst === '41' || cst === '50' ? '40' : cst}`, t('orig', c.orig), t('CST', cst)));
}

function ipiXml(c: NotaItemMontado['calculo']): string | null {
  if (!c.ipi) return null;
  return g('IPI', t('cEnq', c.ipi.cenq), g('IPITrib', t('CST', c.ipi.cst), t('vBC', dinheiroXml(c.ipi.vbc_centavos)), t('pIPI', c.ipi.aliquota_pct.toFixed(4)), t('vIPI', dinheiroXml(c.ipi_centavos))));
}

/** PIS e COFINS: com base e alíquota, `Aliq` (CST 01/02) ou `Outr`; sem valor, `Outr` 99 zerado. */
function pisCofinsXml(nome: 'PIS' | 'COFINS', valor: number, grupo: { cst: string; vbc_centavos: number; aliquota_pct: number } | undefined): string {
  const cst = grupo?.cst ?? '99';
  const tag = `${nome}${cst === '01' || cst === '02' ? 'Aliq' : 'Outr'}`;
  return g(nome, g(tag, t('CST', cst), t('vBC', dinheiroXml(grupo?.vbc_centavos ?? 0)), t(`p${nome}`, (grupo?.aliquota_pct ?? 0).toFixed(4)), t(`v${nome}`, dinheiroXml(valor))));
}

function detXml(i: NotaItemMontado): string {
  const c = i.calculo;
  const ean = i.gtin ?? 'SEM GTIN';
  const prod = g(
    'prod',
    t('cProd', i.codigo),
    t('cEAN', ean),
    t('xProd', i.descricao),
    t('NCM', so(i.ncm)),
    t('CFOP', c.cfop),
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
  const ibs = c.ibs_cbs
    ? g(
        'IBSCBS', // DUBLÊ até T-0020
        t('CST', c.ibs_cbs.cst),
        t('cClassTrib', c.ibs_cbs.cclasstrib),
        g('gIBSCBS', t('vBC', dinheiroXml(c.ibs_cbs.vbc_centavos)), g('gIBSUF', t('vIBSUF', dinheiroXml(c.ibs_cbs.ibs_centavos))), g('gCBS', t('vCBS', dinheiroXml(c.ibs_cbs.cbs_centavos)))),
      )
    : null;
  const is = c.imposto_seletivo
    ? g('IS', t('CSTIS', c.imposto_seletivo.cst), t('cClassTribIS', c.imposto_seletivo.cclasstrib), t('vBCIS', dinheiroXml(c.imposto_seletivo.vbc_centavos)), t('vIS', dinheiroXml(c.imposto_seletivo.valor_centavos))) // DUBLÊ até T-0020
    : null;
  const imposto = g(
    'imposto',
    icmsXml(c.icms),
    ipiXml(c),
    pisCofinsXml('PIS', c.pis_centavos, c.pis),
    pisCofinsXml('COFINS', c.cofins_centavos, c.cofins),
    is,
    ibs,
  );
  return `<det nItem="${i.sequencia}">${prod}${imposto}</det>`;
}

/**
 * Gera o XML ou lança `ErroViolacao` quando a SEFAZ o rejeitaria (chave inválida, ICMS/IPI/PIS/COFINS incompletos,
 * soma dos vPag diferente do vNF).
 */
export function gerarXmlNFe(d: DadosXml): string {
  const tot = d.nota.totais;
  const v: Violacao[] = d.nota.itens.flatMap(violacoesItem);
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
      t('vFCP', '0.00'),
      t('vBCST', '0.00'),
      t('vST', dinheiroXml(tot.vST)),
      t('vFCPST', '0.00'),
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
    tot.vIS > 0 ? g('ISTot', t('vIS', dinheiroXml(tot.vIS))) : null, // DUBLÊ até T-0020
    tot.vIBS > 0 || tot.vCBS > 0 ? g('IBSCBSTot', t('vIBS', dinheiroXml(tot.vIBS)), t('vCBS', dinheiroXml(tot.vCBS))) : null, // DUBLÊ até T-0020
  );
  const pag = g(
    'pag',
    ...d.pagamentos.map((p) => g('detPag', t('tPag', p.tPag), t('vPag', dinheiroXml(p.valor_centavos)))),
  );
  const infAdic = d.infCpl ? g('infAdic', t('infCpl', d.infCpl)) : null;
  const inf = `<infNFe versao="${VERSAO_LEIAUTE}" Id="NFe${d.chave}">${ide}${emit}${dest}${d.nota.itens.map(detXml).join('')}${total}${g('transp', t('modFrete', d.modFrete ?? 9))}${pag}${infAdic ?? ''}</infNFe>`;
  return `<NFe xmlns="${NS_NFE}">${inf}</NFe>`;
}
