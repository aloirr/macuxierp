import { afterEach } from 'vitest';

// T-0073: o psql roda com spawnSync (src/psql.ts) e bloqueia o event loop do worker durante o teste inteiro.
// Sem ceder o loop, a resposta do onTaskUpdate (birpc, 60 s) não é processada e o vitest cai com
// "Timeout calling onTaskUpdate" mesmo com 0 testes falhos. Ceder um tick após cada teste resolve.
afterEach(() => new Promise<void>((r) => setImmediate(r)));
