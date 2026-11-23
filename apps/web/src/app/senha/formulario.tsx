'use client';
import { FormularioTrocaSenha } from '@/components/formulario-troca-senha';
import { trocarSenhaBkoAction } from './acoes';

export function FormularioSenhaBko({ destino }: { destino: string }) {
  return <FormularioTrocaSenha acao={trocarSenhaBkoAction} destino={destino} />;
}
