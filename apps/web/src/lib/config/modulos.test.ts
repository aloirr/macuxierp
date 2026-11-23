import { describe, expect, it } from 'vitest';
import type { LicencaModuloPlataforma, ModuloId } from '@macuxierp/platform-sdk';
import { MANIFESTOS } from '../manifestos';
import { resumoModulos, alternar, ativosDe, dependentesLigados, linhasModulos, modulosLigados, mudancasDe, pendenciasDe } from './modulos';

const deps = MANIFESTOS.map((m) => ({ id: m.id, depende: m.depende }));
const lic = (...ativos: ModuloId[]): LicencaModuloPlataforma[] => (['core', 'cadastros', 'pedido', 'faturamento', 'fiscal', 'integracao-fdv'] as const).map((modulo) => ({ modulo, ativo: modulo === 'core' || ativos.includes(modulo), valido_ate: null }));

describe('módulos do portal (RN-CORE-02: o depende vem do manifesto)', () => {
  it('o core não vira linha, mesmo vindo na lista da API', () => {
    const l = linhasModulos(ativosDe(lic()), deps);
    expect(l.map((x) => x.modulo)).not.toContain('core');
  });
  it('módulo com dependência desligada fica desabilitado, com o motivo', () => {
    const l = linhasModulos(ativosDe(lic()), deps);
    const fat = l.find((x) => x.modulo === 'faturamento');
    expect(fat?.desabilitado).toBe(true);
    expect(fat?.motivo).toMatch(/^Exige .*Fiscal/);
    expect(l.find((x) => x.modulo === 'cadastros')).toMatchObject({ desabilitado: false, motivo: null });
  });
  it('desligar o fiscal leva o faturamento junto e a tela avisa quem cai', () => {
    const ligados = ativosDe(lic('cadastros', 'fiscal', 'faturamento'));
    expect(dependentesLigados('fiscal', ligados, deps)).toEqual(['faturamento']);
    const depois = alternar('fiscal', false, ligados, deps);
    expect(depois.has('faturamento')).toBe(false);
    expect(depois.has('cadastros')).toBe(true);
  });
  it('mudancasDe manda só o que mudou, nunca o core', () => {
    const atuais = lic('cadastros');
    expect(mudancasDe(atuais, ativosDe(atuais))).toEqual([]);
    const m = mudancasDe(atuais, new Set<ModuloId>(['core', 'cadastros', 'pedido']));
    expect(m).toEqual([{ modulo: 'pedido', ativo: true, valido_ate: null }]);
  });
  it('mudancasDe com marcados sem o core não leva o core no corpo', () => {
    const atuais = lic('cadastros');
    const m = mudancasDe(atuais, new Set<ModuloId>(['cadastros', 'pedido']));
    expect(m.map((x) => x.modulo)).not.toContain('core');
    expect(m).toEqual([{ modulo: 'pedido', ativo: true, valido_ate: null }]);
    expect(mudancasDe(atuais, new Set<ModuloId>()).map((x) => x.modulo)).toEqual(['cadastros']);
  });
  it('resumo da célula: singular e plural', () => {
    expect(resumoModulos(1)).toBe('1 módulo');
    expect(resumoModulos(2)).toBe('2 módulos');
  });
  it('lista da tabela: ordem de MODULOS, sem o core', () => {
    expect(modulosLigados(lic('fiscal', 'cadastros'))).toEqual(['cadastros', 'fiscal']);
  });
  it('422 vira pendência bloqueante com o problema e a ação (sigla só em codigoRn)', () => {
    const p = pendenciasDe({ 'modulos.faturamento': 'x' }, new Set<ModuloId>(['core', 'cadastros', 'faturamento']), deps);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ nivel: 'bloqueante', codigoRn: 'RN-CORE-02' });
    expect(p[0]?.texto).toMatch(/^O módulo Faturamento exige o módulo .*Fiscal.* ligado\. Ligue .* ou desligue Faturamento\.$/);
    expect(p[0]?.texto).not.toContain('RN-');
  });
});
