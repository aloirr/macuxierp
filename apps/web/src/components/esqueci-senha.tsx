'use client';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { pedirEsqueciAction } from '@/app/login/esqueci';
import {
  TEXTOS_ESQUECI as T,
  type CampoEsqueci,
  type DadosEsqueci,
  type EnviarEsqueci,
  type ResultadoEsqueci,
} from '@/lib/esqueci-resultado';
import { primeiroVazio, TEXTOS_LOGIN, validarCampos, type ErrosLogin } from '@/lib/login-regras';

/** Botão com aparência de link ("Esqueci a senha" e "Voltar para entrar"), dentro de um parágrafo de apoio. */
function BotaoLink({ texto, aoClicar, refBotao }: { texto: string; aoClicar?: (() => void) | undefined; refBotao?: Ref<HTMLButtonElement> }) {
  return <p className="apoio"><button type="button" className="link" ref={refBotao} onClick={aoClicar}>{texto}</button></p>;
}

const CAMPOS: readonly CampoEsqueci[] = ['empresa', 'email'];

export type EstadoEsqueci = {
  fase: 'form' | 'enviando' | 'confirmado';
  erros: ErrosLogin;
  aviso?: string;
};

export function estadoDe(r: ResultadoEsqueci): EstadoEsqueci {
  if (r.tipo === 'ok') return { fase: 'confirmado', erros: {} };
  if (r.tipo === 'campos') return { fase: 'form', erros: r.erros };
  return { fase: 'form', erros: {}, aviso: r.texto };
}

/** Parte visual pura (testável sem DOM). Nunca guarda nem põe e-mail em URL ou storage. */
export function PainelEsqueciVisao({
  estado, valores = {}, aoEnviar, aoVoltar, refs,
}: {
  estado: EstadoEsqueci;
  valores?: DadosEsqueci;
  aoEnviar?: (f: FormData) => void;
  aoVoltar?: () => void;
  refs?: { campo: (c: CampoEsqueci) => (el: HTMLInputElement | null) => void; texto: (el: HTMLParagraphElement | null) => void; };
}) {
  const voltar = <BotaoLink texto={T.voltar} aoClicar={aoVoltar} />;
  if (estado.fase === 'confirmado') {
    return (
      <section aria-label={T.tituloPainel}>
        <p className="aviso-sucesso" role="status" tabIndex={-1} ref={refs?.texto}>{T.confirmacao}</p>
        {voltar}
      </section>
    );
  }
  return (
    <section aria-label={T.tituloPainel}>
      <form
        noValidate
        aria-busy={estado.fase === 'enviando'}
        onSubmit={(e) => { e.preventDefault(); aoEnviar?.(new FormData(e.currentTarget)); }}
      >
        {estado.aviso && <p className="erro" role="alert">{estado.aviso}</p>}
        {CAMPOS.map((c) => (
          <label className="campo" key={c}>
            <span>{TEXTOS_LOGIN.rotulos[c]}</span>
            <input
              name={c}
              type={c === 'email' ? 'email' : 'text'}
              defaultValue={valores[c]}
              autoComplete={c === 'email' ? 'username' : 'organization'}
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={estado.erros[c] ? true : undefined}
              aria-describedby={estado.erros[c] ? `esqueci-erro-${c}` : undefined}
              ref={refs?.campo(c)}
            />
            {estado.erros[c] && <small className="erro-campo" id={`esqueci-erro-${c}`}>{estado.erros[c]}</small>}
          </label>
        ))}
        <button className="mx-botao" type="submit" disabled={estado.fase === 'enviando'}>{T.botao}</button>
      </form>
      {voltar}
    </section>
  );
}

export function EsqueciSenha({
  empresaInicial, emailInicial, aoVoltar, enviar = pedirEsqueciAction,
}: {
  empresaInicial?: string | undefined;
  emailInicial?: string | undefined;
  aoVoltar: () => void;
  enviar?: EnviarEsqueci;
}) {
  const [estado, setEstado] = useState<EstadoEsqueci>({ fase: 'form', erros: {} });
  const inputs = useRef<Partial<Record<CampoEsqueci, HTMLInputElement | null>>>({});
  const texto = useRef<HTMLParagraphElement | null>(null);
  const valores: DadosEsqueci = { empresa: empresaInicial, email: emailInicial };

  useEffect(() => {
    if (estado.fase === 'confirmado') texto.current?.focus();
    else {
      const alvo = CAMPOS.find((c) => estado.erros[c]);
      const lido: DadosEsqueci = {};
      for (const c of CAMPOS) lido[c] = inputs.current[c]?.value ?? valores[c];
      inputs.current[alvo ?? primeiroVazio(CAMPOS, lido) ?? 'email']?.focus();
    }
  }, [estado.fase === 'confirmado', estado.erros, estado.aviso]);

  async function aoEnviar(f: FormData) {
    const dados = { empresa: String(f.get('empresa') ?? '').trim(), email: String(f.get('email') ?? '').trim() };
    const erros = validarCampos(CAMPOS, dados);
    if (Object.keys(erros).length) return setEstado({ fase: 'form', erros });
    setEstado({ fase: 'enviando', erros: {} });
    setEstado(estadoDe(await enviar(dados).catch((): ResultadoEsqueci => ({ tipo: 'erro', texto: T.erroGenerico }))));
  }

  return (
    <PainelEsqueciVisao
      estado={estado}
      valores={valores}
      aoEnviar={(f) => void aoEnviar(f)}
      aoVoltar={aoVoltar}
      refs={{ campo: (c) => (el) => { inputs.current[c] = el; }, texto: (el) => { texto.current = el; } }}
    />
  );
}

/** Alterna entre o formulário de login e o painel; o link só existe se `disponivel` (a API diz que o e-mail da plataforma está configurado). */
export function ComEsqueciSenha({
  disponivel, ocultarLink = false, empresaInicial, emailInicial, enviar, cabecalho, children,
}: {
  disponivel: boolean;
  /** Esconde o link "Esqueci a senha" (conta bloqueada: o botão "Recuperar a senha" já abre o painel). */
  ocultarLink?: boolean;
  empresaInicial?: string;
  /** E-mail já digitado no login: vai só por props (estado do cliente), nunca por URL ou storage. */
  emailInicial?: string;
  enviar?: EnviarEsqueci;
  /** Título único da tela (h1): recebe se o painel está aberto, para trocar "Acesse sua conta" por "Recuperar a senha". */
  cabecalho?: (painelAberto: boolean) => ReactNode;
  /** Função: recebe `abrir`, que abre o painel (usada pelo "Recuperar a senha" da conta bloqueada). */
  children: ReactNode | ((abrir: () => void) => ReactNode);
}) {
  const [aberto, setAberto] = useState(false);
  const link = useRef<HTMLButtonElement | null>(null);
  const veioDoPainel = useRef(false);
  useEffect(() => {
    if (!aberto && veioDoPainel.current) link.current?.focus();
  }, [aberto]);
  if (aberto && disponivel) {
    return (
      <>
        {cabecalho?.(true)}
        <EsqueciSenha empresaInicial={empresaInicial} emailInicial={emailInicial} enviar={enviar} aoVoltar={() => { veioDoPainel.current = true; setAberto(false); }} />
      </>
    );
  }
  return (
    <>
      {cabecalho?.(false)}
      {typeof children === 'function' ? children(() => setAberto(true)) : children}
      {disponivel && !ocultarLink && (
        <BotaoLink texto={T.titulo} aoClicar={() => setAberto(true)} refBotao={link} />
      )}
    </>
  );
}
