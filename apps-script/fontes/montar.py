"""Gera apps-script/Index.html (arquivo único) a partir de Index.base.html, Styles.html e App.html.

No Apps Script basta ter dois arquivos: code.gs e Index.html.
Rode: python3 apps-script/fontes/montar.py
"""
import os, re
d = os.path.dirname(os.path.abspath(__file__))
base = open(os.path.join(d, 'Index.base.html'), encoding='utf-8').read()
partes = {n: open(os.path.join(d, n + '.html'), encoding='utf-8').read().rstrip('\n') for n in ('Styles', 'App')}
saida = re.sub(r"<\?!= include\('(\w+)'\); \?>", lambda m: partes[m.group(1)], base)
assert '<?' not in saida, 'sobrou scriptlet no Index'
open(os.path.join(d, '..', 'Index.html'), 'w', encoding='utf-8').write(saida)
print('Index.html gerado:', saida.count('\n') + 1, 'linhas')
