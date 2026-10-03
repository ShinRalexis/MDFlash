# Applica sostituzioni testuali: python tools/patch.py <file.json>
# Il JSON è un elenco di {"file": ..., "pairs": [[vecchio, nuovo], ...]}
import json, sys
spec = json.load(open(sys.argv[1], encoding="utf-8"))
bad = 0
for item in spec:
    p = item["file"]
    s = open(p, encoding="utf-8").read()
    for a, b in item["pairs"]:
        if a not in s:
            print("NON TROVATO in", p, ":", a[:90])
            bad += 1
            continue
        s = s.replace(a, b)
    open(p, "w", encoding="utf-8", newline="").write(s)
print("fatto" if not bad else f"{bad} non trovati")
