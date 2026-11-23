import { MODULOS, MODULOS_BASE, type LicencaModuloPlataforma, type ModuloId } from '@macuxierp/platform-sdk';
import type { Pendencia } from '@macuxierp/ui';
import { NOMES_MODULOS } from '../nomes-modulos';

/** O `depende` vem do manifesto (nunca escrito à mão aqui). */
export interface Dependencia {
  id: ModuloId;
  depende: readonly ModuloId[];
}

/** Nome do módulo no portal: o core não é "Plataforma" aqui (esse é o nome do portal); o core só aparece em mensagem de dependência. */
export const nomeModulo = (m: ModuloId): string => (m === 'core' ? 'Core' : NOMES_MODULOS[m]);

/** Módulos que o usuário liga e desliga (o core, base, fica de fora). */
const MODULOS_EDITAVEIS = MODULOS.filter((m) => !MODULOS_BASE.includes(m));

const dependeDe = (deps: readonly Dependencia[], m: ModuloId): readonly ModuloId[] => deps.find((d) => d.id === m)?.depende ?? [];

function lista(nomes: string[]): string {
  return nomes.length <= 1 ? (nomes[0] ?? '') : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** Módulos que dependem (direta ou indiretamente) de `m` e estão ligados, na ordem de `MODULOS`. */
export function dependentesLigados(m: ModuloId, marcados: ReadonlySet<ModuloId>, deps: readonly Dependencia[]): ModuloId[] {
  const saida = new Set<ModuloId>();
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const x of MODULOS) {
      if (x === m || saida.has(x) || !marcados.has(x)) continue;
      if (dependeDe(deps, x).some((d) => d === m || saida.has(d))) {
        saida.add(x);
        mudou = true;
      }
    }
  }
  return MODULOS.filter((x) => saida.has(x));
}

export interface LinhaModulo {
  modulo: ModuloId;
  marcado: boolean;
  desabilitado: boolean;
  /** Texto ao lado da caixa: "Exige Cadastros". */
  motivo: string | null;
}

export function linhasModulos(marcados: ReadonlySet<ModuloId>, deps: readonly Dependencia[]): LinhaModulo[] {
  // O core nunca aparece: o usuário não age sobre ele (a API garante que fica ligado).
  return MODULOS_EDITAVEIS.map((modulo) => {
    const marcado = marcados.has(modulo);
    const faltam = dependeDe(deps, modulo).filter((d) => !marcados.has(d));
    if (!marcado && faltam.length > 0) return { modulo, marcado, desabilitado: true, motivo: `Exige ${lista(faltam.map(nomeModulo))}` };
    return { modulo, marcado, desabilitado: false, motivo: null };
  });
}

/** Liga ou desliga um módulo; desligar leva junto os dependentes ligados (a tela confirma antes). */
export function alternar(m: ModuloId, ligar: boolean, marcados: ReadonlySet<ModuloId>, deps: readonly Dependencia[]): Set<ModuloId> {
  const novo = new Set(marcados);
  if (ligar) {
    novo.add(m);
    return novo;
  }
  novo.delete(m);
  for (const d of dependentesLigados(m, marcados, deps)) novo.delete(d);
  return novo;
}

export const ativosDe = (modulos: readonly LicencaModuloPlataforma[]): Set<ModuloId> => new Set<ModuloId>([...MODULOS_BASE, ...modulos.filter((l) => l.ativo).map((l) => l.modulo)]);

/** Só os módulos que mudaram (o core nunca): corpo de `AlterarModulosEntrada`. */
export function mudancasDe(atuais: readonly LicencaModuloPlataforma[], marcados: ReadonlySet<ModuloId>): LicencaModuloPlataforma[] {
  const ativos = ativosDe(atuais);
  return MODULOS_EDITAVEIS.filter((m) => ativos.has(m) !== marcados.has(m)).map((modulo) => ({
    modulo,
    ativo: marcados.has(modulo),
    valido_ate: atuais.find((l) => l.modulo === modulo)?.valido_ate ?? null,
  }));
}

/** Módulos ligados na lista, em ordem de `MODULOS`, sem o core (a lista da tela). */
export const modulosLigados = (modulos: readonly LicencaModuloPlataforma[]): ModuloId[] => MODULOS_EDITAVEIS.filter((m) => ativosDe(modulos).has(m));

/** 422 `RN-CORE-02` por `modulos.<módulo>`: o problema e a ação, para a `FaixaPendencias` (a sigla só em `data-regra`). */
export function pendenciasDe(campos: Record<string, string>, marcados: ReadonlySet<ModuloId>, deps: readonly Dependencia[]): Pendencia[] {
  const saida: Pendencia[] = [];
  for (const chave of Object.keys(campos)) {
    const m = MODULOS.find((x) => `modulos.${x}` === chave);
    if (!m) continue;
    const faltam = dependeDe(deps, m).filter((d) => !marcados.has(d));
    if (faltam.length === 0) continue;
    const exige = lista(faltam.map(nomeModulo));
    saida.push({ nivel: 'bloqueante', codigoRn: 'RN-CORE-02', texto: `O módulo ${nomeModulo(m)} exige o módulo ${exige} ligado. Ligue ${exige} ou desligue ${nomeModulo(m)}.` });
  }
  return saida;
}

/** "1 módulo" / "N módulos" para a célula da lista em tela estreita. */
export const resumoModulos = (n: number): string => `${n} ${n === 1 ? 'módulo' : 'módulos'}`;
