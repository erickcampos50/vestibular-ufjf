#!/usr/bin/env node
/**
 * Extrai as listas de espera do CDARA/UFJF (PISM, SiSU, SiSU Mais) e gera um
 * snapshot JSON normalizado para o protótipo de busca por nome.
 *
 * Contrato dos endpoints: docs/mapeamento-endpoints.md (§4).
 *
 * Uso:
 *   node scripts/scrape-cdara.mjs [saida.json]
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? path.resolve('data/candidatos.json');
const SQ = String.fromCharCode(39);          // '
const MARK = 'window.location=' + SQ;

const EDICOES = [
  {
    id: 'pism-2026',
    processo: 'PISM',
    rotulo: 'PISM 2026',
    url: 'https://www2.ufjf.br/cdara/graduacao/matricula-graduacao/pism-vestibular/lista-de-espera-pism-3/',
  },
  {
    id: 'sisu-2026',
    processo: 'SISU',
    rotulo: 'SiSU 2026',
    url: 'https://www2.ufjf.br/cdara/graduacao/matricula-graduacao/sisu/lista-de-espera-sisu/',
  },
  {
    id: 'sisu-mais-2026',
    processo: 'SISU MAIS',
    rotulo: 'SiSU Mais 2026',
    url: 'https://www2.ufjf.br/cdara/graduacao/matricula-graduacao/pism-vestibular/lista-de-espera-pism-5/lista-de-espera-sisu-mais/',
  },
];

const CONCURRENCY = 6;

// ---------- utilidades de parsing (validadas contra o HTML real) ----------

const ENTIDADES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '-',
  mdash: '-',
  hellip: '…',
  ordm: 'º',
  ordf: 'ª',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  atilde: 'ã',
  otilde: 'õ',
  ccedil: 'ç',
  acirc: 'â',
  ecirc: 'ê',
  ocirc: 'ô',
  agrave: 'à',
  uuml: 'ü',
};

const limpar = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    // entidades numéricas (decimais e hexadecimais)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    // entidades nomeadas mais comuns no HTML da origem
    .replace(/&([a-z]+);/gi, (bruto, nome) => ENTIDADES[nome.toLowerCase()] ?? bruto)
    .replace(/\s+/g, ' ')
    .trim();

function celulas(html) {
  const out = [];
  let i = 0;
  while ((i = html.indexOf('<td', i)) > -1) {
    const open = html.indexOf('>', i) + 1;
    const close = html.indexOf('</td>', open);
    if (close < 0) break;
    out.push(limpar(html.slice(open, close)));
    i = close;
  }
  return out;
}

/** Lê a tabela #tblCursosEspera (índice curso × grupo). */
function parseCursos(html, baseUrl) {
  const rows = [];
  let i = 0;
  while ((i = html.indexOf('<tr', i)) > -1) {
    const tagEnd = html.indexOf('>', i);
    const openTag = html.slice(i, tagEnd + 1);
    if (openTag.includes(MARK)) {
      const qs = i + openTag.indexOf(MARK) + MARK.length;
      const qe = html.indexOf(SQ, qs);
      const query = html.slice(qs, qe);
      const bodyEnd = html.indexOf('</tr>', qe);
      const cells = celulas(html.slice(qe, bodyEnd));
      const p = new URLSearchParams(query.replace(/&amp;/g, '&'));
      rows.push({
        curso: cells[0] ?? '',
        turno: cells[1] ?? '',
        grupo: cells[2] ?? '',
        campus: cells[3] ?? '',
        query: p,
        url: baseUrl + '?' + p.toString(),
      });
    }
    i = tagEnd;
  }
  return rows;
}

/** Lê a tabela #tblEsperaCandidatos da view esperacandidatos. */
function parseCandidatos(html) {
  const ini = html.indexOf('INICIO DO TEMPLATE');
  if (ini < 0) return null;
  const fim = html.indexOf('FIM DO TEMPLATE', ini);
  const bloco = html.slice(ini, fim < 0 ? undefined : fim);
  if (!bloco.includes('tblEsperaCandidatos')) return null;

  const out = [];
  let i = bloco.indexOf('</thead>');
  while ((i = bloco.indexOf('<tr class="disciplinas">', i)) > -1) {
    const close = bloco.indexOf('</tr>', i);
    const cells = celulas(bloco.slice(i, close));
    if (cells.length >= 5) out.push(cells);
    i = close;
  }
  return out;
}

const num = (s) => {
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const situacao = (s) => {
  const m = /CONVOCADO PELO EDITAL PUBLICADO EM (\d{2}\/\d{2}\/\d{4})/i.exec(s);
  if (m) {
    const [d, mth, y] = m[1].split('/');
    return { texto: s, convocado: true, data: `${y}-${mth}-${d}` };
  }
  return { texto: s, convocado: false, data: null };
};

// ------------------------------- rede -------------------------------

async function buscar(url, tentativas = 3) {
  let erro;
  for (let t = 1; t <= tentativas; t++) {
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': 'portal-matricula-ufjf/0.1 (prototipo; contato: cdara)',
          accept: 'text/html',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      erro = e;
      await new Promise((r) => setTimeout(r, 400 * t));
    }
  }
  throw erro;
}

async function emLotes(itens, limite, fn, rotulo) {
  let feito = 0;
  const fila = [...itens];
  const workers = Array.from({ length: limite }, async () => {
    while (fila.length) {
      const item = fila.shift();
      await fn(item);
      feito++;
      if (feito % 50 === 0) process.stdout.write(`  ${rotulo}: ${feito}/${itens.length}\n`);
    }
  });
  await Promise.all(workers);
}

// ------------------------------- main -------------------------------

const candidatos = [];
const edicoes = [];
const erros = [];
const t0 = Date.now();

for (const ed of EDICOES) {
  const html = await buscar(ed.url);
  const cursos = parseCursos(html, ed.url);
  if (!cursos.length) throw new Error(`${ed.rotulo}: índice de cursos vazio ou não reconhecido; extração cancelada.`);
  const anos = [...new Set(cursos.map((c) => c.query.get('ano')))];
  console.log(`\n${ed.rotulo}: ${cursos.length} linhas curso×grupo | ano=${anos.join(',')}`);
  edicoes.push({ id: ed.id, processo: ed.processo, rotulo: ed.rotulo, ano: Number(anos[0]) || null, listaUrl: ed.url });

  let processados = 0;
  await emLotes(
    cursos,
    CONCURRENCY,
    async (c) => {
      let linhas = null;
      try {
        linhas = parseCandidatos(await buscar(c.url));
      } catch (e) {
        erros.push({ url: c.url, erro: String(e) });
      }
      if (!linhas) {
        erros.push({ url: c.url, erro: 'sem template/tabela' });
        return;
      }
      for (const r of linhas) {
        const s = situacao(r[4] ?? '');
        candidatos.push({
          e: ed.id,
          c: c.curso,
          t: c.turno,
          ca: c.campus,
          g: c.grupo,
          url: c.url,
          cl: num(r[0]),
          n: r[1] ?? '',
          cpf: r[2] ?? '',
          p: num(r[3]),
          s: s.texto,
          cv: s.convocado,
          sd: s.data,
        });
      }
      processados++;
    },
    ed.rotulo,
  );
  console.log(`  ${ed.rotulo}: ${processados}/${cursos.length} listas lidas`);
}

const payload = {
  geradoEm: new Date().toISOString(),
  fonte: 'https://www2.ufjf.br/cdara/graduacao/matricula-graduacao/',
  edicoes,
  total: candidatos.length,
  candidatos,
};

if (erros.length || !candidatos.length) {
  console.error(`Extração incompleta (${erros.length} falhas); snapshot anterior preservado.`);
  for (const e of erros.slice(0, 10)) console.error(e.erro, e.url);
  process.exit(1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(payload), 'utf8');

const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`\n✓ ${candidatos.length} candidatos de ${edicoes.length} edições`);
console.log(`✓ ${OUT} (${kb} KB) em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
