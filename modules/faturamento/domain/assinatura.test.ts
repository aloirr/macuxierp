import { describe, expect, it } from 'vitest';
import { digestValueDoXml } from './assinatura';

describe('XML assinado guardado (nfe_assinada)', () => {
  it('RN-FAT-03: o DigestValue vem da assinatura do XML guardado; sem assinatura devolve null', () => {
    const xml = '<NFe><infNFe/><Signature><SignedInfo><Reference URI="#NFex"><DigestValue>abc+/=</DigestValue></Reference></SignedInfo></Signature></NFe>';
    expect(digestValueDoXml(xml)).toBe('abc+/=');
    expect(digestValueDoXml('<NFe><infNFe/></NFe>')).toBeNull();
    expect(digestValueDoXml('<NFe><DigestValue>  </DigestValue></NFe>')).toBeNull();
  });
});
