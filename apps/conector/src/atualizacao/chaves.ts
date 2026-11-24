/**
 * Chaves PÚBLICAS embutidas que verificam a assinatura dos pacotes do Conector (T-0116 do FDV). Só chave pública (SPKI em PEM),
 * por id (`PacoteConector.chave_publica_id`); a chave privada fica offline e NUNCA entra no repositório.
 *
 * Macuxi ERP (ADR 0014 §6 item 3): a lista é VAZIA. A atualização automática fica desligada, a troca de versão é manual e a chave
 * de produção do FDV (`macuxi-2026`) NÃO vem na cópia. Com a lista vazia, qualquer pacote é recusado (`chave_desconhecida`): a
 * atualização falha FECHADA. Ligar a atualização pede ADR nova, com a chave do ERP (nunca a do FDV).
 *
 * Tipos aceitos quando houver chave: Ed25519 e RSA de 3072 bits ou mais com SHA-256 PKCS#1 v1.5.
 */
export const CHAVES_PUBLICAS_PACOTE: Readonly<Record<string, string>> = Object.freeze({});
