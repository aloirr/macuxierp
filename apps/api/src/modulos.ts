/**
 * Registro dos módulos montados na API (T-0029). Cada entrada é o plugin do módulo (`definirPlugin(manifesto, rotas)`,
 * exportado pelo `api/` dele) ou, enquanto ele não expõe rotas, só o manifesto (entram os menus do `GET /v1/auth/eu`).
 * Toda rota montada passa pela ordem da RN-CORE-02 (sessão → perfil → tenant → licença) em `criarApp`.
 *
 * `registrarModulos` confere no arranque: só módulos da v1 (`MODULOS`), sem repetição e com as dependências do
 * manifesto montadas; devolve na ordem de `MODULOS` (a mesma do menu).
 *
 * Ligação pendente (PRs #14 e #15 ainda fora do main): a linha do core passa a `criarPluginCore({ repo, hashSenha,
 * leitorPfx, chaveA1, armazenamento })` de `@macuxierp/core/api`, com as dependências criadas no `main.ts`, e a do
 * cadastros a `plugin` de `@macuxierp/cadastros/api`.
 */
import { manifest as cadastros } from '@macuxierp/cadastros/manifest';
import { manifest as core } from '@macuxierp/core/manifest';
import { manifest as faturamento } from '@macuxierp/faturamento/manifest';
import { manifest as fiscal } from '@macuxierp/fiscal/manifest';
import { manifest as integracaoFdv } from '@macuxierp/integracao-fdv/manifest';
import { manifest as pedido } from '@macuxierp/pedido/manifest';
import { definirPlugin, MODULOS, type ManifestoModulo, type PluginModulo } from '@macuxierp/platform-sdk';

export type EntradaModulo = PluginModulo | ManifestoModulo;

export class RegistroModulosInvalido extends Error {
  override readonly name = 'RegistroModulosInvalido';
}

const ehPlugin = (e: EntradaModulo): e is PluginModulo => 'manifesto' in e;

export function registrarModulos(entradas: readonly EntradaModulo[]): readonly PluginModulo[] {
  const porId = new Map<string, PluginModulo>();
  for (const e of entradas) {
    const plugin = ehPlugin(e) ? e : definirPlugin(e, []);
    const id = plugin.manifesto.id;
    if (!(MODULOS as readonly string[]).includes(id)) throw new RegistroModulosInvalido(`módulo "${id}" fora da v1`);
    if (porId.has(id)) throw new RegistroModulosInvalido(`módulo "${id}" montado duas vezes`);
    porId.set(id, plugin);
  }
  for (const p of porId.values()) {
    const falta = p.manifesto.depende.filter((dep) => !porId.has(dep));
    if (falta.length) throw new RegistroModulosInvalido(`${p.manifesto.id} depende de ${falta.join(', ')}, que não está montado`);
  }
  return Object.freeze(MODULOS.flatMap((id) => porId.get(id) ?? []));
}

export const MODULOS_MONTADOS: readonly PluginModulo[] = registrarModulos([core, cadastros, pedido, fiscal, faturamento, integracaoFdv]);
