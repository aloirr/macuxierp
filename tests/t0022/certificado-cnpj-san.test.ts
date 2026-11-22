// T-0022, caso do corretor R-20261121-234218 (encaminhamento do RD-0294, docs/qualidade/redundancias/
// 2026-11-21-T-0045-simulador.md): A1 com o CNPJ só no SAN (otherName 2.16.76.1.3.3, ICP-Brasil DOC-ICP-04) e sem o
// `:CNPJ` no CN do titular. Leitores públicos do CNPJ do certificado:
// - core: `LeitorPfxTls` (`@macuxierp/core/api`), usado no upload do A1 (POST /v1/core/certificados, ADR 0005);
// - nfe-sefaz: `verificarAssinaturaNFe` (`cnpjDoCertificado`), usado pelo simulador (292/213) e pelo worker.
// Os dois só leem o CN. O desenho T-0045 e a ADR 0008 não dizem o que fazer com o CNPJ só no SAN; a proposta do
// corretor (RD-0294) é "procura no SAN e cai no CN". Por isso os dois casos ficam em `it.fails`, com o esperado no
// comentário: quando a função única do RD-0294 entrar, eles passam a falhar aqui e viram `it`.
// Tudo na memória: os A1 são gerados na hora e nada vai a disco nem a log.
import { describe, expect, it } from 'vitest';
import { LeitorPfxTls, PfxInvalido } from '../../modules/core/api/index';
import { verificarAssinaturaNFe } from '../../packages/nfe-sefaz/src/index';
import {
  CNPJ_EMITENTE_DE_TESTE,
  INSTANTE_DE_TESTE,
  VALIDADE_DE_TESTE,
  assinarXmlDeTeste,
  gerarA1DeTeste,
  montarNFeDeTeste,
} from '../../packages/nfe-sefaz/src/teste/index';
import { gerarA1ComCnpjNoSan, sanTemCnpj } from './apoio/certificado-san';

const BASE = { cnpj: CNPJ_EMITENTE_DE_TESTE, nome: 'EMPRESA SO SAN DE TESTE LTDA', ...VALIDADE_DE_TESTE };
const comCnpjNoCnESan = gerarA1ComCnpjNoSan({ ...BASE, cnpjNoCn: true });
const soNoSan = gerarA1ComCnpjNoSan({ ...BASE, cnpjNoCn: false });

function nfeAssinadaCom(a1: { chavePrivadaPem: string; certificadoPem: string }): string {
  const n = montarNFeDeTeste({ nNF: 1, dhEmi: new Date(INSTANTE_DE_TESTE.getTime() - 60_000) });
  return assinarXmlDeTeste(n.xml, { elemento: 'infNFe', a1 });
}
const verificar = (xml: string) => verificarAssinaturaNFe(xml, { cnpjEsperado: CNPJ_EMITENTE_DE_TESTE, agora: INSTANTE_DE_TESTE });

describe('T-0022: CNPJ do A1 no CN × só no SAN (RD-0294, caso do corretor)', () => {
  it('controle: o A1 montado no teste é válido; com o CNPJ no CN (e no SAN), o core e o verificador o aceitam', async () => {
    expect(sanTemCnpj(comCnpjNoCnESan.certificadoDer, CNPJ_EMITENTE_DE_TESTE)).toBe(true);
    await expect(new LeitorPfxTls().abrir(comCnpjNoCnESan.pfx, comCnpjNoCnESan.senha)).resolves.toMatchObject({
      cnpj: CNPJ_EMITENTE_DE_TESTE,
      titular: BASE.nome,
    });
    expect(verificar(nfeAssinadaCom(comCnpjNoCnESan))).toMatchObject({ ok: true, certificado: { cnpj: CNPJ_EMITENTE_DE_TESTE } });
  });

  it('controle: o A1 do caso tem o CNPJ no SAN e não tem no titular', () => {
    expect(sanTemCnpj(soNoSan.certificadoDer, CNPJ_EMITENTE_DE_TESTE)).toBe(true);
    expect(soNoSan.certificadoDer.includes(Buffer.from(`:${CNPJ_EMITENTE_DE_TESTE}`, 'ascii'))).toBe(false);
  });

  it('core: A1 sem CNPJ em lugar nenhum é recusado no upload com PfxInvalido (o 292 do verificador fica no pacote)', async () => {
    const semCnpj = gerarA1DeTeste({ ...VALIDADE_DE_TESTE, semCnpj: true });
    await expect(new LeitorPfxTls().abrir(semCnpj.pfx, semCnpj.senha)).rejects.toBeInstanceOf(PfxInvalido);
  });

  // Comportamento de HOJE com o CNPJ só no SAN: prende o motivo dos `it.fails` abaixo (falham por isto, não por outra
  // coisa). Cada `it` sai quando o `it.fails` correspondente virar `it`, pela correção do RD-0294: ler o CNPJ do SAN
  // (2.16.76.1.3.3) e depois do CN, recusando se os dois existirem e forem diferentes.
  it('hoje, core: o A1 com o CNPJ só no SAN é recusado com "Certificado sem CNPJ no titular"', async () => {
    await expect(new LeitorPfxTls().abrir(soNoSan.pfx, soNoSan.senha)).rejects.toThrow('Certificado sem CNPJ no titular');
  });

  it('hoje, nfe-sefaz: a NF-e assinada com o A1 com o CNPJ só no SAN dá certificado_sem_cnpj (292)', () => {
    expect(verificar(nfeAssinadaCom(soNoSan))).toEqual({ ok: false, falha: 'certificado_sem_cnpj', cStat: '292' });
  });

  // ESPERADO (ICP-Brasil, DOC-ICP-04; RD-0294): o upload do core lê o CNPJ do SAN e aceita o A1. Decisão pendente:
  // engenheiro-software (função única do RD-0294) e modulo-core.
  it.fails('core: LeitorPfxTls aceita o A1 com o CNPJ só no SAN e devolve o CNPJ', async () => {
    await expect(new LeitorPfxTls().abrir(soNoSan.pfx, soNoSan.senha)).resolves.toMatchObject({ cnpj: CNPJ_EMITENTE_DE_TESTE });
  });

  // ESPERADO: a NF-e assinada com esse A1 passa na verificação, com o CNPJ do SAN (no simulador: 100, não 292).
  it.fails('nfe-sefaz: verificarAssinaturaNFe aceita a assinatura e lê o CNPJ do SAN', () => {
    expect(verificar(nfeAssinadaCom(soNoSan))).toMatchObject({ ok: true, certificado: { cnpj: CNPJ_EMITENTE_DE_TESTE } });
  });
});
