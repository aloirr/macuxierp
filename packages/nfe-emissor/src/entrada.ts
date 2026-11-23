/**
 * Entrada tipada do emissor (`NotaParaEmissao`), em Zod.
 *
 * O faturamento monta esta entrada (mapeando a nota calculada) e chama a porta `EmissorNFe` (adendo da ADR 0002,
 * bullet "quem monta", decidido pelo gerente em 22/11/2026, 00h42 Manaus; desenho T-0018 §8). Convenções:
 * - dinheiro em CENTAVOS inteiros (`Centavos`); a conversão para "12.34" é só na serialização (decimal.ts);
 * - quantidade com até 4 casas e valor unitário com até 10, em texto decimal (sem float);
 * - alíquota em % com até 4 casas, em texto ("18", "0.9", "1.65");
 * - `dhEmi` em UTC (ISO com Z) e o fuso da filial em minutos (Manaus = -240): o XML sai com o deslocamento.
 * Os nomes dos campos seguem as tags do leiaute 4.00 (MOC), para o mapeamento ser direto.
 */
import { CUF, SVC_DA_UF, TP_EMIS_CONTINGENCIA, TpEmis, type Uf } from '@macuxierp/nfe-sefaz';
import { cnpjValido, ieComDvValido } from '@macuxierp/platform-sdk';
import { z } from 'zod';
import { textoValidoXml } from './xml';

const Centavos = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Digitos = (n: number) => z.string().regex(new RegExp(`^\\d{${n}}$`), `${n} dígitos`);
/**
 * CNPJ como vai no XML (`TCnpj` do PL_010g: 12 posições [0-9A-Z] + 2 dígitos, sem máscara), numérico ou alfanumérico
 * (jul/2026), com o DV conferido pelo `cnpjValido` do platform-sdk (RN-CAD-01).
 */
export const CnpjXml = z.string().regex(/^[0-9A-Z]{12}\d{2}$/, '14 posições ([0-9A-Z]{12} + 2 dígitos)').refine(cnpjValido, 'RN-CAD-01: CNPJ com DV inválido');
export const Texto = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((s) => textoValidoXml(s) && s.trim() === s && !/\s{2,}/.test(s), 'texto com espaço extra ou caractere de controle');
const Quantidade = z.string().regex(/^\d{1,11}(\.\d{1,4})?$/, 'quantidade com até 4 casas');
const ValorUnitario = z.string().regex(/^\d{1,11}(\.\d{1,10})?$/, 'valor unitário com até 10 casas');
const Aliquota = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'alíquota em % com até 4 casas');
const Cst = Digitos(3);
const CClassTrib = Digitos(6);

const Endereco = z.object({
  xLgr: Texto(2, 60),
  nro: Texto(1, 60),
  xCpl: Texto(1, 60).optional(),
  xBairro: Texto(2, 60),
  cMun: Digitos(7),
  xMun: Texto(2, 60),
  UF: z.string().regex(/^[A-Z]{2}$/),
  CEP: Digitos(8),
  cPais: z.literal('1058').default('1058'),
  xPais: z.literal('BRASIL').default('BRASIL'),
  fone: z.string().regex(/^\d{6,14}$/).optional(),
});

const Ide = z.object({
  cUF: Digitos(2),
  natOp: Texto(1, 60),
  serie: z.number().int().min(0).max(889),
  nNF: z.number().int().min(1).max(999_999_999),
  /** Instante da emissão em UTC (ISO 8601 com Z). */
  dhEmi: z.string().datetime(),
  /** Deslocamento do fuso da filial em minutos (AM = -240). */
  fusoMinutos: z.number().int().min(-720).max(840),
  tpNF: z.union([z.literal(0), z.literal(1)]),
  idDest: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  cMunFG: Digitos(7),
  cMunFGIBS: Digitos(7).optional(),
  tpImp: z.union([z.literal(1), z.literal(2)]).default(1),
  /** 1 normal; contingência: 4 EPEC, 6 SVC-AN, 7 SVC-RS (ADR 0011). Vai no `ide` e na chave. */
  tpEmis: TpEmis.default(1),
  tpAmb: z.union([z.literal(1), z.literal(2)]),
  finNFe: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  indFinal: z.union([z.literal(0), z.literal(1)]),
  indPres: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(9)]),
  indIntermed: z.union([z.literal(0), z.literal(1)]).optional(),
  verProc: Texto(1, 20),
  /** cNF já sorteado (retomada com os mesmos bytes). Sem ele, o emissor sorteia. */
  cNF: Digitos(8).optional(),
  /**
   * Entrada em contingência (`dhCont`, B28), em UTC (ISO com Z, milissegundos aceitos e descartados no XML): o instante
   * em que o operador entrou (RN-FAT-05). Obrigatório com `tpEmis` ≠ 1 e proibido com 1; vai no XML com o deslocamento
   * da filial, depois do `verProc` (ADR 0011).
   */
  dhCont: z.string().datetime().optional(),
  /**
   * Justificativa da entrada em contingência (`xJust`, B29: 15 a 256 caracteres; ADR 0011). Mesma regra do
   * `dhCont`. Além do tamanho, o `Texto` recusa espaço nas pontas, espaço duplo e caractere de controle.
   */
  xJust: Texto(15, 256).optional(),
});

/** `cUF` → UF (para conferir a SVC da UF do emitente). */
const UF_DO_CUF: ReadonlyMap<string, Uf> = new Map(Object.entries(CUF).map(([uf, c]) => [String(c), uf as Uf]));

/**
 * Contingência no `ide` (ADR 0011): com `tpEmis` ≠ 1, `dhCont` e `xJust` obrigatórios; com 1, proibidos; `dhCont` não
 * pode ser depois da emissão; SVC só a da UF do emitente (`SVC_DA_UF`). O erro cita o campo e a regra.
 */
const IdeComContingencia = Ide.superRefine((ide, ctx) => {
  const contingencia = ide.tpEmis !== 1;
  for (const campo of ['dhCont', 'xJust'] as const) {
    if (contingencia && ide[campo] === undefined)
      ctx.addIssue({ code: 'custom', path: [campo], message: `RN-FAT-08: tpEmis ${ide.tpEmis} exige ${campo}` });
    if (!contingencia && ide[campo] !== undefined)
      ctx.addIssue({ code: 'custom', path: [campo], message: `${campo} só vai em nota de contingência (tpEmis ≠ 1)` });
  }
  if (ide.dhCont !== undefined && new Date(ide.dhCont).getTime() > new Date(ide.dhEmi).getTime())
    ctx.addIssue({ code: 'custom', path: ['dhCont'], message: 'entrada em contingência depois da emissão' });
  if (ide.tpEmis === TP_EMIS_CONTINGENCIA['svc-an'] || ide.tpEmis === TP_EMIS_CONTINGENCIA['svc-rs']) {
    const uf = UF_DO_CUF.get(ide.cUF);
    const svc = uf ? SVC_DA_UF[uf] : undefined;
    if (!svc || TP_EMIS_CONTINGENCIA[svc] !== ide.tpEmis)
      ctx.addIssue({ code: 'custom', path: ['tpEmis'], message: `tpEmis ${ide.tpEmis} não é a SVC da UF do emitente` });
  }
});

/** RN-CAD-02: DV da IE pela UF do endereço (`false` reprova; UF ainda sem regra no ERP, `null`, passa). */
const IE_COM_DV = { message: 'RN-CAD-02: IE com DV inválido para a UF', path: ['IE'] };

const Emitente = z
  .object({
    CNPJ: CnpjXml,
    xNome: Texto(2, 60),
    xFant: Texto(1, 60).optional(),
    enderEmit: Endereco,
    IE: z.string().regex(/^\d{2,14}$/),
    CRT: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  })
  .refine((e) => ieComDvValido(e.enderEmit.UF, e.IE) !== false, IE_COM_DV);

const Destinatario = z
  .object({
    CNPJ: CnpjXml.optional(),
    CPF: Digitos(11).optional(),
    xNome: Texto(2, 60),
    enderDest: Endereco,
    indIEDest: z.union([z.literal(1), z.literal(2), z.literal(9)]),
    IE: z.string().regex(/^\d{2,14}$/).optional(),
    email: z.string().email().max(60).optional(),
  })
  .refine((d) => (d.CNPJ ? 1 : 0) + (d.CPF ? 1 : 0) === 1, 'informe CNPJ ou CPF do destinatário')
  .refine((d) => d.indIEDest !== 1 || d.IE !== undefined, 'contribuinte (indIEDest 1) exige IE')
  .refine((d) => d.IE === undefined || ieComDvValido(d.enderDest.UF, d.IE) !== false, IE_COM_DV);

const Orig = z.number().int().min(0).max(8);
const Icms00 = z.object({ CST: z.literal('00'), orig: Orig, modBC: z.number().int().min(0).max(3), vBC: Centavos, pICMS: Aliquota, vICMS: Centavos });
const IcmsIsento = z.object({ CST: z.enum(['40', '41', '50']), orig: Orig });

/*
 * ICMS do Simples Nacional (CRT 1, 2 e 4): um grupo por CSOSN, como no XSD do PL_010g (leiauteNFe_v4.00.xsd, a partir
 * da linha 3911). Os sub-grupos opcionais do XSD (sequências `minOccurs="0"`) viram objetos opcionais: ou vêm
 * inteiros ou não vêm. O emissor só monta o que recebe: crédito do Simples (pCredSN), ST e a compatibilidade
 * CSOSN × CRT são calculados e barrados no modulo-fiscal (RN-FIS-02, T-0020); aqui não se repete a regra.
 */
/** Crédito do Simples (art. 23 da LC 123/2006): pCredSN e vCredICMSSN. */
const CreditoSn = { pCredSN: Aliquota, vCredICMSSN: Centavos };
/** FCP retido por ST (NT 2016.002): vBCFCPST, pFCPST e vFCPST. */
const FcpSt = z.object({ vBCFCPST: Centavos, pFCPST: Aliquota, vFCPST: Centavos });
/** ICMS-ST (modBCST … vICMSST e o FCP-ST opcional), igual no 201, 202/203 e 900. */
const IcmsSt = {
  modBCST: z.number().int().min(0).max(6),
  pMVAST: Aliquota.optional(),
  pRedBCST: Aliquota.optional(),
  vBCST: Centavos,
  pICMSST: Aliquota,
  vICMSST: Centavos,
  FCPST: FcpSt.optional(),
};
const IcmsSn101 = z.object({ CSOSN: z.literal('101'), orig: Orig, ...CreditoSn });
const IcmsSn102 = z.object({ CSOSN: z.enum(['102', '103', '300', '400']), orig: Orig });
const IcmsSn201 = z.object({ CSOSN: z.literal('201'), orig: Orig, ...IcmsSt, ...CreditoSn });
const IcmsSn202 = z.object({ CSOSN: z.enum(['202', '203']), orig: Orig, ...IcmsSt });
const IcmsSn500 = z.object({
  CSOSN: z.literal('500'),
  orig: Orig,
  /** ICMS-ST retido anteriormente (vBCSTRet, pST, vICMSSubstituto opcional, vICMSSTRet). */
  STRet: z.object({ vBCSTRet: Centavos, pST: Aliquota, vICMSSubstituto: Centavos.optional(), vICMSSTRet: Centavos }).optional(),
  /** FCP retido anteriormente por ST. */
  FCPSTRet: z.object({ vBCFCPSTRet: Centavos, pFCPSTRet: Aliquota, vFCPSTRet: Centavos }).optional(),
});
const IcmsSn900 = z.object({
  CSOSN: z.literal('900'),
  orig: Orig,
  /** ICMS próprio (opcional no 900): vai ao vBC e ao vICMS do total. */
  proprio: z.object({ modBC: z.number().int().min(0).max(3), vBC: Centavos, pRedBC: Aliquota.optional(), pICMS: Aliquota, vICMS: Centavos }).optional(),
  ST: z.object(IcmsSt).optional(),
  credito: z.object(CreditoSn).optional(),
});
const IcmsSn = z.discriminatedUnion('CSOSN', [IcmsSn101, IcmsSn102, IcmsSn201, IcmsSn202, IcmsSn500, IcmsSn900]);
/** Regime normal (CST) ou Simples (CSOSN): cada lado discriminado pelo próprio código, para o erro citar o campo. */
const Icms = z.union([z.discriminatedUnion('CST', [Icms00, IcmsIsento]), IcmsSn]);

/*
 * PIS e COFINS: os grupos `<T>Aliq` (CST 01/02), `<T>NT` (04 a 09) e `<T>Outr` (49 a 99, XSD a partir da linha 4718).
 * O `<T>Outr` exige a base no XSD (vBC + alíquota, ou qBCProd + vAliqProd) e aceita zero: é o caso do MEI e do
 * Simples (CST 49 ou 99 com valores zerados). Qual CST cabe em cada regime é do modulo-fiscal (T-0020).
 */
const CST_PIS_COFINS_OUTR = ['49', '50', '51', '52', '53', '54', '55', '56', '60', '61', '62', '63', '64', '65', '66', '67', '70', '71', '72', '73', '74', '75', '98', '99'] as const;
/** Valor por unidade (vAliqProd, TDec_1104v): reais com até 4 casas. */
const ValorPorUnidade = z.string().regex(/^\d{1,11}(\.\d{1,4})?$/, 'valor por unidade com até 4 casas');
const PisCofinsAliq = z.object({ CST: z.enum(['01', '02']), vBC: Centavos, aliquota: Aliquota, valor: Centavos });
const PisCofinsNT = z.object({ CST: z.enum(['04', '05', '06', '07', '08', '09']) });
const PisCofinsOutrPercentual = z.object({ CST: z.enum(CST_PIS_COFINS_OUTR), vBC: Centavos, aliquota: Aliquota, valor: Centavos });
const PisCofinsOutrQuantidade = z.object({ CST: z.enum(CST_PIS_COFINS_OUTR), qBCProd: Quantidade, vAliqProd: ValorPorUnidade, valor: Centavos });
const PisCofins = z.union([PisCofinsAliq, PisCofinsNT, PisCofinsOutrPercentual, PisCofinsOutrQuantidade]);

/** Imposto Seletivo (grupo UB01, NT 2025.002-RTC). */
const ImpostoSeletivo = z.object({
  CSTIS: Cst,
  cClassTribIS: CClassTrib,
  vBCIS: Centavos,
  pIS: Aliquota,
  vIS: Centavos,
});

/** IBS e CBS do item (grupo UB12 `IBSCBS`, tipo TTribNFe), só a tributação integral (`gIBSCBS`) no spike. */
const IbsCbs = z.object({
  CST: Cst,
  cClassTrib: CClassTrib,
  gIBSCBS: z
    .object({
      vBC: Centavos,
      pIBSUF: Aliquota,
      vIBSUF: Centavos,
      pIBSMun: Aliquota,
      vIBSMun: Centavos,
      pCBS: Aliquota,
      vCBS: Centavos,
    })
    .optional(),
});

const Item = z.object({
  cProd: Texto(1, 60),
  cEAN: z.union([z.literal('SEM GTIN'), z.string().regex(/^(\d{8}|\d{12,14})$/)]).default('SEM GTIN'),
  xProd: Texto(1, 120),
  NCM: Digitos(8),
  CEST: Digitos(7).optional(),
  CFOP: Digitos(4),
  uCom: Texto(1, 6),
  qCom: Quantidade,
  vUnCom: ValorUnitario,
  vProd: Centavos,
  vFrete: Centavos.optional(),
  vSeg: Centavos.optional(),
  vDesc: Centavos.optional(),
  vOutro: Centavos.optional(),
  indTot: z.union([z.literal(0), z.literal(1)]).default(1),
  infAdProd: Texto(1, 500).optional(),
  imposto: z.object({
    vTotTrib: Centavos.optional(),
    ICMS: Icms,
    PIS: PisCofins,
    COFINS: PisCofins,
    IS: ImpostoSeletivo.optional(),
    IBSCBS: IbsCbs.optional(),
  }),
});

const Pagamento = z.object({
  detPag: z
    .array(
      z.object({
        indPag: z.union([z.literal(0), z.literal(1)]).optional(),
        tPag: z.string().regex(/^\d{2}$/),
        /** Descrição do meio de pagamento; obrigatória com tPag 99 (outros), senão a SEFAZ rejeita. */
        xPag: Texto(2, 60).optional(),
        vPag: Centavos,
      })
      .refine((d) => d.tPag !== '99' || d.xPag !== undefined, { message: 'tPag 99 exige xPag', path: ['xPag'] }),
    )
    .min(1)
    .max(100),
  vTroco: Centavos.optional(),
});

export const NotaParaEmissao = z.object({
  ide: IdeComContingencia,
  emit: Emitente,
  dest: Destinatario.optional(),
  itens: z.array(Item).min(1).max(990),
  transp: z.object({ modFrete: z.number().int().min(0).max(9) }),
  pag: Pagamento,
  infAdic: z.object({ infCpl: Texto(1, 5000) }).optional(),
  infRespTec: z
    .object({ CNPJ: CnpjXml, xContato: Texto(2, 60), email: z.string().email().max(60), fone: z.string().regex(/^\d{6,14}$/) })
    .optional(),
});

/** Entrada já validada (com os padrões aplicados). */
export type NotaParaEmissao = z.output<typeof NotaParaEmissao>;
/** Entrada como o chamador escreve (campos com padrão são opcionais). */
export type NotaParaEmissaoEntrada = z.input<typeof NotaParaEmissao>;
export type ItemNota = z.output<typeof Item>;
export type IcmsSimples = z.output<typeof IcmsSn>;
export type IcmsStSimples = z.output<z.ZodObject<typeof IcmsSt>>;
