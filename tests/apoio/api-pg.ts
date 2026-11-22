/**
 * T-0008: a API real (`criarApp`) com o `montarModulos` de produção e exatamente os adaptadores do `apps/api/src/main.ts`
 * (PR #19): `RepositorioCoreSql`, argon2id da plataforma, `LeitorPfxTls`, armazenamento indisponível (503 até a T-0024)
 * e, no cadastros, os padrões do `montarModulos` (SQL, fontes HTTP e o A1 pela porta do core). Banco efêmero migrado,
 * `BancoPg` no papel `macuxierp_app` (a RLS vale de verdade). Só a chave do A1 e o segredo do JWT são de teste.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { relogioDoSistema, type Perfil } from '../../packages/platform-sdk/src/index';
import { AuditoriaPg, FilaDeTrabalhosPg, LicencasPg, OutboxPg } from '../../packages/platform-sdk/src/pg';
import { criarBancoEfemero, criarTenant, type BancoEfemero } from '../../packages/platform-sdk/src/pg-testes';
import { criarApp } from '../../apps/api/src/app';
import { emitirTokenAcesso } from '../../apps/api/src/auth/jwt';
import { RepositorioAuthPg } from '../../apps/api/src/auth/repositorio-pg';
import { gerarHashSenha } from '../../apps/api/src/auth/senha';
import { CONFIG_AUTH_PADRAO } from '../../apps/api/src/auth/servico';
import { armazenamentoIndisponivel, montarModulos } from '../../apps/api/src/modulos';
import { LeitorPfxTls, RepositorioCoreSql } from '../../modules/core/api/index';

const SEGREDO = 'segredo-de-teste-t0008-db-com-mais-de-32-caracteres';
/** CNPJ da empresa de todo tenant de teste (fictício, com DV válido). */
export const CNPJ_EMPRESA_PG = '11222333000181';

export type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** `tenants`: apelido → módulos licenciados (o core é base). Cada tenant ganha a empresa e um administrador. */
export async function montarApiPg<K extends string>(tenants: Record<K, readonly string[]>) {
  const b: BancoEfemero = await criarBancoEfemero();
  const t = {} as Record<K, string>;
  const adm = {} as Record<K, string>;
  for (const k of Object.keys(tenants) as K[]) {
    t[k] = await criarTenant(b.admin, `t0008-${k.toLowerCase()}-${randomUUID().slice(0, 8)}`, tenants[k]);
    adm[k] = randomUUID();
    await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [t[k], `Empresa ${k}`, CNPJ_EMPRESA_PG]);
    await b.admin.query(
      "INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, perfil) VALUES ($1, $2, $3, 'Administração', '$argon2id$v=19$m=65536,t=3,p=4$c2FsdGZpY3RpY2lv$aGFzaGZpY3RpY2lv', 'administrador')",
      [adm[k], t[k], `adm@${k.toLowerCase()}.teste`],
    );
  }
  // Igual ao main.ts, linha a linha, menos a chave do A1 (aqui aleatória; lá, MACUXIERP_CHAVE_A1).
  const modulos = montarModulos({
    core: { repo: new RepositorioCoreSql(), hashSenha: (senha) => gerarHashSenha(senha), leitorPfx: new LeitorPfxTls(), chaveA1: randomBytes(32), armazenamento: armazenamentoIndisponivel },
  });
  const app = await criarApp({
    versao: 't0008-db',
    auth: { ...CONFIG_AUTH_PADRAO, jwtSegredo: SEGREDO },
    cookieSeguro: true,
    banco: b.banco('macuxierp_app'),
    repoAuth: new RepositorioAuthPg(),
    licencas: new LicencasPg(),
    outbox: new OutboxPg(),
    auditoria: new AuditoriaPg(),
    trabalhos: new FilaDeTrabalhosPg(),
    relogio: relogioDoSistema,
    modulos,
    logger: false,
  });

  const auth = (quem: K, perfil: Perfil = 'administrador') => ({
    authorization: `Bearer ${emitirTokenAcesso({ usuario_id: adm[quem], tenant_id: t[quem], perfil, filial_ids: [] }, SEGREDO, relogioDoSistema.agora(), 900).token}`,
  });
  const chamar = (quem: K, method: Metodo, url: string, payload?: object, perfil: Perfil = 'administrador') =>
    app.inject({ method, url, headers: auth(quem, perfil), ...(payload ? { payload } : {}) });
  const fechar = async () => {
    await app.close();
    await b.remover();
  };
  return { b, app, modulos, t, adm, auth, chamar, fechar };
}
