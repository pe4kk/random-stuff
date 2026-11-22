"""Transforme dist/index.html en page publiable comme Artifact (sans doctype/html/head/body)."""
import re, sys, pathlib
src = pathlib.Path('dist/index.html').read_text(encoding='utf-8')
out = re.sub(r'<!doctype html>\s*', '', src, flags=re.I)
out = re.sub(r'</?html[^>]*>\s*', '', out, flags=re.I)
out = re.sub(r'</?head>\s*', '', out, flags=re.I)
out = re.sub(r'</?body>\s*', '', out, flags=re.I)
out = re.sub(r'<meta charset[^>]*>\s*', '', out, flags=re.I)
out = re.sub(r'<meta name="viewport"[^>]*>\s*', '', out, flags=re.I)
# le <title> en tête de fichier
m = re.search(r'<title>.*?</title>', out)
out = m.group(0) + '\n' + out.replace(m.group(0), '', 1)
dst = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'dist/artifact.html')
dst.write_text(out, encoding='utf-8')
print(dst, len(out))
