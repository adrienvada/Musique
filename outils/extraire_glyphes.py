"""
Extrait de la police Bravura les dessins imprimés sur les modèles : la clé
de sol, la clé de fa et l'accolade du piano, et, pour la page d'étalonnage
(L16), les signes qu'elle montre en gris pour guider ta main : silences,
altérations, chiffres du chiffrage, « C » et « C » barré, « 3 » de triolet.

POURQUOI UN FICHIER GÉNÉRÉ. Le générateur de modèles ne doit dépendre ni de
la police ni de fontTools : il lit les contours déjà extraits dans
glyphes_bravura.py. Ce script ne sert qu'à refaire ce fichier, par exemple
pour ajouter un signe.

POURQUOI IL GARDE LES SIGNES DÉJÀ EXTRAITS. Les dessins changent d'une
version de Bravura à l'autre (la 1.392 n'a plus tout à fait la clé de sol
qui est imprimée sur tes modèles). Réextraire un signe déjà imprimé
changerait les PDF, que tu as déjà sur la tablette, et qui doivent rester
identiques à l'octet près. Le script n'ajoute donc que les signes qui
manquent ; `--tout` réextrait tout, et oblige à passer les modèles en
version suivante.

    pip install fonttools==4.60.1
    python outils/extraire_glyphes.py chemin/vers/Bravura.otf [--tout]

Bravura : https://github.com/steinbergmedia/bravura (SIL Open Font License
1.1, voir LICENCE-Bravura-OFL.txt). Les signes de la page d'étalonnage
viennent de la version 1.392. C'est une police SMuFL : un cadratin
(1000 unités) vaut exactement la hauteur d'une portée, soit 4 interlignes,
et l'origine de chaque signe est posée sur sa ligne de référence (la ligne
du sol pour la clé de sol, celle du fa pour la clé de fa, la note pour une
altération). C'est ce qui permet de placer les signes au pixel près sans
rien mesurer.
"""
import importlib.util
import sys
from pathlib import Path

from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont

SIGNES = {
    "cle_sol": 0xE050,  # gClef
    "cle_fa": 0xE062,   # fClef
    "accolade": 0xE000, # brace (une portée de haut ; on l'étire)
    # Page d'étalonnage (L16).
    "soupir": 0xE4E5,         # restQuarter
    "demi_soupir": 0xE4E6,    # rest8th
    "quart_soupir": 0xE4E7,   # rest16th
    "diese": 0xE262,          # accidentalSharp
    "bemol": 0xE260,          # accidentalFlat
    "becarre": 0xE261,        # accidentalNatural
    **{f"chiffre_{k}": 0xE080 + k for k in range(1, 10)},  # timeSig1 à timeSig9
    "mesure_c": 0xE08A,       # timeSigCommon
    "mesure_c_barre": 0xE08B, # timeSigCutCommon
    "triolet_3": 0xE883,      # tuplet3
}

SORTIE = Path(__file__).with_name("glyphes_bravura.py")


def deja_extraits() -> dict:
    """Les contours du fichier actuel, tels quels (rien si on part de zéro)."""
    if not SORTIE.exists():
        return {}
    spec = importlib.util.spec_from_file_location("glyphes_bravura", SORTIE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return dict(module.GLYPHES)


def main(chemin_police: str, tout: bool) -> None:
    police = TTFont(chemin_police)
    cmap = police.getBestCmap()
    glyphes = police.getGlyphSet()
    gardes = {} if tout else deja_extraits()
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
        if nom in gardes:
            ops = gardes[nom]
        else:
            stylo = RecordingPen()
            glyphes[cmap[point_code]].draw(stylo)
            ops = []
            for op, pts in stylo.value:
                coords = [round(v, 1) for p in pts for v in p]
                ops.append((op, coords))
        lignes.append(f"    {nom!r}: {ops!r},")
    lignes.append("}")
    SORTIE.write_text("\n".join(lignes) + "\n", encoding="utf-8")
    print(f"écrit : {SORTIE} ({len(SIGNES) - len(gardes)} signe(s) extrait(s), {len(gardes)} gardé(s) tels quels)")


if __name__ == "__main__":
    arguments = [a for a in sys.argv[1:] if a != "--tout"]
    main(arguments[0] if arguments else "Bravura.otf", "--tout" in sys.argv[1:])
