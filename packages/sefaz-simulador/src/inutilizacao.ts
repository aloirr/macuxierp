/**
 * NFeInutilizacao4 do simulador: 102 homologada, ou a rejeição (215 schema, inclusive `<!DOCTYPE`, 252, 226, assinatura/certificado, 224,
 * 453, 454, 563 mesma faixa, 256 faixa que cruza outra inutilizada do mesmo ano, 241 número já usado). Só no autorizador normal:
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
import {
  anoSefaz,
  consumirRejeicao,
  novoNumero,
  retornoBase,
  tagsRetorno,
  type CStatSimulador,
  type Contexto,
} from './contexto';
import type { EstadoSimuladorRepo, FaixaSimulada } from './estado';
import { tag } from './xml';

type Faixa = Pick<RespostaInutilizacao, 'ano' | 'CNPJ' | 'mod' | 'serie' | 'nNFIni' | 'nNFFin'>;
const SEM_FAIXA: Faixa = { ano: null, CNPJ: null, mod: null, serie: null, nNFIni: null, nNFFin: null };

/** As conferências do próprio XML (sem estado): ambiente, UF, assinatura, faixa e ano. */
function conferirXml(
  ctx: Contexto,
  xml: string,
  f: Faixa,
  agora: Date,
  inf: Element | null,
): CStatSimulador | null {
  if (textoNfe(inf, 'tpAmb') !== String(ctx.d.tpAmb)) return '252';
  if (textoNfe(inf, 'cUF') !== String(ctx.d.cUF)) return '226';
  const assinatura = verificarAssinaturaXml(xml, { elemento: 'infInut', cnpjEsperado: f.CNPJ ?? '', agora });
  if (!assinatura.ok) return assinatura.cStat as CStatSimulador;
  if (f.nNFIni! > f.nNFFin!) return '224';
  if (Number(f.ano) > Number(anoSefaz(agora))) return '453';
  if (Number(f.ano) < 6) return '454';
  return null;
}

/**
 * As conferências contra o estado (563 mesma faixa, 256 faixa que cruza, 241 número usado) e a gravação, na MESMA
 * unidade de trabalho e com a faixa travada (no Postgres, `pg_advisory_xact_lock` antes de `faixa_sobreposta`): duas
 * inutilizações concorrentes que se cruzam nunca são as duas homologadas.
 */
async function decidirEGravar(
  ctx: Contexto,
  repo: EstadoSimuladorRepo,
  faixa: FaixaSimulada,
): Promise<{ cStat: CStatSimulador; nProt: string | null }> {
  await repo.travarFaixa(ctx.d, faixa);
  if (await repo.faixaRepetida(ctx.d, faixa)) return { cStat: '563', nProt: null };
  if (await repo.faixaSobreposta(ctx.d, faixa)) return { cStat: '256', nProt: null };
  if (await repo.numeroUsadoNaFaixa(ctx.d, faixa)) return { cStat: '241', nProt: null };
  const nProt = await novoNumero(ctx, repo, 'nProt');
  await repo.gravarInutilizacao(ctx.d, { ...faixa, nProt });
  return { cStat: '102', nProt };
}

export async function inutilizar(ctx: Contexto, inutilizacaoAssinada: string): Promise<RespostaInutilizacao> {
  if (ctx.d.modo !== 'normal')
    throw new FalhaTransporteSefaz('inutilizacao', false, 'a SVC nao oferece o servico de inutilizacao');
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
    const conferido = consumirRejeicao(ctx, 'inutilizar') ?? conferirXml(ctx, xml, faixa, agora, inf);
    if (conferido) cStat = conferido;
    else {
      const f: FaixaSimulada = {
        cnpj: faixa.CNPJ!,
        serie: faixa.serie!,
        ano: faixa.ano!,
        nNFIni: faixa.nNFIni!,
        nNFFin: faixa.nNFFin!,
      };
      ({ cStat, nProt } = await ctx.fonte((repo) => decidirEGravar(ctx, repo, f)));
    }
  }
  const r = { ...retornoBase(ctx, cStat), cUF: ctx.d.cUF, dhRecbto, nProt, ...faixa };
  const xmlResposta =
    `<retInutNFe xmlns="${NS_NFE}" versao="4.00"><infInut${nProt ? ` Id="ID${nProt}"` : ''}>${tagsRetorno(r)}` +
    `${tag('cUF', r.cUF)}${tag('ano', r.ano)}${tag('CNPJ', r.CNPJ)}${tag('mod', r.mod)}` +
    `${tag('serie', r.serie)}${tag('nNFIni', r.nNFIni)}${tag('nNFFin', r.nNFFin)}${tag('dhRecbto', dhRecbto)}${tag('nProt', nProt)}</infInut></retInutNFe>`;
  return { ...r, xml: xmlResposta };
}
