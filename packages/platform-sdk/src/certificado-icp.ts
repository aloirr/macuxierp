/**
 * Titular do certificado ICP-Brasil (RD-0294): a função única que diz de quem é o A1. Usada pelo verificador XMLDSig
 * (`@macuxierp/nfe-sefaz`), pelo emissor (`@macuxierp/nfe-emissor`, `abrirA1`) e, por recado, pelo leitor do A1 do core.
 *
 * Regras de `cnpjDoTitularIcp`:
 *  1. o CNPJ vem do SAN, no `otherName` 2.16.76.1.3.3 (DOC-ICP-04: onde a AC grava o CNPJ da pessoa jurídica);
 *  2. o CN no formato `NOME:CNPJ` é a reserva;
 *  3. SAN e CN com CNPJs diferentes = recusa (`cnpj_divergente`).
 * Nos dois lugares o DV é conferido por `cnpjValido` (RN-CAD-01, aceita o CNPJ alfanumérico); DV errado = `dv_invalido`,
 * sem cair para a outra fonte. Nada de CNPJ = `cnpj_ausente`. Nunca devolve null: lança `ErroCertificado`.
 *
 * Só Node (`node:crypto`): sai pelo índice do servidor, como o `cifra.ts`, e não entra nos subcaminhos "sem Node" do web.
 * O `X509Certificate` do Node mostra o `otherName` como `<unsupported>`; o SAN é lido aqui, do DER, com um leitor
 * mínimo de TLV (sem dependência). Erro com mensagem fixa: nunca leva o PFX, a senha, o certificado nem o CNPJ.
 */
import { createHash, type X509Certificate } from 'node:crypto';
import { cnpjValido, normalizarDocumento } from './documentos';

/** OID ICP-Brasil do CNPJ da pessoa jurídica titular, no `otherName` do SAN (DOC-ICP-04). */
export const OID_CNPJ_ICP_BRASIL = '2.16.76.1.3.3';
const OID_SAN = '2.5.29.17';

export type CodigoErroCertificado = 'cnpj_divergente' | 'cnpj_ausente' | 'dv_invalido';

const MENSAGEM: Readonly<Record<CodigoErroCertificado, string>> = Object.freeze({
  cnpj_divergente: 'Certificado recusado: o CNPJ do SAN difere do CNPJ do CN',
  cnpj_ausente: 'Certificado recusado: sem CNPJ do titular no SAN nem no CN',
  dv_invalido: 'Certificado recusado: CNPJ do titular com DV inválido',
});

/** Certificado recusado pela leitura do titular. A mensagem é fixa por código. */
export class ErroCertificado extends Error {
  override readonly name = 'ErroCertificado';
  constructor(readonly codigo: CodigoErroCertificado) {
    super(MENSAGEM[codigo]);
  }
}

export interface CnpjDoTitular {
  /** CNPJ sem máscara, em maiúsculas, com o DV conferido. */
  readonly cnpj: string;
  readonly origem: 'san' | 'cn';
}

// ---------------------------------------------------------------------------------------------------------------
// Leitor mínimo de DER (X.690): só o necessário para chegar ao SAN. Qualquer coisa fora do esperado lança RangeError,
// que vira "SAN ausente" (o `X509Certificate` já validou o certificado; o SAN estranho não derruba a leitura do CN).

interface Tlv {
  readonly classe: number;
  readonly construido: boolean;
  readonly tag: number;
  readonly inicio: number;
  readonly fim: number;
}

function lerTlv(b: Buffer, pos: number, limite: number): Tlv {
  if (pos + 2 > limite) throw new RangeError('DER curto');
  const t = b[pos]!;
  if ((t & 0x1f) === 0x1f) throw new RangeError('DER: tag longa');
  let i = pos + 1;
  let tam = b[i++]!;
  if (tam & 0x80) {
    const n = tam & 0x7f;
    if (n === 0 || n > 4 || i + n > limite) throw new RangeError('DER: tamanho');
    tam = 0;
    for (let k = 0; k < n; k++) tam = tam * 256 + b[i++]!;
  }
  if (i + tam > limite) throw new RangeError('DER: passa do limite');
  return { classe: t >> 6, construido: (t & 0x20) !== 0, tag: t & 0x1f, inicio: i, fim: i + tam };
}

function filhos(b: Buffer, pai: Pick<Tlv, 'inicio' | 'fim'>): Tlv[] {
  const lista: Tlv[] = [];
  for (let pos = pai.inicio; pos < pai.fim; ) {
    const t = lerTlv(b, pos, pai.fim);
    lista.push(t);
    pos = t.fim;
  }
  return lista;
}

function oid(b: Buffer, t: Tlv): string {
  if (t.classe !== 0 || t.tag !== 6 || t.fim <= t.inicio) return '';
  const arcos: number[] = [];
  let v = 0;
  for (let i = t.inicio; i < t.fim; i++) {
    v = v * 128 + (b[i]! & 0x7f);
    if (!(b[i]! & 0x80)) {
      arcos.push(v);
      v = 0;
    }
  }
  const [primeiro = 0, ...resto] = arcos;
  const x = primeiro < 80 ? Math.floor(primeiro / 40) : 2;
  return [x, primeiro - 40 * x, ...resto].join('.');
}

const ehContexto = (t: Tlv, tag: number) => t.classe === 2 && t.tag === tag;

/** O valor do `otherName` 2.16.76.1.3.3 (texto bruto) ou `undefined` se o SAN não o traz. */
function valorNoSan(der: Buffer): string | undefined {
  try {
    const [tbs] = filhos(der, lerTlv(der, 0, der.length));
    const extensoes = filhos(der, tbs!).find((t) => ehContexto(t, 3) && t.construido);
    if (!extensoes) return undefined;
    for (const ext of filhos(der, filhos(der, extensoes)[0]!)) {
      const partes = filhos(der, ext);
      if (oid(der, partes[0]!) !== OID_SAN) continue;
      const nomes = lerTlv(der, partes[partes.length - 1]!.inicio, partes[partes.length - 1]!.fim);
      for (const nome of filhos(der, nomes)) {
        // otherName ::= [0] IMPLICIT SEQUENCE { type-id OID, value [0] EXPLICIT ANY }
        if (!ehContexto(nome, 0) || !nome.construido) continue;
        const [tipo, valor] = filhos(der, nome);
        if (!tipo || !valor || oid(der, tipo) !== OID_CNPJ_ICP_BRASIL) continue;
        let atual = valor;
        while (atual.construido) atual = filhos(der, atual)[0] ?? { ...atual, construido: false, fim: atual.inicio };
        return der.subarray(atual.inicio, atual.fim).toString('latin1');
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** O que vem depois do último `:` do CN, quando tem 14 posições no formato do CNPJ; senão `undefined`. */
function valorNoCn(sujeito: string): string | undefined {
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(sujeito)?.[1] ?? '';
  return /:([0-9A-Za-z]{12}\d{2})\s*$/.exec(cn)?.[1];
}

function conferido(valor: string | undefined): string | undefined {
  if (valor === undefined) return undefined;
  const c = normalizarDocumento(valor);
  if (!cnpjValido(c)) throw new ErroCertificado('dv_invalido');
  return c;
}

/** CNPJ do titular do certificado ICP-Brasil (regras no topo do arquivo). Lança `ErroCertificado`. */
export function cnpjDoTitularIcp(cert: X509Certificate): CnpjDoTitular {
  const san = conferido(valorNoSan(cert.raw));
  const cn = conferido(valorNoCn(cert.subject));
  if (san && cn && san !== cn) throw new ErroCertificado('cnpj_divergente');
  if (san) return { cnpj: san, origem: 'san' };
  if (cn) return { cnpj: cn, origem: 'cn' };
  throw new ErroCertificado('cnpj_ausente');
}

/** SHA-256 do certificado (DER), em hex minúsculo e sem `:`: a impressão digital que o core grava. */
export function impressaoDigitalSha256(cert: X509Certificate): string {
  return createHash('sha256').update(cert.raw).digest('hex');
}
