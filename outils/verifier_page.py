"""
VÉRIFIER UNE PAGE ÉCRITE SUR UN MODÈLE CALIBRÉ

Prend une page exportée en PDF depuis la reMarkable (Partager → PDF, ou
export depuis l'appli ordinateur), retrouve le modèle d'après le sujet du
PDF, repère les têtes de notes pleines et leur donne un nom d'après leur
position sur la portée. Produit une image annotée et un relevé des écarts.

C'est l'outil de l'étape 1 du plan : il répond à la question « tes traits
tombent-ils là où la calibration les attend ? ». Ce n'est pas encore le
lecteur : il ne connaît que les têtes pleines, pas les durées, les silences
ni l'armure.

    pip install -r outils/requirements.txt
    python outils/verifier_page.py tests/pages/2026-09-30-gamme-et-melodie.pdf

POURQUOI L'EXPORT PDF SUFFIT. La tablette n'aplatit pas la page en image :
elle ajoute chaque trait au PDF d'origine sous forme de chemin vectoriel noir,
dans le repère de la page. Les lignes du modèle restent grises. On sépare
donc l'encre du papier par la couleur, et chaque trait garde tous ses points.
"""
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pymupdf

RACINE = Path(__file__).resolve().parent.parent
PX = 226 / 72                    # points PDF → pixels de l'écran de la tablette

NOMS = ["do", "ré", "mi", "fa", "sol", "la", "si"]
# Degré (0 = do) et octave de la note posée sur la ligne du bas.
LIGNE_DU_BAS = {"mi4": (2, 4), "sol2": (4, 2)}


@dataclass
class Trait:
    points: list
    x0: float = field(init=False)
    x1: float = field(init=False)
    y0: float = field(init=False)
    y1: float = field(init=False)
    longueur: float = field(init=False)

    def __post_init__(self):
        xs = [p[0] for p in self.points]
        ys = [p[1] for p in self.points]
        self.x0, self.x1, self.y0, self.y1 = min(xs), max(xs), min(ys), max(ys)
        self.longueur = sum(math.dist(a, b) for a, b in zip(self.points, self.points[1:]))

    @property
    def centre(self):
        return (self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2


def lire_traits(page) -> list:
    """Les traits d'encre de la page, en pixels de l'écran. Le gris du modèle est ignoré."""
    traits = []
    for chemin in page.get_drawings():
        couleur = chemin.get("color")
        if not couleur or max(couleur) > 0.2:
            continue
        pts = []
        for item in chemin["items"]:
            if item[0] == "l":
                pts += [item[1], item[2]]
            elif item[0] == "c":
                pts += [item[1], item[4]]
        if pts:
            traits.append(Trait([(p.x * PX, p.y * PX) for p in pts]))
    return traits


def est_tete_pleine(t: Trait, interligne: float) -> bool:
    """Une tête pleine est un petit gribouillis : compacte, mais très longue à tracer.

    Un accent, un chiffre ou un bémol a la même taille, mais son tracé est
    court. Seuils réglés sur les pages d'essai du 30/09.
    """
    l, h = t.x1 - t.x0, t.y1 - t.y0
    compacte = 0.35 * interligne < l < 1.4 * interligne and 0.35 * interligne < h < 1.4 * interligne
    return compacte and t.longueur > 2.5 * (l + h)


def fusionner(tetes: list, interligne: float) -> list:
    """Réunit les gribouillis qui noircissent la même tête en plusieurs coups de stylo.

    Sur la page de piano du 30/09, presque chaque tête est faite de deux
    traits superposés : sans cette étape, chaque note compterait double.
    """
    groupes = []
    for t in sorted(tetes, key=lambda t: t.x0):
        for g in groupes:
            if math.dist(t.centre, g.centre) < 0.6 * interligne:
                g.points.extend(t.points)
                g.__post_init__()
                break
        else:
            groupes.append(Trait(list(t.points)))
    return groupes


def nom_de_note(ligne_du_bas: str, pas: int) -> str:
    degre0, octave0 = LIGNE_DU_BAS[ligne_du_bas]
    rang = degre0 + pas
    return f"{NOMS[rang % 7]}{octave0 + rang // 7}"


def portees(cal: dict) -> list:
    return [p for s in cal["systemes"] for p in s["portees"]]


def placer(t: Trait, cal: dict):
    """Rattache une tête à la portée la plus proche et calcule sa hauteur."""
    il = cal["interligne"]
    cx, cy = t.centre
    meilleure = min(portees(cal), key=lambda p: abs(cy - (p["lignes"][0] + p["lignes"][-1]) / 2))
    bas = meilleure["lignes"][-1]
    pas_exact = (bas - cy) / (il / 2)          # en demi-interlignes au-dessus de la ligne du bas
    pas = round(pas_exact)
    return meilleure, pas, pas_exact - pas


def verifier(chemin_pdf: Path, sortie_png: Path) -> list:
    doc = pymupdf.open(chemin_pdf)
    sujet = doc.metadata.get("subject", "")
    if not sujet.startswith("portee:"):
        raise SystemExit(f"{chemin_pdf} n'a pas été écrit sur un modèle Portée (sujet : {sujet!r})")
    _, ident, _version = sujet.split(":")
    cal = json.loads((RACINE / "modeles" / f"{ident}.json").read_text(encoding="utf-8"))
    il = cal["interligne"]
    releve = []
    for num, page in enumerate(doc, start=1):
        tetes = fusionner([t for t in lire_traits(page) if est_tete_pleine(t, il)], il)
        for t in sorted(tetes, key=lambda t: (portees(cal).index(placer(t, cal)[0]), t.x0)):
            portee, pas, ecart = placer(t, cal)
            nom = nom_de_note(portee["ligne_du_bas"], pas)
            releve.append({
                "page": num,
                "portee": portees(cal).index(portee) + 1,
                "x": round(t.centre[0]),
                "y": round(t.centre[1], 1),
                "note": nom,
                "ecart_interligne": round(ecart / 2, 2),   # en interlignes
            })
            # Annotation : un cercle bleu et le nom, en points PDF.
            cx, cy = (c / PX for c in t.centre)
            page.draw_circle((cx, cy), il / PX * 0.75, color=(0.17, 0.28, 0.69), width=0.8)
            page.insert_text((cx - 6, cy + il / PX * 1.9), nom, fontsize=6.5, color=(0.17, 0.28, 0.69))
    doc[0].get_pixmap(dpi=150).save(sortie_png)
    return releve


def main() -> None:
    for arg in sys.argv[1:]:
        chemin = Path(arg)
        png = chemin.with_name(chemin.stem + "-verifie.png")
        releve = verifier(chemin, png)
        pire = max((abs(r["ecart_interligne"]) for r in releve), default=0)
        print(f"{chemin.name} : {len(releve)} têtes pleines, écart max {pire:.2f} interligne → {png.name}")
        portee = None
        for r in releve:
            if r["portee"] != portee:
                if portee is not None:
                    print()
                portee = r["portee"]
                print(f"  portée {portee} :", end="")
            print(f" {r['note']}", end="")
            if abs(r["ecart_interligne"]) > 0.15:
                print(f"({r['ecart_interligne']:+.2f})", end="")
        print()


if __name__ == "__main__":
    main()
