"""
Extrait de la police Bravura les trois dessins imprimés sur les modèles :
la clé de sol, la clé de fa et l'accolade du piano.

POURQUOI UN FICHIER GÉNÉRÉ. Le générateur de modèles ne doit dépendre ni de
la police ni de fontTools : il lit les contours déjà extraits dans
glyphes_bravura.py. Ce script ne sert qu'à refaire ce fichier, par exemple
pour ajouter un signe. Il n'a besoin de tourner qu'une fois.

    pip install fonttools==4.60.1
    python outils/extraire_glyphes.py chemin/vers/Bravura.otf

Bravura : https://github.com/steinbergmedia/bravura (SIL Open Font License
1.1, voir LICENCE-Bravura-OFL.txt). C'est une police SMuFL : un cadratin
(1000 unités) vaut exactement la hauteur d'une portée, soit 4 interlignes,
et l'origine de chaque clé est posée sur sa ligne de référence (la ligne du
sol pour la clé de sol, celle du fa pour la clé de fa). C'est ce qui permet
de placer les clés au pixel près sans rien mesurer.
"""
import sys
from pathlib import Path

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

SIGNES = {
    "cle_sol": 0xE050,  # gClef
    "cle_fa": 0xE062,   # fClef
    "accolade": 0xE000, # brace (une portée de haut ; on l'étire)
}


def main(chemin_police: str) -> None:
    police = TTFont(chemin_police)
    cmap = police.getBestCmap()
    glyphes = police.getGlyphSet()
    lignes = [
        '"""Contours extraits de Bravura (SIL OFL 1.1) par extraire_glyphes.py.',
        "",
        "Fichier généré : ne pas modifier à la main. Unités de la police",
        "(1000 = hauteur d'une portée), axe des y vers le haut.",
        '"""',
        "",
        "GLYPHES = {",
    ]
    for nom, point_code in SIGNES.items():
        stylo = RecordingPen()
        glyphes[cmap[point_code]].draw(stylo)
        ops = []
        for op, pts in stylo.value:
            coords = [round(v, 1) for p in pts for v in p]
            ops.append((op, coords))
        lignes.append(f"    {nom!r}: {ops!r},")
    lignes.append("}")
    sortie = Path(__file__).with_name("glyphes_bravura.py")
    sortie.write_text("\n".join(lignes) + "\n", encoding="utf-8")
    print(f"écrit : {sortie}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "Bravura.otf")
