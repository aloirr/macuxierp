/**
 * T-0012: adaptador `conector` da porta `LadoErp` — o código do ERP que já está no `main`, sem cópia:
 *  - montagem: `montarLotes` (ordem, lotes de até 5.000 e 4 MiB, sessão com partes, `Idempotency-Key` pelo conteúdo e
 *    pela geração, M6) do domain do `integracao-fdv` (T-0011, PR #78);
 *  - transporte: `criarClienteHub` do platform-sdk (T-0011, PR #77: cabeçalhos, `User-Agent: macuxierp/<versão>`,
 *    classificação, sem URL livre) e `classificarResposta` do domain;
 *  - espera: `atrasoRetentativaSegundos` do domain (curva de 5 s a 15 min, nunca menos que o `Retry-After`).
 *
 * O que ainda não existe no `main` e fica fora (pendente na docs/testes/T-0012.md): o envio do worker a partir do
 * espelho (`registro_publicado`), o cursor local, a agenda e o monitor. Os cenários entregam os registros já no formato
 * do Hub.
 *
 * O `criarClienteHub` só aceita base https (anti-SSRF). Contra o dublê (http em 127.0.0.1), a base é um host https
 * fictício e o `fetch` injetado troca a origem pela do dublê; contra o tenant real, nada é trocado.
 */
import { randomUUID } from 'node:crypto';
import {
  criarClienteHub,
  type ClienteHub,
  type CredencialHub as CredencialSdk,
} from '../../../packages/platform-sdk/src/hub';
import type {
  EntidadeHub as EntidadeC6,
  RegistroLote,
} from '../../../modules/integracao-fdv/contracts/index';
import { montarLotes } from '../../../modules/integracao-fdv/domain/lote';
import {
  atrasoRetentativaSegundos,
  classificarResposta,
} from '../../../modules/integracao-fdv/domain/resposta';
import type { CredencialHub } from './config';
import { criarLadoErp, type LadoErp, type Montador, type OpcoesLado, type Transporte } from './lado-erp';

export interface OpcoesConector extends OpcoesLado {
  /** Base com `/integracao/v1` (a do dublê pode ser http). */
  url: string;
  credencial: CredencialHub;
  versaoErp: string;
  /** Registros por lote (o domain limita a 5.000); o perfil thathyany-seguro usa lotes pequenos. */
  limiteRegistros?: number;
}

const BASE_FICTICIA_DUBLE = 'https://duble-hub.invalid';

/** Cliente do SDK e a credencial na forma dele (também usado pela volta dos pedidos, `cliente-hub-pedidos.ts`). */
export function clienteDoSdk(o: Pick<OpcoesConector, 'url' | 'credencial' | 'versaoErp'>): {
  cliente: ClienteHub;
  cred: CredencialSdk;
} {
  const base = o.url.replace(/\/integracao\/v1$/, '');
  const local = base.startsWith('http://127.0.0.1:');
  const cliente = criarClienteHub({
    urls: { teste: local ? BASE_FICTICIA_DUBLE : base, producao: local ? BASE_FICTICIA_DUBLE : base },
    versaoErp: o.versaoErp,
    ...(local
      ? {
          fetch: (url: string | URL | Request, init?: RequestInit) =>
            fetch(String(url).replace(BASE_FICTICIA_DUBLE, base), init),
        }
      : {}),
  });
  return {
    cliente,
    cred: {
      conectorId: o.credencial.conectorId,
      chave: o.credencial.chaveParaCabecalho(),
      ambiente: 'teste',
    },
  };
}

function transporteSdk(o: OpcoesConector): Transporte {
  const { cliente, cred } = clienteDoSdk(o);
  return {
    async chamar(metodo, caminho, corpo, chave) {
      const r = await cliente.chamar(cred, {
        metodo,
        caminho,
        ...(corpo !== undefined ? { corpo } : {}),
        ...(chave ? { chaveIdempotencia: chave } : {}),
      });
      if (r.tipo === 'ok') return r;
      if (r.tipo === 'retentavel')
        return { tipo: 'retentar', status: r.status, codigo: r.codigo, retryAfterMs: r.retryAfterMs };
      const acao = classificarResposta(r);
      if (
        acao.acao === 'pausar' &&
        (acao.motivo === 'versao' || acao.motivo === 'topologia') &&
        !acao.todasEntidades
      ) {
        return { tipo: 'pausar_entidade', status: r.status, codigo: acao.codigo, motivo: acao.motivo };
      }
      return { tipo: 'recusa', status: r.status, codigo: r.codigo };
    },
  };
}

const montadorConector = (limiteRegistros: number | undefined): Montador => ({
  esperaMs: (n, ra) => 1000 * atrasoRetentativaSegundos(n, ra == null ? null : Math.ceil(ra / 1000)),
  montar(e, enviadoEm) {
    const lotes = montarLotes({
      entidade: e.entidade as EntidadeC6,
      modo: e.modo,
      registros: e.registros as readonly RegistroLote[],
      enviadoEm,
      ...(e.geracao ? { geracao: e.geracao } : {}),
      ...(e.modo === 'completo' ? { sessaoId: randomUUID() } : {}),
      ...(limiteRegistros ? { limiteRegistros } : {}),
    });
    return lotes.map((l) => ({
      parte: l.corpo.sessao?.parte ?? null,
      ultimo: l.corpo.sessao?.ultimo ?? null,
      registros: l.corpo.registros.length,
      chave: l.chave_idempotencia,
      corpo: l.corpo,
    }));
  },
});

export function criarAdaptadorConector(o: OpcoesConector): LadoErp {
  return criarLadoErp('conector', montadorConector(o.limiteRegistros), transporteSdk(o), o);
}
