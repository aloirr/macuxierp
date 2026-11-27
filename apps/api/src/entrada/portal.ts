/**
 * Portal `/config` da `/entrada/v1` (T-0057 E3, ADR 0014 §4): ler, criar ou trocar e revogar a credencial do conector,
 * pelas `cadastros.portal_entrada_*` da 0071 (papel `macuxierp_config`; as funções conferem o superadmin, a empresa e a
 * licença e gravam a auditoria só com o `conector_id`).
 * - A chave (32 bytes aleatórios em base64url) nasce aqui e aparece só na resposta da criação; o banco recebe só o
 *   HMAC-SHA256(pepper, chave) e o prefixo. Sem `Idempotency-Key`: a resposta guardada levaria a chave.
 * - Sem o pepper no servidor, criar ou trocar responde 503 (`INDISPONIVEL`); ler e revogar seguem.
 */
import { randomBytes } from 'node:crypto';
import {
  CAMINHOS_ENTRADA_PLATAFORMA as C,
  CredencialEntradaCriada,
  CredencialEntradaRevogada,
  CriarCredencialEntrada,
  definirPluginPlataforma,
  definirRotaPlataforma,
  erros,
  PortalEntradaLeitura,
  prefixoChaveEntrada,
  RevogarCredencialEntrada,
  uuidDaRota,
  type PluginPlataforma,
} from '@macuxierp/platform-sdk';
import { hmacChaveEntrada } from './autenticacao';

/** `23514` da `portal_entrada_credencial_definir` com o conector_id preso a outra empresa. */
const conectorEmUso = (e: unknown) => (e as { code?: unknown }).code === '23514' && (e as { detail?: unknown }).detail === 'conector_em_uso';

interface LinhaLeitura {
  credenciais: { conector_id: string; prefixo: string; criada_em: string; revogada_em: string | null }[];
  ultimo_sinal: unknown;
  lotes: unknown[];
}

export function criarPluginPlataformaEntrada(d: { pepper: Buffer | null }): PluginPlataforma {
  return definirPluginPlataforma([
    definirRotaPlataforma({
      metodo: 'GET',
      caminho: C.ler,
      acao: 'plataforma.cadastros.entrada',
      async executar(c, { params }) {
        const [linha] = await c.tx.consultar<{ r: LinhaLeitura }>('SELECT cadastros.portal_entrada_ler($1::uuid) AS r', [uuidDaRota(params)]);
        const r = linha!.r;
        // campo a campo: o que a função devolver a mais (o ultimo_uso_em da 0071, RD-2319) não sai na resposta
        return {
          corpo: PortalEntradaLeitura.parse({
            credenciais: r.credenciais.map((x) => ({ conector_id: x.conector_id, prefixo: x.prefixo, criada_em: x.criada_em, revogada_em: x.revogada_em })),
            ultimo_sinal: r.ultimo_sinal,
            lotes: r.lotes,
          }),
        };
      },
    }),
    definirRotaPlataforma({
      metodo: 'POST',
      caminho: C.credencial,
      acao: 'plataforma.cadastros.entrada',
      corpo: CriarCredencialEntrada,
      async executar(c, { params, corpo }) {
        const tenant = uuidDaRota(params);
        if (!d.pepper) throw erros.indisponivel('Entrada de dados');
        const chave = randomBytes(32).toString('base64url');
        const hmac = Buffer.from(hmacChaveEntrada(d.pepper, chave), 'hex');
        try {
          const [linha] = await c.tx.consultar<{ r: { conector_id: string; prefixo: string; criada_em: string } }>(
            'SELECT cadastros.portal_entrada_credencial_definir($1::uuid, $2, $3::bytea, $4, $5) AS r',
            [tenant, corpo.conector_id, hmac, prefixoChaveEntrada(chave), c.request_id],
          );
          return { status: 201, corpo: CredencialEntradaCriada.parse({ ...linha!.r, chave }) };
        } catch (e) {
          if (conectorEmUso(e)) throw erros.conflito('Este código de conector já é usado por outra empresa.');
          throw e;
        }
      },
    }),
    definirRotaPlataforma({
      metodo: 'DELETE',
      caminho: C.credencial,
      acao: 'plataforma.cadastros.entrada',
      consulta: RevogarCredencialEntrada,
      async executar(c, { params, consulta }) {
        const [linha] = await c.tx.consultar<{ r: unknown }>('SELECT cadastros.portal_entrada_credencial_revogar($1::uuid, $2, $3) AS r', [
          uuidDaRota(params),
          consulta.conector_id,
          c.request_id,
        ]);
        return { corpo: CredencialEntradaRevogada.parse(linha!.r) };
      },
    }),
  ]);
}
