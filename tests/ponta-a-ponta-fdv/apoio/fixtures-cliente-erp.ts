/**
 * Fixtures do pré-cadastro de cliente FDV → ERP (F-10 do plano da v0.3.12; PF-1 da v0.3.13), na forma do
 * `modules/integracao/contracts/cliente-erp.ts` do FDV (v1.0.28 e v1.0.30, ADR 0069 do FDV).
 *
 * Premissa (testes-3, 24/11/2026): esta sessão não tem leitura do `aloirr/macuxifdv`; as fixtures foram transcritas do
 * desenho `docs/desenho/T-0059.md` §2 e §5.3 (que cita hub-api §6.6b e a ADR 0069 do FDV) e conferidas campo a campo com
 * o `ClienteParaErpFdv` do SDK. Na primeira sessão com leitura do FDV, trocar pelo conteúdo literal do `cliente-erp.ts`
 * (o FDV é só leitura: copiar, nunca alterar). Dados fictícios: CNPJ de exemplo, sem pessoa real.
 */

const UUID_A = '5a1f0c2e-8b7d-4c3a-9e21-0f6b7d8c9a01';
const UUID_B = '6b2e1d3f-9c8e-4d4b-8f32-1a7c8e9d0b12';

/** Pendente da v1.0.28: sem `codigo_fdv`, `revisao`, `hash` nem `tentativa`. */
export const PENDENTE_V1028 = Object.freeze({
  cliente_uuid: UUID_A,
  recebido_em: '2026-11-20T09:15:00-04:00',
  razao_social: 'Comercial Exemplo Ltda',
  nome_fantasia: 'Exemplo',
  documento: '11222333000181',
  inscricao_estadual: null,
  telefone: '9233334444',
  email: 'compras@exemplo.invalid',
  logradouro: 'Rua Exemplo',
  numero: '100',
  complemento: null,
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: '69005000',
  latitude: -3.1316,
  longitude: -60.0233,
  filial_external_id: null,
});

/** Pendente da v1.0.30 em diante (ADR 0069): com `codigo_fdv`, `revisao`, `hash` e `tentativa`. */
export const PENDENTE_V1030 = Object.freeze({
  ...PENDENTE_V1028,
  cliente_uuid: UUID_B,
  recebido_em: '2026-11-22T14:00:00Z',
  codigo_fdv: '00042',
  revisao: 1,
  hash: '3f'.repeat(32),
  tentativa: 1,
});

/** Mesmo pré-cadastro reenviado corrigido (revisão 2, hash novo, mesmo `cliente_uuid`). */
export const PENDENTE_V1030_REVISAO_2 = Object.freeze({ ...PENDENTE_V1030, documento: '11444777000161', revisao: 2, hash: 'a7'.repeat(32) });

/** Pendente antigo servido pela v1.0.30: entrou antes da ADR 0069, `hash` nulo. */
export const PENDENTE_V1030_HASH_NULO = Object.freeze({ ...PENDENTE_V1030, hash: null });

/** Respostas 200 do `POST /clientes/{uuid}/retorno`. */
export const ACEITO_V1028 = Object.freeze({ cliente_uuid: UUID_A, estado: 'vinculado', repetido: false });
export const ACEITO_V1030 = Object.freeze({ cliente_uuid: UUID_B, estado: 'vinculado', repetido: false, revisao: 1 });
export const ACEITO_REPETIDO = Object.freeze({ cliente_uuid: UUID_B, estado: 'rejeitado', repetido: true, revisao: 1 });
export const ACEITO_OBSOLETO = Object.freeze({ cliente_uuid: UUID_B, estado: 'pendente', repetido: false, revisao: 2, obsoleto: true });
