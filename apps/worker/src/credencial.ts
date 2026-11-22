/**
 * Chave mestra das credenciais do conector do Hub (T-0009 §6; cifra do SDK, ADR 0005). Separada da do A1:
 * - `MACUXIERP_CHAVE_INTEGRACAO` (32 bytes, hex ou base64) é a **versão 1**. Rotação futura = nova variável e nova
 *   versão aqui; o módulo guarda a versão junto do cifrado.
 * Sem a configuração, devolve `null`. Variável presente mas inválida derruba a partida (o erro cita só o nome, nunca o
 * valor). A leitura é a `chaveIntegracaoDoAmbiente` do SDK, a mesma da API (T-0011).
 */
import { chaveIntegracaoDoAmbiente, decifrarCampo, ErroCifra, type ContextoAgenda } from '@macuxierp/platform-sdk';

export type DecifrarCredencial = ContextoAgenda['decifrarCredencial'];

/** Decifrador sobre as chaves por versão (fechadas aqui dentro; nunca saem nem vão a log). */
export function criarDecifradorCredencial(chaves: ReadonlyMap<number, Buffer>): DecifrarCredencial {
  const copia = new Map(chaves);
  return (cifrada, tenantId, versao) => {
    const chave = Number.isInteger(versao) ? copia.get(versao) : undefined;
    if (!chave) throw new ErroCifra('credencial do conector: versão de chave desconhecida');
    return decifrarCampo({ chave, tenantId, cifrado: cifrada }).toString('utf8');
  };
}

export function configurarCredenciais(env: Readonly<Record<string, string | undefined>>): DecifrarCredencial | null {
  const chave = chaveIntegracaoDoAmbiente(env);
  return chave ? criarDecifradorCredencial(new Map([[1, chave]])) : null;
}
