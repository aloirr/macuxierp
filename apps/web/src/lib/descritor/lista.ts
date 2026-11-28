/** Rótulos da lista genérica (parte pura). Filtros e links vêm do SDK e de `lib/listas-url.ts`. */

/** Troca o valor da célula pelo rótulo da opção quando a coluna tem o mesmo id de um filtro de cadastro (filial, vendedor): o UUID não aparece na tela. */
export function rotuloDaCelula(texto: string, opcoes: ReadonlyMap<string, string> | undefined): string {
  return opcoes?.get(texto) ?? texto;
}

/** Diferença (ms) entre o relógio de parede do fuso e o UTC no instante dado. */
function deslocamento(instanteMs: number, fuso: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(instanteMs)).map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0) - Math.floor(instanteMs / 1000) * 1000;
}

/** Início do dia civil (AAAA-MM-DD) no fuso, em ms UTC. */
function inicioDoDia(ano: number, mes: number, dia: number, fuso: string): number {
  const base = Date.UTC(ano, mes - 1, dia);
  const primeiro = base - deslocamento(base, fuso);
  return base - deslocamento(primeiro, fuso);
}

/**
 * Dia civil (`AAAA-MM-DD`, do campo de data) como instante ISO completo no fuso do tenant: `inicio` = 00:00:00.000 do dia, `fim` = 23:59:59.999.
 * A auditoria (`de`/`ate`) pede datetime completo; data inválida volta como veio (a API responde 400 e a tela recomeça a lista).
 */
export function instanteDoDia(dia: string, fuso: string, ponta: 'inicio' | 'fim'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) return dia;
  const [ano, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const teste = new Date(Date.UTC(ano, mes - 1, d));
  if (teste.getUTCFullYear() !== ano || teste.getUTCMonth() !== mes - 1 || teste.getUTCDate() !== d) return dia;
  const ms = ponta === 'inicio' ? inicioDoDia(ano, mes, d, fuso) : inicioDoDia(ano, mes, d + 1, fuso) - 1;
  return new Date(ms).toISOString();
}

/** Filtros da URL como a API recebe: os campos de data com `instante` viram datetime ISO completo; o resto passa como veio. */
export function filtrosParaApi(filtrosTela: readonly { chave: string; instante?: 'inicio' | 'fim' }[], filtros: Readonly<Record<string, string>>, fuso: string): Record<string, string> {
  const saida: Record<string, string> = { ...filtros };
  for (const f of filtrosTela) {
    const v = filtros[f.chave];
    if (f.instante && v) saida[f.chave] = instanteDoDia(v, fuso, f.instante);
  }
  return saida;
}

/** Rótulos de filtro de gênero feminino (o shell escolhe "Todas" × "Todos" pelo primeiro termo do rótulo; os demais ficam "Todos"). */
const FILTROS_FEMININOS = new Set(['filial', 'origem', 'condição', 'condicao', 'série', 'serie', 'situação', 'situacao', 'rejeição', 'rejeicao', 'natureza', 'empresa', 'carteira']);
export function textoTodos(rotulo: string): 'Todas' | 'Todos' {
  const primeiro = rotulo.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return FILTROS_FEMININOS.has(primeiro) ? 'Todas' : 'Todos';
}

/** Colunas de cada filtro na grade de 12 (RD-2383): uma linha só, com 2 colunas reservadas ao link "Limpar filtros". Corta primeiro selects e texto (até 1), depois a busca (até 2); data fica com 2. Se ainda passar de 10, o excedente desce para a linha seguinte. */
const PESO_FILTRO: Record<'busca' | 'texto' | 'data' | 'selecao' | 'cadastro', number> = { busca: 3, texto: 2, data: 2, selecao: 2, cadastro: 2 };
const MINIMO_FILTRO: Record<keyof typeof PESO_FILTRO, number> = { busca: 2, texto: 1, data: 2, selecao: 1, cadastro: 1 };
export function colunasDosFiltros(tipos: readonly (keyof typeof PESO_FILTRO)[]): number[] {
  const pesos = tipos.map((t) => PESO_FILTRO[t]);
  const soma = () => pesos.reduce((a, b) => a + b, 0);
  for (const grupo of [['selecao', 'cadastro', 'texto'], ['busca']] as const) {
    for (let i = pesos.length - 1; i >= 0 && soma() > 10; i--) {
      const t = tipos[i] as keyof typeof PESO_FILTRO;
      if ((grupo as readonly string[]).includes(t) && (pesos[i] as number) > MINIMO_FILTRO[t]) pesos[i] = (pesos[i] as number) - 1;
    }
  }
  return pesos;
}
