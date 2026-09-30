"""
GÉNÉRATEUR DES MODÈLES DE PAPIER À MUSIQUE « CALIBRÉ »

Chaque modèle est un PDF à importer sur la reMarkable 2, accompagné d'un
fichier JSON qui dit où se trouve chaque ligne de chaque portée. C'est ce
JSON qui rendra la lecture possible : une tête de note dessinée sur la
tablette a des coordonnées, les lignes ont des coordonnées connues, la
hauteur de la note s'en déduit sans rien interpréter.

POURQUOI DES PIXELS DE LA TABLETTE. Tout est calculé dans l'espace de
l'écran de la reMarkable 2 : 1404 × 1872 pixels à 226 ppp, origine en haut
à gauche. Le PDF a exactement ce format (157,2 × 209,6 mm) : la tablette
l'affiche sans marge ni mise à l'échelle, et un pixel du JSON est un pixel
de l'écran. Un PDF au format A4 serait réduit pour tenir, et toutes les
coordonnées seraient à recalculer.

    pip install -r outils/requirements.txt
    python outils/generer_modeles.py

Écrit dans modeles/ : <id>.pdf (12 pages identiques), <id>.json (la
calibration) et apercu/<id>.svg (la première page, pour la documentation).
"""
import json
from dataclasses import dataclass
from pathlib import Path

from reportlab.pdfgen import canvas

from glyphes_bravura import GLYPHES

VERSION = 1

# --- L'écran de la reMarkable 2 ---------------------------------------------
LARGEUR, HAUTEUR = 1404, 1872           # pixels
PPP = 226                                # pixels par pouce
PT = 72 / PPP                            # un pixel, en points PDF

# --- Marges (pixels) ---------------------------------------------------------
# En haut, le bouton rond du menu de la tablette occupe le coin gauche
# (environ 120 px) : rien n'est imprimé dessous. En bas, la ligne qui
# identifie le modèle.
MARGE_HAUT = 150
MARGE_BAS = 120
X_DEBUT = 80                             # début des lignes de portée
X_FIN = LARGEUR - 60                     # fin des lignes de portée

PAGES = 12

# Gris des éléments imprimés : assez présent pour guider la main, assez
# clair pour que l'encre reste nettement au-dessus à l'œil.
GRIS = (0.55, 0.55, 0.55)             # lignes et barres
GRIS_SIGNES = (0.65, 0.65, 0.65)      # clés et accolade, un cran plus clairs
GRIS_TEXTE = (0.6, 0.6, 0.6)
EPAISSEUR_LIGNE = 2.0                    # pixels

# Hauteur de la note posée sur la ligne du bas, pour chaque clé.
LIGNE_DU_BAS = {"sol": "mi4", "fa": "sol2"}


@dataclass(frozen=True)
class Modele:
    ident: str
    titre: str
    genre: str                           # "melodie" ou "piano"
    interligne: int                      # pixels entre deux lignes
    blocs: int                           # portées (mélodie) ou systèmes (piano)
    ecart_mains: float = 4.0             # piano : écart entre les deux portées, en interlignes


MODELES = [
    Modele("melodie-large", "Mélodie, large", "melodie", interligne=40, blocs=5),
    Modele("melodie-standard", "Mélodie, standard", "melodie", interligne=32, blocs=7),
    Modele("piano-large", "Piano, large", "piano", interligne=36, blocs=3, ecart_mains=4.0),
    Modele("piano-standard", "Piano, standard", "piano", interligne=28, blocs=4, ecart_mains=3.5),
]


def mise_en_page(m: Modele) -> dict:
    """Position de chaque ligne de chaque portée, en pixels de l'écran.

    Les blocs sont répartis à intervalles égaux : un demi-écart au-dessus du
    premier, un demi-écart sous le dernier. Ce qui reste entre deux blocs
    accueille lignes supplémentaires, hampes et nuances.
    """
    haut_portee = 4 * m.interligne
    if m.genre == "melodie":
        haut_bloc = haut_portee
        cles = ["sol"]
    else:
        haut_bloc = 2 * haut_portee + m.ecart_mains * m.interligne
        cles = ["sol", "fa"]
    dispo = HAUTEUR - MARGE_HAUT - MARGE_BAS
    ecart = (dispo - m.blocs * haut_bloc) / m.blocs
    systemes = []
    for b in range(m.blocs):
        haut = MARGE_HAUT + ecart / 2 + b * (haut_bloc + ecart)
        portees = []
        for k, cle in enumerate(cles):
            y0 = haut + k * (haut_portee + m.ecart_mains * m.interligne)
            portees.append({
                "cle": cle,
                "ligne_du_bas": LIGNE_DU_BAS[cle],
                "lignes": [round(y0 + i * m.interligne, 1) for i in range(5)],
            })
        systemes.append({"portees": portees})
    return {
        "modele": m.ident,
        "titre": m.titre,
        "version": VERSION,
        "page": {
            "largeur": LARGEUR,
            "hauteur": HAUTEUR,
            "unite": "pixel de l'écran de la reMarkable 2 (226 ppp), origine en haut à gauche, y vers le bas",
        },
        "interligne": m.interligne,
        "ecart_entre_blocs": round(ecart, 1),
        "x_debut": X_DEBUT,
        "x_fin": X_FIN,
        # Au-delà de cette abscisse commence ce que tu écris (armure, chiffrage, notes).
        "x_apres_cle": X_DEBUT + round(3.2 * m.interligne),
        "systemes": systemes,
        "a_verifier": (
            "Dans les fichiers .rm v6, l'abscisse des traits semble centrée sur la page "
            "(x_page = x_rm + 702). À confirmer sur la première page écrite."
        ),
    }


# --- Dessin ------------------------------------------------------------------

def tracer_glyphe(c: canvas.Canvas, nom: str, x: float, y: float, echelle: float, etirement: float = 1.0) -> None:
    """Dessine un signe Bravura avec son origine en (x, y), en pixels.

    `echelle` convertit les unités de la police en pixels ; `etirement`
    allonge verticalement (pour l'accolade, qui doit couvrir deux portées).
    """
    c.saveState()
    c.translate(x, y)
    c.scale(echelle, -echelle * etirement)   # la police a son y vers le haut
    p = c.beginPath()
    for op, v in GLYPHES[nom]:
        if op == "moveTo":
            p.moveTo(*v)
        elif op == "lineTo":
            p.lineTo(*v)
        elif op == "curveTo":
            p.curveTo(*v)
        elif op == "closePath":
            p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.restoreState()


def dessiner_page(c: canvas.Canvas, m: Modele, cal: dict, page: int) -> None:
    c.saveState()
    # On travaille en pixels de l'écran, y vers le bas, comme le JSON.
    c.translate(0, HAUTEUR * PT)
    c.scale(PT, -PT)
    c.setStrokeColorRGB(*GRIS)
    c.setFillColorRGB(*GRIS_SIGNES)
    c.setLineWidth(EPAISSEUR_LIGNE)
    echelle = m.interligne / 250             # SMuFL : 1 interligne = 250 unités
    for systeme in cal["systemes"]:
        portees = systeme["portees"]
        for portee in portees:
            for y in portee["lignes"]:
                c.line(X_DEBUT, y, X_FIN, y)
            lignes = portee["lignes"]
            x_cle = X_DEBUT + 0.5 * m.interligne
            if portee["cle"] == "sol":
                tracer_glyphe(c, "cle_sol", x_cle, lignes[3], echelle)   # posée sur la ligne du sol
            else:
                tracer_glyphe(c, "cle_fa", x_cle, lignes[1], echelle)    # posée sur la ligne du fa
        haut = portees[0]["lignes"][0]
        bas = portees[-1]["lignes"][-1]
        # Barre de début de système et barre de fin, sur toute la hauteur.
        c.line(X_DEBUT, haut, X_DEBUT, bas)
        c.line(X_FIN, haut, X_FIN, bas)
        if len(portees) == 2:
            # L'accolade du piano : le glyphe fait une portée de haut, on l'étire.
            hauteur_systeme = bas - haut
            etirement = hauteur_systeme / (4 * m.interligne)
            tracer_glyphe(c, "accolade", X_DEBUT - 0.9 * m.interligne, bas, echelle, etirement)
    # Pied de page : de quoi reconnaître le modèle d'un coup d'œil.
    c.restoreState()
    c.setFillColorRGB(*GRIS_TEXTE)
    c.setFont("Helvetica", 7)
    c.drawString(X_DEBUT * PT, 50 * PT, f"Portée · {m.titre} · modèle v{VERSION}")
    c.drawRightString(X_FIN * PT, 50 * PT, f"{page} / {PAGES}")


def ecrire_pdf(m: Modele, cal: dict, chemin: Path) -> None:
    c = canvas.Canvas(str(chemin), pagesize=(LARGEUR * PT, HAUTEUR * PT), invariant=1)
    c.setTitle(f"Portée — {m.titre}")
    c.setAuthor("Portée")
    # Le sujet identifie le modèle : l'outil le relira dans le PDF que
    # contient chaque document téléchargé depuis la tablette.
    c.setSubject(f"portee:{m.ident}:v{VERSION}")
    for page in range(1, PAGES + 1):
        dessiner_page(c, m, cal, page)
        c.showPage()
    c.save()


def chemin_svg(nom: str, x: float, y: float, echelle: float, etirement: float = 1.0) -> str:
    d = []
    for op, v in GLYPHES[nom]:
        pts = [f"{v[i]:g},{v[i + 1]:g}" for i in range(0, len(v), 2)]
        d.append({"moveTo": "M", "lineTo": "L", "curveTo": "C", "closePath": "Z"}[op] + " ".join(pts))
    return (f'<path transform="translate({x:g} {y:g}) scale({echelle:g} {-echelle * etirement:g})" '
            f'd="{"".join(d)}"/>')


def ecrire_svg(m: Modele, cal: dict, chemin: Path) -> None:
    """Aperçu de la première page, en currentColor pour suivre le thème."""
    echelle = m.interligne / 250
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {LARGEUR} {HAUTEUR}" '
             f'role="img" aria-label="Modèle {m.titre}">',
             f'<g stroke="currentColor" stroke-width="{EPAISSEUR_LIGNE}" fill="currentColor">']
    for systeme in cal["systemes"]:
        portees = systeme["portees"]
        for portee in portees:
            for y in portee["lignes"]:
                parts.append(f'<line x1="{X_DEBUT}" y1="{y}" x2="{X_FIN}" y2="{y}"/>')
            lignes = portee["lignes"]
            x_cle = X_DEBUT + 0.5 * m.interligne
            if portee["cle"] == "sol":
                parts.append(chemin_svg("cle_sol", x_cle, lignes[3], echelle))
            else:
                parts.append(chemin_svg("cle_fa", x_cle, lignes[1], echelle))
        haut, bas = portees[0]["lignes"][0], portees[-1]["lignes"][-1]
        parts.append(f'<line x1="{X_DEBUT}" y1="{haut}" x2="{X_DEBUT}" y2="{bas}"/>')
        parts.append(f'<line x1="{X_FIN}" y1="{haut}" x2="{X_FIN}" y2="{bas}"/>')
        if len(portees) == 2:
            etirement = (bas - haut) / (4 * m.interligne)
            parts.append(chemin_svg("accolade", X_DEBUT - 0.9 * m.interligne, bas, echelle, etirement))
    parts.append("</g></svg>")
    chemin.write_text("\n".join(parts) + "\n", encoding="utf-8")


def main() -> None:
    racine = Path(__file__).resolve().parent.parent / "modeles"
    (racine / "apercu").mkdir(parents=True, exist_ok=True)
    for m in MODELES:
        cal = mise_en_page(m)
        (racine / f"{m.ident}.json").write_text(json.dumps(cal, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        ecrire_pdf(m, cal, racine / f"{m.ident}.pdf")
        ecrire_svg(m, cal, racine / "apercu" / f"{m.ident}.svg")
        print(f"{m.ident}: {m.blocs} {'portées' if m.genre == 'melodie' else 'systèmes'}, "
              f"interligne {m.interligne} px ({m.interligne / PPP * 25.4:.1f} mm), "
              f"écart entre blocs {cal['ecart_entre_blocs']} px ({cal['ecart_entre_blocs'] / m.interligne:.1f} interlignes)")


if __name__ == "__main__":
    main()
