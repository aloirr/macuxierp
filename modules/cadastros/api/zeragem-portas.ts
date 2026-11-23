/**
 * Porta do "em uso" do /config (RN-CAD-10; T-0058 v0.3.5a e zerar da v0.3.5b). Combinado com a outra sessão do cadastros:
 * o arquivo, o nome e a assinatura são estes. O adaptador de produção (consulta aos módulos pedido, faturamento e fiscal)
 * é da v0.3.5b; aqui só o contrato, que o "Substituir tudo" usa para informar quantos inativados continuam no histórico.
 *
 * `CadastroZeravel` e `MotivoUso` ainda NÃO existem em `domain/zeragem.ts` no main: ficam definidos aqui, de forma
 * mínima, até a outra sessão entregar o domain (aí este arquivo passa a reexportar de lá, sem mudar a assinatura).
 */
import type { CadastroCargaPortal, Transacao } from '@macuxierp/platform-sdk';

/** Os cadastros que o portal sabe carregar, substituir e zerar. */
export type CadastroZeravel = CadastroCargaPortal;

/** Por que um cadastro está em uso (texto fixo, sem dado pessoal): `pedido`, `nota`, `titulo`, `saldo`... */
export type MotivoUso = string;

export interface ConsultaUsoCadastros {
  /** Dos `ids` do cadastro, os que estão em uso por outro módulo; o `Map` traz só os que estão (id → motivo). */
  emUso(tx: Transacao, cadastro: CadastroZeravel, ids: readonly string[]): Promise<Map<string, MotivoUso>>;
}
