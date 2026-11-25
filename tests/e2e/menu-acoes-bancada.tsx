/**
 * T-0099 (A-1 a A-3, bancada do componente): página mínima com o `MenuAcoes` de `packages/ui`, montada pelo
 * `tests/e2e/menu-acoes.mjs --bancada` (esbuild) e aberta no Chromium. Os casos que as telas reais têm e que cortariam
 * um menu mal posicionado: tabela dentro de quadro com `overflow` e altura fixa, gatilho na última linha visível, rótulo
 * longo, ação principal à vista, perigo misturado no meio da lista e página com rolagem. Só dados fictícios.
 */
import { createRoot } from 'react-dom/client';
import { MenuAcoes, type AcaoMenu } from '../../packages/ui/src/MenuAcoes';

const acionadas: string[] = [];
(window as unknown as { acionadas: string[] }).acionadas = acionadas;
const anotar = (s: string) => () => acionadas.push(s);

/** Perigo de propósito no meio da lista: o componente tem de mandá-lo para o fim, depois do traço. */
const acoesDaLinha = (n: number): AcaoMenu[] => [
  { chave: 'log', rotulo: 'Log', aoAcionar: anotar(`log-${n}`) },
  { chave: 'zerar', rotulo: 'Zerar', perigo: true, aoAcionar: anotar(`zerar-${n}`) },
  { chave: 'reprocessar', rotulo: 'Reprocessar os registros com falha', aoAcionar: anotar(`reprocessar-${n}`) },
  { chave: 'travado', rotulo: 'Tentar de novo', desabilitado: true, aoAcionar: anotar(`travado-${n}`) },
  { chave: 'desativar', rotulo: 'Desativar', perigo: true, aoAcionar: anotar(`desativar-${n}`) },
  { chave: 'editar', rotulo: 'Editar', aoAcionar: anotar(`editar-${n}`) },
];

const linhas = Array.from({ length: 12 }, (_, i) => i + 1);

function Bancada() {
  return (
    <main style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h1>Bancada do botão Ações</h1>
      <div style={{ height: 240 }} />
      <section aria-label="Quadro com rolagem" data-quadro style={{ height: 260, overflow: 'auto', border: '1px solid #DFE2E6' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Cadastro</th>
              <th style={{ textAlign: 'right' }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((n) => (
              <tr key={n} data-linha={n}>
                <td>Cadastro fictício {n}</td>
                <td style={{ textAlign: 'right' }}>
                  <MenuAcoes rotuloLinha={`Cadastro fictício ${n}`} principal={n % 2 ? { rotulo: 'Log', aoAcionar: anotar(`principal-${n}`) } : undefined} acoes={acoesDaLinha(n)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div style={{ height: 1600 }} />
    </main>
  );
}

createRoot(document.getElementById('raiz')!).render(<Bancada />);
