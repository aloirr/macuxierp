import type { AtalhoInicio } from '@/lib/inicio';

/** Início do BKO: um cartão por atalho; com menos de 3, os cartões esticam e preenchem a linha (decisão 59). */
export function InicioVisao({ atalhos }: { atalhos: readonly AtalhoInicio[] }) {
  return (
    <>
      <h1>Boas-vindas ao Macuxi ERP</h1>
      {atalhos.length === 0 ? (
        <p className="apoio">Nenhum módulo disponível para o seu perfil.</p>
      ) : (
        <ul className={`atalhos atalhos-${atalhos.length}`}>
          {atalhos.map((a) => (
            <li key={a.href}>
              <a className="atalho" href={a.href}>{a.rotulo}</a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
