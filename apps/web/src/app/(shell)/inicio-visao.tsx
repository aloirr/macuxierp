import type { AtalhoInicio } from '@/lib/inicio';

/** Início do BKO: um cartão por atalho; com menos de 3, os cartões esticam e preenchem a linha (decisão 59). */
export function InicioVisao({ atalhos }: { atalhos: readonly AtalhoInicio[] }) {
  return (
    <>
      <h1>Início</h1>
      {atalhos.length === 0 ? (
        <p className="apoio">Nenhum atalho disponível para o seu perfil. Use o menu para acessar as telas liberadas.</p>
      ) : (
        <ul className={`atalhos atalhos-${atalhos.length}`}>
          {atalhos.map((a) => (
            <li key={a.href}>
              <a className="atalho" href={a.href}>
                <div>
                  <b>{a.rotulo}</b>
                  <span>{a.descricao}</span>
                </div>
                <span className="seta" aria-hidden="true">→</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
