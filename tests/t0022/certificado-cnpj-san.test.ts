// T-0022, caso do corretor R-20261121-234218 (encaminhamento do RD-0294, docs/qualidade/redundancias/
// 2026-11-21-T-0045-simulador.md): A1 com o CNPJ só no SAN (otherName 2.16.76.1.3.3, ICP-Brasil DOC-ICP-04) e sem o
// `:CNPJ` no CN do titular. Leitores públicos do CNPJ do certificado:
// - core: `LeitorPfxTls` (`@macuxierp/core/api`), usado no upload do A1 (POST /v1/core/certificados, ADR 0005);
// - nfe-sefaz: `verificarAssinaturaNFe`, usado pelo simulador (292/213) e pelo worker.
// Com a T-0018 (RD-0294), o core e o nfe-sefaz leem o CNPJ no SAN e depois no CN, pelo `cnpjDoTitularIcp` do platform-sdk
// (o lado do nfe-sefaz é testado no pacote).
// Os A1 vêm do `gerarA1DeTeste` (`cnpjNoTitular`, RD-0444). Tudo na memória: nada vai a disco nem a log.
import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LeitorPfxTls } from '../../modules/core/api/index';
import { verificarAssinaturaNFe } from '../../packages/nfe-sefaz/src/index';
import { ErroCertificado } from '../../packages/platform-sdk/src/index';
import {
  CNPJ_EMITENTE_DE_TESTE,
  INSTANTE_DE_TESTE,
  VALIDADE_DE_TESTE,
  assinarXmlDeTeste,
  gerarA1DeTeste,
  montarNFeDeTeste,
} from '../../packages/nfe-sefaz/src/teste/index';

const BASE = { cnpj: CNPJ_EMITENTE_DE_TESTE, nome: 'EMPRESA SO SAN DE TESTE LTDA', ...VALIDADE_DE_TESTE };
const comCnpjNoCnESan = gerarA1DeTeste({ ...BASE, cnpjNoTitular: 'cn-e-san' });
const soNoSan = gerarA1DeTeste({ ...BASE, cnpjNoTitular: 'san' });

/** DER do certificado, a partir do PEM. */
const der = (a1: { certificadoPem: string }): Buffer => new X509Certificate(a1.certificadoPem).raw;

/**
 * Prova independente do leitor sob teste: o DER traz o `otherName` 2.16.76.1.3.3 (OID 06 05 60 4C 01 03 03) seguido
 * de `[0] OCTET STRING <cnpj>`.
 */
function sanTemCnpj(certificadoDer: Buffer, cnpj: string): boolean {
  const oidCnpjIcp = Buffer.from([0x06, 0x05, 0x60, 0x4c, 0x01, 0x03, 0x03]);
  const valor = Buffer.concat([Buffer.from([0x04, cnpj.length]), Buffer.from(cnpj, 'ascii')]);
  const otherName = Buffer.concat([oidCnpjIcp, Buffer.from([0xa0, valor.length]), valor]);
  return certificadoDer.includes(otherName);
}

function nfeAssinadaCom(a1: { chavePrivadaPem: string; certificadoPem: string }): string {
  const n = montarNFeDeTeste({ nNF: 1, dhEmi: new Date(INSTANTE_DE_TESTE.getTime() - 60_000) });
  return assinarXmlDeTeste(n.xml, { elemento: 'infNFe', a1 });
}
const verificar = (xml: string) => verificarAssinaturaNFe(xml, { cnpjEsperado: CNPJ_EMITENTE_DE_TESTE, agora: INSTANTE_DE_TESTE });

describe('T-0022: CNPJ do A1 no CN × só no SAN (RD-0294, caso do corretor)', () => {
  it('controle: o A1 montado no teste é válido; com o CNPJ no CN (e no SAN), o core e o verificador o aceitam', async () => {
    expect(sanTemCnpj(der(comCnpjNoCnESan), CNPJ_EMITENTE_DE_TESTE)).toBe(true);
    await expect(new LeitorPfxTls().abrir(comCnpjNoCnESan.pfx, comCnpjNoCnESan.senha)).resolves.toMatchObject({
      cnpj: CNPJ_EMITENTE_DE_TESTE,
      titular: BASE.nome,
    });
    expect(verificar(nfeAssinadaCom(comCnpjNoCnESan))).toMatchObject({ ok: true, certificado: { cnpj: CNPJ_EMITENTE_DE_TESTE } });
  });

  it('controle: o A1 do caso tem o CNPJ no SAN e não tem no titular', () => {
    const derSoNoSan = der(soNoSan);
    expect(sanTemCnpj(derSoNoSan, CNPJ_EMITENTE_DE_TESTE)).toBe(true);
    expect(derSoNoSan.includes(Buffer.from(`:${CNPJ_EMITENTE_DE_TESTE}`, 'ascii'))).toBe(false);
  });

  it("core: LeitorPfxTls recusa o A1 sem CNPJ em lugar nenhum com ErroCertificado 'cnpj_ausente' (o 292 do verificador fica no pacote)", async () => {
    const semCnpj = gerarA1DeTeste({ ...VALIDADE_DE_TESTE, semCnpj: true });
    const recusa = new LeitorPfxTls().abrir(semCnpj.pfx, semCnpj.senha);
    await expect(recusa).rejects.toBeInstanceOf(ErroCertificado);
    await expect(recusa).rejects.toMatchObject({ codigo: 'cnpj_ausente' });
  });

  // DOC-ICP-04; RD-0294: o core lê o CNPJ do SAN.
  it('core: LeitorPfxTls aceita o A1 com o CNPJ só no SAN e devolve o CNPJ', async () => {
    await expect(new LeitorPfxTls().abrir(soNoSan.pfx, soNoSan.senha)).resolves.toMatchObject({ cnpj: CNPJ_EMITENTE_DE_TESTE });
  });
});
