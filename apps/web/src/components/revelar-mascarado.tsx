'use client';
import { useState, useTransition } from 'react';
import type { Resultado } from '@/lib/config/executar';
import { AUSENTE } from '@/lib/config/empresa';

interface Props {
  /** Texto de acessibilidade do botão: "Mostrar <rotulo>" (ex.: "e-mail", "telefone"). */
  rotulo: string;
  /** O valor que o banco já mascarou. */
  mascarado: string;
  /** Busca o valor completo (ação de servidor, auditada pela API). */
  revelar: () => Promise<Resultado<string | null>>;
}

/**
 * Dado pessoal mascarado com o "Mostrar"/"Ocultar" (e-mail do 1º admin, e-mail e telefone da ficha da Receita). O valor mostrado
 * fica só no estado desta tela: nunca em URL, armazenamento ou log (LGPD, ADR 0012).
 */
export function RevelarMascarado({ rotulo, mascarado, revelar }: Props) {
  const [valor, setValor] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();
  const alternar = () => {
    if (valor !== null) return setValor(null);
    setErro('');
    iniciar(async () => {
      const r = await revelar();
      if (r.ok) setValor(r.valor ?? AUSENTE);
      else setErro(r.erro);
    });
  };
  const acao = valor !== null ? 'Ocultar' : 'Mostrar';
  return (
    <>
      <span className="valor-mascarado">{valor ?? mascarado}</span>{' '}
      <button className="mx-botao-secundario" type="button" disabled={pendente} aria-pressed={valor !== null} aria-label={`${acao} ${rotulo}`} onClick={alternar}>
        {pendente ? 'Carregando…' : acao}
      </button>
      {erro && <span className="erro-campo" role="alert"> {erro}</span>}
    </>
  );
}
