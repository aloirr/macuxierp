'use server';
import { pedirSenhaTemporaria } from '@/lib/esqueci-api';
import type { ResultadoEsqueci } from '@/lib/esqueci-resultado';

/** Ação do painel "Esqueci a senha": o navegador nunca chama a API direto (a prova do BFF e o IP vão daqui). */
export async function pedirEsqueciAction(dados: { email: string }): Promise<ResultadoEsqueci> {
  return pedirSenhaTemporaria({ email: String(dados.email ?? '') });
}
