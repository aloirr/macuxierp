/**
 * XML assinado da NF-e (tipo `nfe_assinada` em `faturamento.nota_xml`, só INSERT, `versao` = max+1). A EMISSÃO monta, assina e grava
 * (nota em rascunho; no reenvio, ainda em rejeitada); o worker só lê a última versão e transmite. Retry, consulta por duplicidade e
 * guarda pendente reutilizam a mesma, de modo que o `DigestValue` que a SEFAZ viu é o do `nfeProc` autorizado (RN-FAT-03, RN-FAT-07).
 */

/** `DigestValue` da assinatura do documento (a SEFAZ o repete no `digVal` do protocolo). Nulo se não houver. */
export function digestValueDoXml(xmlAssinado: string): string | null {
  const m = /<DigestValue>([^<]*)<\/DigestValue>/.exec(xmlAssinado);
  const v = m?.[1]?.trim();
  return v ? v : null;
}
