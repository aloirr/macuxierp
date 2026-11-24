/**
 * Origem do certificado A1 (T-0080): 'upload' (A1 do cliente) ou 'teste' (A1 gerado para homologação com o simulador,
 * ADR 0008). Regra: homologação e produção separadas por tenant e filial emissora (CLAUDE.md regra 7, RN-CORE-08,
 * RN-FAT-04, ADR 0005); o A1 de teste nunca assina em produção. Espelha a trava da coluna core.certificado.origem (0047).
 */
import { describe, expect, it } from 'vitest';
import {
  AVISO_CERTIFICADO_DE_TESTE,
  ORIGENS_CERTIFICADO,
  ORIGEM_CERTIFICADO_PADRAO,
  OrigemCertificado,
  podeUsarCertificadoNoAmbiente,
} from './certificado-origem';

describe('OrigemCertificado (T-0080)', () => {
  it('aceita só upload e teste, nessa ordem', () => {
    expect(ORIGENS_CERTIFICADO).toEqual(['upload', 'teste']);
    expect(OrigemCertificado.options).toEqual(['upload', 'teste']);
    expect(OrigemCertificado.safeParse('upload').success).toBe(true);
    expect(OrigemCertificado.safeParse('teste').success).toBe(true);
    expect(OrigemCertificado.safeParse('producao').success).toBe(false);
    expect(OrigemCertificado.safeParse('').success).toBe(false);
  });

  it("o padrão é 'upload', como na coluna core.certificado.origem", () => {
    expect(ORIGEM_CERTIFICADO_PADRAO).toBe('upload');
    expect(OrigemCertificado.default(ORIGEM_CERTIFICADO_PADRAO).parse(undefined)).toBe('upload');
  });

  it('texto do aviso da tela é literal', () => {
    expect(AVISO_CERTIFICADO_DE_TESTE).toBe('Certificado de teste: só homologação');
  });
});

describe('podeUsarCertificadoNoAmbiente (CLAUDE.md regra 7, RN-CORE-08, ADR 0005/0008)', () => {
  it('A1 de teste em produção é recusado', () => {
    expect(podeUsarCertificadoNoAmbiente('teste', 'producao')).toBe(false);
  });

  it('A1 de teste em homologação é aceito', () => {
    expect(podeUsarCertificadoNoAmbiente('teste', 'homologacao')).toBe(true);
  });

  it('A1 do cliente (upload) vale nos dois ambientes', () => {
    expect(podeUsarCertificadoNoAmbiente('upload', 'homologacao')).toBe(true);
    expect(podeUsarCertificadoNoAmbiente('upload', 'producao')).toBe(true);
  });
});
