/**
 * Entrada do `operador.sh a1-teste` (T-0080, ADR 0008), empacotada em `dist/a1-teste.mjs` pelo Dockerfile da API e
 * executada no contêiner `api` já de pé (`docker compose exec -T api node dist/a1-teste.mjs ...`): o papel
 * `macuxierp_app` (conferido aqui, como na partida da API) e a MACUXIERP_CHAVE_A1 do secret do servidor.
 *
 *   node dist/a1-teste.mjs --empresa <código> [--filial <id>] --operador <nome> [--substituir] [--confirmar]
 *
 * Última linha = estado: `estado: simulacao` | `estado: gerado` | `estado: sem-mudanca`.
 * Saída 0 = ok; 2 = uso; 1 = recusa ou falha (nada gravado: a transação é desfeita). Erros com mensagem fixa: nunca
 * valor do ambiente, CNPJ, senha, PFX ou texto do banco.
 */
import { lerChaveA1 } from '@macuxierp/core/api';
import { BancoPg, criarPool } from '@macuxierp/platform-sdk/pg';
import { ErroUsoA1Teste, executarA1Teste, lerArgsA1Teste, linhasA1Teste, RecusaA1Teste } from './a1-teste';

async function main(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  let args;
  try {
    args = lerArgsA1Teste(argv);
  } catch (e) {
    console.error(`[a1-teste] ${e instanceof ErroUsoA1Teste ? e.message : 'argumentos inválidos'}`);
    return 2;
  }
  let chaveA1: Buffer;
  try {
    chaveA1 = lerChaveA1(env.MACUXIERP_CHAVE_A1);
  } catch {
    console.error('[a1-teste] MACUXIERP_CHAVE_A1 ausente ou inválida (rode dentro do contêiner api)');
    return 1;
  }
  const pool = criarPool('macuxierp-operador-a1-teste', 1);
  try {
    const banco = new BancoPg(pool);
    await banco.conferirPapel('macuxierp_app');
    const r = await executarA1Teste({ banco, chaveA1, agora: () => new Date() }, args);
    for (const l of linhasA1Teste(r)) console.log(l);
    return 0;
  } catch (e) {
    if (e instanceof RecusaA1Teste) console.error(`[a1-teste] recusado: ${e.message}`);
    else {
      const codigo = typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : (e as Error).name;
      console.error(`[a1-teste] falhou (código ${codigo}); nada foi gravado (transação desfeita)`);
    }
    return 1;
  } finally {
    chaveA1.fill(0);
    await pool.end();
  }
}

process.exitCode = await main(process.argv.slice(2), process.env);
