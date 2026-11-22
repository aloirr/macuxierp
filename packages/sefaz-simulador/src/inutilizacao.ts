/**
 * NFeInutilizacao4 do simulador: 102 homologada, ou a rejeição (215 schema, inclusive `<!DOCTYPE`, 252, 226, assinatura/certificado, 224,
 * 453, 454, 563 mesma faixa, 256 faixa que cruza outra inutilizada, 241 número já usado). Só no autorizador normal:
 * a SVC não tem o serviço (`ENDERECOS_SEFAZ`), então a chamada em contingência falha como transporte, sem retentar.
 */
import {
  FalhaTransporteSefaz,
  NS_NFE,
  dataHoraSefaz,
  filhoNfe,
  lerXml,
  semDeclaracaoXml,
  validarXsd,
  textoNfe,
  verificarAssinaturaXml,
  type RespostaInutilizacao,
} from '@macuxierp/nfe-sefaz';
import { anoSefaz, consumirRejeicao, novoNumero, retornoBase, tagsRetorno, type CStatSimulador, type Contexto } from './contexto';
import { tag } from './xml';

type Faixa = Pick<RespostaInutilizacao, 'ano' | 'CNPJ' | 'mod' | 'serie' | 'nNFIni' | 'nNFFin'>;
const SEM_FAIXA: Faixa = { ano: null, CNPJ: null, mod: null, serie: null, nNFIni: null, nNFFin: null };

function decidir(ctx: Contexto, xml: string, f: Faixa, agora: Date, inf: Element | null): CStatSimulador {
  if (textoNfe(inf, 'tpAmb') !== String(ctx.d.tpAmb)) return '252';
  if (textoNfe(inf, 'cUF') !== String(ctx.d.cUF)) return '226';
  const assinatura = verificarAssinaturaXml(xml, { elemento: 'infInut', cnpjEsperado: f.CNPJ ?? '', agora });
  if (!assinatura.ok) return assinatura.cStat as CStatSimulador;
  const { nNFIni: ini, nNFFin: fim, ano, CNPJ: cnpj, serie } = f as { [K in keyof Faixa]: NonNullable<Faixa[K]> };
  if (ini > fim) return '224';
  if (Number(ano) > Number(anoSefaz(agora))) return '453';
  if (Number(ano) < 6) return '454';
  const daSerie = ctx.estado.inutilizacoes.filter((i) => i.cnpj === cnpj && i.serie === serie);
  if (daSerie.some((i) => i.ano === ano && i.nNFIni === ini && i.nNFFin === fim)) return '563';
  if (daSerie.some((i) => ini <= i.nNFFin && fim >= i.nNFIni)) return '256';
  for (const n of ctx.estado.notas.values()) if (n.cnpj === cnpj && n.serie === serie && n.nNF >= ini && n.nNF <= fim) return '241';
  return '102';
}

export async function inutilizar(ctx: Contexto, inutilizacaoAssinada: string): Promise<RespostaInutilizacao> {
  if (ctx.d.modo !== 'normal') throw new FalhaTransporteSefaz('inutilizacao', false, 'a SVC nao oferece o servico de inutilizacao');
  const agora = ctx.agora();
  const dhRecbto = dataHoraSefaz(agora);
  const xml = semDeclaracaoXml(inutilizacaoAssinada);
  const raiz = lerXml(xml)?.documentElement ?? null;
  const inf = filhoNfe(raiz, 'infInut');
  const valido = raiz !== null && (await validarXsd(xml, 'inutNFe')).valido;

  let faixa = SEM_FAIXA;
  let cStat: CStatSimulador = '215';
  let nProt: string | null = null;
  if (valido) {
    faixa = {
      ano: textoNfe(inf, 'ano'),
      CNPJ: textoNfe(inf, 'CNPJ'),
      mod: '55',
      serie: Number(textoNfe(inf, 'serie')),
      nNFIni: Number(textoNfe(inf, 'nNFIni')),
      nNFFin: Number(textoNfe(inf, 'nNFFin')),
    };
    cStat = consumirRejeicao(ctx, 'inutilizar') ?? decidir(ctx, xml, faixa, agora, inf);
    if (cStat === '102') {
      nProt = novoNumero(ctx, 'nProt');
      ctx.estado.inutilizacoes.push({ cnpj: faixa.CNPJ!, serie: faixa.serie!, ano: faixa.ano!, nNFIni: faixa.nNFIni!, nNFFin: faixa.nNFFin!, nProt });
    }
  }
  const r = { ...retornoBase(ctx, cStat), cUF: ctx.d.cUF, dhRecbto, nProt, ...faixa };
  const xmlResposta =
    `<retInutNFe xmlns="${NS_NFE}" versao="4.00"><infInut${nProt ? ` Id="ID${nProt}"` : ''}>${tagsRetorno(r)}` +
    `${tag('cUF', r.cUF)}${tag('ano', r.ano)}${tag('CNPJ', r.CNPJ)}${tag('mod', r.mod)}` +
    `${tag('serie', r.serie)}${tag('nNFIni', r.nNFIni)}${tag('nNFFin', r.nNFFin)}${tag('dhRecbto', dhRecbto)}${tag('nProt', nProt)}</infInut></retInutNFe>`;
  return { ...r, xml: xmlResposta };
}
