/** Validação XSD PL_010g (xmllint-wasm): NF-e com IBS, CBS e IS, eventos, inutilização e mensagens sem valores. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { montarEnvEvento } from './proc';
import {
  INSTANTE_DE_TESTE,
  VALIDADE_DE_TESTE,
  assinarXmlDeTeste,
  gerarA1DeTeste,
  montarCancelamentoDeTeste,
  montarCartaCorrecaoDeTeste,
  montarInutilizacaoDeTeste,
  montarNFeDeTeste,
} from './teste';
import { ESQUEMAS_XSD, PACOTE_SCHEMAS, validarXsd } from './xsd';

const DH = INSTANTE_DE_TESTE;
const a1 = gerarA1DeTeste(VALIDADE_DE_TESTE);
const assinar = (xml: string, elemento: 'infNFe' | 'infEvento' | 'infInut') => assinarXmlDeTeste(xml, { elemento, a1 });
const lote = (evento: string) => montarEnvEvento('1', evento);

describe(`validarXsd (${PACOTE_SCHEMAS})`, () => {
  it('NF-e assinada com os grupos IBS/CBS (NT 2025.002-RTC) e com o IS passa', async () => {
    for (const comIS of [false, true]) {
      const xml = assinar(montarNFeDeTeste({ nNF: 1, dhEmi: DH, comIS }).xml, 'infNFe');
      expect(xml).toContain('<IBSCBS>');
      expect(await validarXsd(xml, 'nfe')).toEqual({ valido: true, erros: [] });
    }
  });

  it('cancelamento, CC-e e inutilização assinados passam', async () => {
    const { chave } = montarNFeDeTeste({ nNF: 1, dhEmi: DH });
    const canc = assinar(montarCancelamentoDeTeste({ chave, dhEvento: DH, nProt: '913260000000001' }), 'infEvento');
    const cce = assinar(montarCartaCorrecaoDeTeste({ chave, dhEvento: DH, nSeqEvento: 1 }), 'infEvento');
    expect((await validarXsd(lote(canc), 'envEventoCancNFe')).valido).toBe(true);
    expect((await validarXsd(lote(cce), 'envCCe')).valido).toBe(true);
    expect((await validarXsd(assinar(montarInutilizacaoDeTeste({ ano: '26', nNFIni: 1, nNFFin: 2 }), 'infInut'), 'inutNFe')).valido).toBe(true);
    // o evento de um tipo não passa no schema do outro
    expect((await validarXsd(lote(cce), 'envEventoCancNFe')).valido).toBe(false);
  });

  it('IBS/CBS fora do leiaute reprova (o grupo é conferido, não ignorado)', async () => {
    const xml = assinar(montarNFeDeTeste({ nNF: 1, dhEmi: DH }).xml.replace('<cClassTrib>000001</cClassTrib>', '<cClassTrib>1</cClassTrib>'), 'infNFe');
    const r = await validarXsd(xml, 'nfe');
    expect(r.valido).toBe(false);
    expect(r.erros.join(' ')).toContain('cClassTrib');
  });

  it('sem assinatura reprova; as mensagens não trazem valores do documento (LGPD)', async () => {
    const cpf = '12345678909';
    const nfe = montarNFeDeTeste({ nNF: 1, dhEmi: DH, docDestinatario: cpf }).xml;
    expect((await validarXsd(nfe, 'nfe')).erros.join(' ')).toContain('Signature');
    const ruim = await validarXsd(assinar(nfe.replace(`<CPF>${cpf}</CPF>`, '<CPF>1234567890X</CPF>'), 'infNFe'), 'nfe');
    expect(ruim.valido).toBe(false);
    expect(ruim.erros.join(' ')).not.toContain('1234567890X');
    expect(ruim.erros.join(' ')).toContain("'(omitido)'");
    const malFormado = await validarXsd(`<NFe><dest><xNome>Fulana de Tal`, 'nfe');
    expect(malFormado.valido).toBe(false);
    expect(malFormado.erros.join(' ')).not.toContain('Fulana');
  });

  it('DOCTYPE é recusado antes do libxml2 (sem DTD nem entidade externa), em qualquer caixa', async () => {
    const xml = assinar(montarNFeDeTeste({ nNF: 1, dhEmi: DH }).xml, 'infNFe');
    for (const dtd of ['<!DOCTYPE NFe [<!ENTITY x SYSTEM "file:///etc/passwd">]>', '<!doctype NFe>']) {
      expect(await validarXsd(`${dtd}${xml}`, 'nfe')).toEqual({ valido: false, erros: ['DOCTYPE não é aceito (a NF-e não usa DTD)'] });
    }
  });

  it('cada esquema exposto tem o arquivo no pacote; esquema desconhecido lança', async () => {
    const pasta = new URL('../schemas/PL_010g/', import.meta.url);
    for (const arquivo of Object.values(ESQUEMAS_XSD)) expect(readdirSync(pasta), arquivo).toContain(arquivo);
    expect(await validarXsd('<x/>', 'retEnvCCe')).toMatchObject({ valido: false });
    await expect(validarXsd('<x/>', 'nao-existe' as never)).rejects.toThrow(RangeError);
  });
});

describe('schemas/PL_010g/SHA256SUMS', () => {
  it('os hashes conferem com os arquivos (nenhum .xsd muda em silêncio)', () => {
    const pasta = new URL('../schemas/PL_010g/', import.meta.url);
    const linhas = readFileSync(new URL('SHA256SUMS', pasta), 'utf8').trim().split('\n');
    const tabela = Object.fromEntries(linhas.map((l) => /^([0-9a-f]{64}) {2}(\S+\.xsd)$/.exec(l)!).map((m) => [m[2], m[1]]));
    const arquivos = readdirSync(pasta).filter((n) => n.endsWith('.xsd')).sort();
    expect(Object.keys(tabela).sort()).toEqual(arquivos);
    for (const a of arquivos) expect(createHash('sha256').update(readFileSync(new URL(a, pasta))).digest('hex'), a).toBe(tabela[a]);
    expect(arquivos.some((a) => /\s/.test(a))).toBe(false);
  });
});
