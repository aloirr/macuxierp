/**
 * Substituir tudo da carga de 8 arquivos, sobre o dublê em memória (T-0058, v0.3.6; RN-CAD-10): cliente com os endereços e
 * condição de pagamento. Planeja antes da gravação, inativa em lote (nunca apaga) e publica `inativo: true`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ArquivoRecebido, type ContextoRota } from '@macuxierp/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarAmbiente, sessaoDe } from './apoio-teste';
import { aplicarSubstituicao, planejarSubstituicao } from './carga-substituir';
import { criarPluginCadastros } from './index';
import { dependenciasEmMemoria } from './memoria';

const pasta = join(dirname(fileURLToPath(import.meta.url)), '..', 'domain', 'carga', '__fixtures__');
const ler = (nome: string) => readFileSync(join(pasta, `${nome}.csv`), 'utf8').trim().split('\n');
const arq = (linhas: string[]) => new ArquivoRecebido('arquivo', 'x.csv', 'text/csv', Buffer.from(linhas.join('\n')));

async function montar() {
  const m = dependenciasEmMemoria();
  m.repos.oficiais.ncms.add('21069030');
  m.repos.oficiais.municipiosPorUf.set('AM', [{ ibge: '1302603', nome: 'Manaus' }]);
  m.repos.oficiais.municipiosPorUf.set('SP', [{ ibge: '3550308', nome: 'São Paulo' }]);
  const amb = criarAmbiente(criarPluginCadastros(m.deps));
  const arquivos = readdirSync(pasta).filter((f) => f.endsWith('.csv')).map((nome) => ({ nome, conteudo: readFileSync(join(pasta, nome)) }));
  const r = await amb.chamar('POST', '/cargas', { sessao: sessaoDe('administrador'), corpo: { modo: 'gravar' }, arquivos });
  expect(r.status).toBe(200);
  const eventos: { nome: string; agregado_id: string; payload: Record<string, unknown> }[] = [];
  const c = {
    sessao: sessaoDe('administrador'), tx: { consultar: async () => [] }, request_id: 'r', agora: new Date('2026-11-23T15:00:00Z'),
    publicar: async (e: (typeof eventos)[number]) => void eventos.push(e), auditar: async () => undefined, enfileirar: async () => ({ id: 'x' }),
  } as unknown as ContextoRota;
  return { ...m, c, eventos };
}

describe('Substituir tudo: cliente e endereços (T-0058, RN-CAD-10)', () => {
  it('T-0058: o endereço de carga que não veio no arquivo é inativado junto, e o cliente ausente leva os endereços dele', async () => {
    const t = await montar();
    const [cab, c1] = ler('cliente');
    expect(t.repos.clientes.linhas.length).toBeGreaterThanOrEqual(2);
    const a = arq([cab!, c1!]); // só C-EX-01, só o principal
    const previsto = await planejarSubstituicao(t.deps, t.c, 'cliente', a);
    const r = await aplicarSubstituicao(t.deps, t.c, 'cliente', previsto);
    expect(r.inativados).toHaveLength(1);
    expect(r.enderecos_inativados).toHaveLength(2); // o endereço do C-EX-02 e a entrega do C-EX-01
    const inativos = (l: { inativo: boolean }[]) => l.filter((x) => x.inativo).length;
    expect(inativos(t.repos.clientes.linhas)).toBe(1);
    expect(t.repos.clientes.linhas.filter((x) => !x.inativo)).toHaveLength(t.repos.clientes.linhas.length - 1);
    // nunca apaga: as linhas continuam no banco
    expect(t.repos.clientes.linhas.length).toBeGreaterThanOrEqual(2);
  });

  it('T-0058: o evento do cliente sai uma vez por cliente afetado, e o do cliente inativado leva inativo', async () => {
    const t = await montar();
    const [cab, c1] = ler('cliente');
    const previsto = await planejarSubstituicao(t.deps, t.c, 'cliente', arq([cab!, c1!]));
    const r = await aplicarSubstituicao(t.deps, t.c, 'cliente', previsto);
    const ev = t.eventos.filter((e) => e.nome === 'cadastros.cliente.alterado@1');
    expect(ev).toHaveLength(2); // C-EX-01 perdeu o endereço de entrega; C-EX-02 foi inativado
    expect(new Set(ev.map((e) => e.agregado_id)).size).toBe(2);
    expect(ev.filter((e) => e.payload.inativo === true)).toHaveLength(r.inativados.length);
  });

  it('T-0058: o arquivo igual ao que está no banco não inativa nada (nem endereço)', async () => {
    const t = await montar();
    const a = arq(ler('cliente'));
    const previsto = await planejarSubstituicao(t.deps, t.c, 'cliente', a);
    expect(previsto.plano.inativar).toEqual([]);
    expect(previsto.plano.enderecos_inativar).toEqual([]);
  });

  it('T-0058: a linha recusada do arquivo também protege o endereço gravado', async () => {
    const t = await montar();
    const [cab, c1, c1b] = ler('cliente');
    // linha da entrega com o dado do cliente alterado = recusada na carga, mas o external_id do endereço veio no arquivo
    const quebrada = c1b!.replace('Cliente Exemplo 01 Ltda', 'Outro nome');
    const previsto = await planejarSubstituicao(t.deps, t.c, 'cliente', arq([cab!, c1!, quebrada]));
    expect(previsto.plano.enderecos_inativar).toHaveLength(1); // só o do C-EX-02 (cliente inativado)
  });
});
