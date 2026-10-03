---
title: Prova di fedeltà
tags: [test, markdown]
---

# Titolo principale

Paragrafo con **grassetto**, *corsivo*, ***entrambi***, ~~barrato~~, `codice` e ==evidenziato==.
Seconda riga dello stesso paragrafo.

Riga con a capo forzato  
continua qui.

## Elenchi

- primo
- secondo
  - annidato
  - altro annidato
- terzo

1. uno
2. due
3. tre

- [ ] da fare
- [x] fatto

## Immagini e link

![Foto del mare](assets/mare.png)

Un'immagine in riga ![icona](img/icona.png "Titolo") nel testo.

[Link con titolo](https://esempio.it "Il titolo") e <https://autolink.it>.

Link a riferimento [qui][rif].

[rif]: https://riferimento.it

## Tabella

| Sinistra | Centro | Destra |
| :--- | :---: | ---: |
| a | b | c |
| 1 | 2 | 3 |

## Codice

```python
def ciao():
    print("ciao")
```

> Citazione
> su due righe
>
> > annidata

---

Formula $a^2 + b^2 = c^2$ in riga.

$$
\sum_{i=1}^n i = \frac{n(n+1)}{2}
$$

Nota a piè di pagina[^1].

[^1]: Il testo della nota.

<!-- commento HTML -->

<div align="center">HTML grezzo</div>

Wikilink di Obsidian [[Altra nota]] e #etichetta.

Caratteri speciali: 5 * 3 = 15, prezzo 10$ e 20$, percorso C:\Users\nome, 2 < 3 > 1, a_b_c.
