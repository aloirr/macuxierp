import type { AtalhoInicio } from '@/lib/inicio';

/** Início do BKO: um cartão por atalho; com menos de 3, os cartões esticam e preenchem a linha (decisão 59). */
export function InicioVisao({ atalhos, nome }: { atalhos: readonly AtalhoInicio[]; nome: string }) {
  const primeiroNome = nome.trim().split(/\s+/)[0] ?? '';
  return (
    <>
      <h1>Início</h1>
      <p className="apoio">Olá, {primeiroNome}. Por onde quer começar?</p>
      {atalhos.length === 0 ? (
        <p className="apoio">Nenhuma tela liberada para o seu perfil. Fale com o administrador.</p>
      ) : (
        <>
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
        </>
      )}
    </>
  );
}
