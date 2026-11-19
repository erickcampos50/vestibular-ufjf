#!/usr/bin/env node
/**
 * Gera a versão do snapshot consumida pelo front.
 *
 * O snapshot bruto (data/candidatos.json) guarda tudo que a origem oferece,
 * inclusive o CPF mascarado e o texto integral da situação — dados que o
 * protótipo não exibe (LGPD) e que só aumentam o payload.
 *
 * Saída: web/public/data/candidatos.json
 *   - sem CPF
 *   - situação reduzida a { convocado, data }
 *
 * Uso: node scripts/preparar-dados.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ORIGEM = path.resolve('data/candidatos.json');
const DESTINO = path.resolve('web/public/data/candidatos.json');

const bruto = JSON.parse(fs.readFileSync(ORIGEM, 'utf8'));

const candidatos = bruto.candidatos.map((c) => ({
  e: c.e,
  c: c.c,
  t: c.t,
  ca: c.ca,
  g: c.g,
  url: c.url,
  cl: c.cl,
  n: c.n,
  p: c.p,
  cv: c.cv ? 1 : 0,
  s: c.s,
  sd: c.sd ?? null,
}));

const payload = {
  geradoEm: bruto.geradoEm,
  fonte: bruto.fonte,
  edicoes: bruto.edicoes,
  total: candidatos.length,
  candidatos,
};

fs.mkdirSync(path.dirname(DESTINO), { recursive: true });
fs.writeFileSync(DESTINO, JSON.stringify(payload), 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log('origem :', kb(fs.statSync(ORIGEM).size));
console.log('destino:', kb(fs.statSync(DESTINO).size));
console.log('registros:', candidatos.length);
