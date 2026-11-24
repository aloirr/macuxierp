import { EXEMPLO_ESPECIAIS, MENSAGEM_SENHA_OK, REGRAS_SENHA, TITULO_REGRAS_SENHA, regrasDescumpridas, type RegraSenhaId } from '@macuxierp/platform-sdk';

/**
 * Lista "A senha precisa ter" com ✓/✗ ao vivo. O estado de cada regra vai no texto (visível e para leitor de tela), não só na cor.
 * Só o resumo é `aria-live="polite"`: a lista em si não anuncia item a item.
 */
export function RegrasSenha({ senha, faltamNaApi = [] }: { senha: string; faltamNaApi?: readonly RegraSenhaId[] }) {
  // `faltamNaApi` (`detalhes.regras` do 400) soma-se à conferência ao vivo: a API manda no que ela diz que falta.
  const faltam = [...new Set<RegraSenhaId>([...regrasDescumpridas(senha), ...faltamNaApi])];
  const tudoOk = faltam.length === 0;
  return (
    <div className="regras-senha">
      <p className="regras-titulo" id="regras-titulo">{TITULO_REGRAS_SENHA}</p>
      <ul id="regras-lista" aria-labelledby="regras-titulo">
        {REGRAS_SENHA.map((r) => {
          const ok = !faltam.includes(r.id);
          return (
            <li key={r.id} className={ok ? 'regra-ok' : 'regra-falta'}>
              <span className="regra-marca" aria-hidden="true">{ok ? '✓' : '✗'}</span>
              <span className="sr-only">{ok ? 'Atendida: ' : 'Falta: '}</span>
              {r.texto}
              {r.id === 'especial' && <span className="regra-exemplo" aria-hidden="true"> {EXEMPLO_ESPECIAIS}</span>}
            </li>
          );
        })}
      </ul>
      <p className="apoio" aria-live="polite">{tudoOk ? MENSAGEM_SENHA_OK : ''}</p>
    </div>
  );
}
