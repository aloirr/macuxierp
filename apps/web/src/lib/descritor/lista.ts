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

/** Filtro como entra no cálculo da grade: `colunas` (1 a 12) é a dica do descritor, opcional. */
export interface FiltroGrade { tipo: 'busca' | 'texto' | 'data' | 'selecao' | 'cadastro'; chave?: string; colunas?: number }
const NOME_LONGO = /(cliente|vendedor|fornecedor|produto|usuario)/;
/**
 * Largura de cada filtro na grade de 24 avos da linha de filtros (RD-2383; 2 avos = 1 das 12 colunas da página, para o
 * "De" e o "Até" caberem em 3 avos cada). Fecha sempre as 24 quando a soma passa de 24 se corta, quando falta se reparte:
 * texto e nome longo (cliente, vendedor) partem com 4 (2 colunas), select com 2, data com 3. `colunas` do descritor vale como dica (x2).
 */
export function colunasDosFiltros(filtros: readonly FiltroGrade[]): number[] {
  const base = (f: FiltroGrade): number => (f.colunas ? f.colunas * 2 : f.tipo === 'busca' || f.tipo === 'texto' ? 4 : f.tipo === 'data' ? 3 : f.chave && NOME_LONGO.test(f.chave) ? 4 : 2);
  const minimo = (f: FiltroGrade): number => (f.colunas ? f.colunas * 2 : f.tipo === 'data' ? 3 : f.tipo === 'busca' || f.tipo === 'texto' ? 3 : 2);
  const pesos = filtros.map(base);
  const soma = () => pesos.reduce((a, b) => a + b, 0);
  // Corta 1 avo por vez do maior que ainda pode encolher (o último em empate).
  while (soma() > 24) {
    const candidatos = pesos.map((p, i) => ({ p, i })).filter((x) => x.p > minimo(filtros[x.i] as FiltroGrade));
    if (candidatos.length === 0) break; // o excedente desce para a linha seguinte
    const maior = Math.max(...candidatos.map((x) => x.p));
    pesos[candidatos.filter((x) => x.p === maior).at(-1)!.i] = maior - 1;
  }
  // Reparte a sobra de 2 em 2 (1 coluna) pelos selects sem dica, até 4, e depois pelo texto, até 6.
  for (const [alvo, teto] of [[['selecao', 'cadastro'], 4], [['texto', 'busca'], 6]] as const) {
    let mudou = true;
    while (soma() + 2 <= 24 && mudou) {
      mudou = false;
      for (let i = 0; i < pesos.length && soma() + 2 <= 24; i++) {
        const f = filtros[i] as FiltroGrade;
        if (!f.colunas && (alvo as readonly string[]).includes(f.tipo) && (pesos[i] as number) + 2 <= teto) { pesos[i] = (pesos[i] as number) + 2; mudou = true; }
      }
    }
  }
  return pesos;
}
