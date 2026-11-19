import fs from 'node:fs';

const { candidatos } = JSON.parse(fs.readFileSync('data/candidatos.json', 'utf8'));
const exatos = new Map();
const porPessoa = new Map();
for (const c of candidatos) {
  const chave = JSON.stringify(c);
  exatos.set(chave, (exatos.get(chave) ?? 0) + 1);
  const pessoa = JSON.stringify([c.n, c.cpf]);
  const lista = porPessoa.get(pessoa) ?? [];
  lista.push(c);
  porPessoa.set(pessoa, lista);
}
const repetidos = [...porPessoa.values()].filter((lista) => lista.length > 1);
const distintas = (lista, campo) => new Set(lista.map((c) => c[campo])).size > 1;
console.log(JSON.stringify({
  registros: candidatos.length,
  duplicadosExatos: [...exatos.values()].reduce((n, qtd) => n + qtd - 1, 0),
  nomesCpfRepetidos: repetidos.length,
  processosDiferentes: repetidos.filter((lista) => distintas(lista, 'e')).length,
  cursosDiferentes: repetidos.filter((lista) => distintas(lista, 'c')).length,
  gruposDiferentes: repetidos.filter((lista) => distintas(lista, 'g')).length,
  mesmaListaComClassificacoesDiferentes: repetidos.filter((lista) => {
    const porUrl = new Map();
    for (const c of lista) {
      const ranks = porUrl.get(c.url) ?? new Set();
      ranks.add(c.cl);
      porUrl.set(c.url, ranks);
    }
    return [...porUrl.values()].some((ranks) => ranks.size > 1);
  }).length,
}, null, 2));
