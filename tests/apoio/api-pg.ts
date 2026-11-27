/**
 * T-0008: a API de produção pelo `appPgDeTeste` (`modulos: 'producao'`). Aqui fica só o que é dos testes: tenants,
 * empresas, administradores e os atalhos de chamada.
 */
import { randomUUID } from 'node:crypto';
import { relogioDoSistema, type Perfil, type PluginModulo, type Relogio } from '../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant, type BancoEfemero } from '../../packages/platform-sdk/src/pg-testes';
import { appPgDeTeste, inserirAdministradorDeTeste, JWT_SEGREDO_DE_TESTE, type OpcoesAppPg } from '../../apps/api/src/apoio-teste';
import { emitirTokenAcesso } from '../../apps/api/src/auth/jwt';

/** CNPJ da empresa de todo tenant de teste (fictício, com DV válido). */
export const CNPJ_EMPRESA_PG = '11222333000181';

export type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * `tenants`: apelido → módulos licenciados (o core é base). Cada tenant ganha a empresa e um administrador. `modulos`
 * (T-0017): troca os módulos montados (ex.: o plugin do pedido, que o `montarModulos` do main ainda monta só pelo manifesto);
 * `relogio`: o mesmo relógio de teste na API, nos tokens e no worker do arnês. `pepperEntrada` e `logger` (T-0057) vão
 * direto ao `appPgDeTeste`: o pepper da `/entrada/v1` e o logger em memória dos testes de vazamento.
 */
export async function montarApiPg<K extends string>(
  tenants: Record<K, readonly string[]>,
  o: { modulos?: (b: BancoEfemero) => readonly PluginModulo[]; relogio?: Relogio } & Pick<OpcoesAppPg, 'pepperEntrada' | 'logger'> = {},
) {
  const b: BancoEfemero = await criarBancoEfemero();
  const t = {} as Record<K, string>;
  const adm = {} as Record<K, string>;
  for (const k of Object.keys(tenants) as K[]) {
    t[k] = await criarTenant(b.admin, `t0008-${k.toLowerCase()}-${randomUUID().slice(0, 8)}`, tenants[k]);
    adm[k] = randomUUID();
    await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [t[k], `Empresa ${k}`, CNPJ_EMPRESA_PG]);
    await inserirAdministradorDeTeste(b.admin, t[k], { id: adm[k], email: `adm@${k.toLowerCase()}.teste`, nome: 'Administração', filialIds: [] });
  }
  const relogio = o.relogio ?? relogioDoSistema;
  const { app, modulos } = await appPgDeTeste({ b, versao: 't0008-db', modulos: o.modulos ? o.modulos(b) : 'producao', ...(o.relogio ? { relogio: o.relogio } : {}), pepperEntrada: o.pepperEntrada ?? null, ...(o.logger ? { logger: o.logger } : {}) });

  const auth = (quem: K, perfil: Perfil = 'administrador') => ({
    authorization: `Bearer ${emitirTokenAcesso({ usuario_id: adm[quem], tenant_id: t[quem], perfil, filial_ids: [] }, JWT_SEGREDO_DE_TESTE, relogio.agora(), 900).token}`,
  });
  const chamar = (quem: K, method: Metodo, url: string, payload?: object, perfil: Perfil = 'administrador') =>
    app.inject({ method, url, headers: auth(quem, perfil), ...(payload ? { payload } : {}) });
  const fechar = async () => {
    await app.close();
    await b.remover();
  };
  return { b, app, modulos, t, adm, auth, chamar, fechar };
}
