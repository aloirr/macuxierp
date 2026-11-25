/**
 * Apoio dos servidores dos e2e (`api-render-telas.ts`, `api-portal-integracao.ts`): sobe a API de produção (`appPgDeTeste`
 * com `modulos: 'producao'`, plugin de plataforma do portal /config e uma chave do conector gerada a cada execução) num banco
 * efêmero do Postgres local, com um tenant, a empresa, uma filial, um administrador e um superadmin fictícios. Grava o JSON de
 * pronto (`--pronto <arquivo>`) quando está ouvindo; no SIGTERM ou SIGINT fecha e apaga o banco. Fora do vitest.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { CODIGO_SUPERADMIN_LOGIN } from '../../packages/platform-sdk/src/index';
import { criarBancoEfemero, criarTenant, type BancoEfemero } from '../../packages/platform-sdk/src/pg-testes';
import {
  appPgDeTeste,
  inserirAdministradorDeTeste,
  inserirFilialDeTeste,
  SENHA_DE_TESTE,
} from '../../apps/api/src/apoio-teste';
import { inserirSuperadmin, SENHA_SA } from '../apoio/portal-pg';
import { argumento } from './apoio-e2e.mjs';

const CNPJ_FICTICIO = '11222333000181';

export interface OpcoesApiE2e {
  /** Código da empresa no login (`plataforma.tenant.slug`). */
  slug: string;
  /** Nome (fictício) da empresa e do tenant. */
  nome: string;
  /** Módulos licenciados do tenant. */
  modulos: readonly string[];
  /** Superadmin do portal /config; `deveTrocar` = senha provisória. */
  sa: { email: string; deveTrocar?: boolean };
  /** E-mail do administrador do tenant (filial "Matriz Manaus"). */
  adm: string;
  /** Versão que a API informa (identifica o e2e nos logs). */
  versao: string;
  /** Porta padrão, se a linha de comando não trouxer `--porta`. */
  porta: string;
  /** Campos a mais no JSON de pronto. */
  extra?: (c: { b: BancoEfemero; tenant: string; url: string }) => Record<string, unknown>;
}

export async function subirApiE2e(o: OpcoesApiE2e) {
  const porta = Number(argumento('porta', o.porta));
  const pronto = argumento('pronto', '');
  const b = await criarBancoEfemero();
  await inserirSuperadmin(b, o.sa.email, { deveTrocar: o.sa.deveTrocar ?? false });
  const tenant = await criarTenant(b.admin, o.slug, o.modulos);
  await b.admin.query('UPDATE plataforma.tenant SET nome = $2 WHERE id = $1', [tenant, o.nome]);
  await b.admin.query('INSERT INTO core.empresa (tenant_id, razao_social, cnpj) VALUES ($1, $2, $3)', [
    tenant,
    o.nome,
    CNPJ_FICTICIO,
  ]);
  const filial = randomUUID();
  await inserirFilialDeTeste(b.admin, tenant, { id: filial, cnpj: CNPJ_FICTICIO, nome: 'Matriz Manaus' });
  await inserirAdministradorDeTeste(b.admin, tenant, {
    id: randomUUID(),
    email: o.adm,
    nome: 'Administração Fictícia',
    filialIds: [filial],
  });

  const { app } = await appPgDeTeste({
    b,
    versao: o.versao,
    modulos: 'producao',
    chaveIntegracao: randomBytes(32),
  });
  await app.listen({ port: porta, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${porta}`;
  const dados = {
    url,
    empresa: { id: tenant, slug: o.slug, nome: o.nome },
    superadmin: { empresa: CODIGO_SUPERADMIN_LOGIN, email: o.sa.email, senha: SENHA_SA },
    administrador: { empresa: o.slug, email: o.adm, senha: SENHA_DE_TESTE },
    ...(o.extra ? o.extra({ b, tenant, url }) : {}),
  };
  if (pronto) writeFileSync(pronto, JSON.stringify(dados));
  console.error(`[${o.versao}] ouvindo em ${url} (banco ${b.nome})`);

  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      void app
        .close()
        .then(() => b.remover())
        .then(() => console.error(`[${o.versao}] banco efêmero apagado`))
        .finally(() => process.exit(0));
    });
  }
  return { b, app, tenant, url, dados };
}
