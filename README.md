# brazil-elections

Mapa de calor de la apuración presidencial de Brasil 2026 (1er turno): `index.html`.

`.github/workflows/update.yml` corre `scripts/update.mjs` cada 15 minutos: baja los JSON del TSE
(`https://resultados.tse.jus.br/oficial/ele2026/6257/dados/{uf}/{uf}-c0001-e006257-u.json`, `br` + 27 UF).
Si los datos cambiaron reescribe el bloque `DATA:START … DATA:END` de `index.html`; si no, solo actualiza
la fecha de última verificación (`META.chk`).

Publicado con GitHub Pages (Settings → Pages → Source: GitHub Actions): https://jagoss.github.io/brazil-elections/
