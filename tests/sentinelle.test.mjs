/**
 * La sentinelle du connecteur (C4) : son script tourne pour de vrai, sous
 * bash, avec un faux curl. Elle doit échouer quand le connecteur ne répond
 * pas, et ne jamais afficher ni l'adresse (elle porte la clé) ni la réponse
 * (les noms des documents) : les journaux d'Actions sont publics.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const FLUX = fs.readFileSync(".github/workflows/sentinelle.yml", "utf8");

/** Le script de l'étape (le bloc « run: | »), sans son retrait. */
function scriptDeLEtape(texte) {
  const lignes = texte.split("\n");
  const i = lignes.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  const retrait = lignes[i + 1].match(/^\s*/)[0].length;
  const bloc = [];
  for (const l of lignes.slice(i + 1)) {
    if (l.trim() && l.match(/^\s*/)[0].length < retrait) break;
    bloc.push(l.slice(retrait));
  }
  return bloc.join("\n");
}

const outillage = os.platform() !== "win32" && spawnSync("bash", ["-c", "command -v jq"]).status === 0;

test("la sentinelle : chaque lundi à 6 h 47, à la main aussi, sans aucun droit", () => {
  assert.match(FLUX, /cron: "47 6 \* \* 1"/);
  assert.match(FLUX, /workflow_dispatch:/);
  assert.match(FLUX, /^permissions: \{\}$/m);
  assert.match(FLUX, /60 jours/);
  // Les secrets ne vivent que dans l'env de l'étape, jamais dans celui du job ou du flux.
  assert.equal((FLUX.match(/secrets\.PORTEE_CLE/g) || []).length, 1);
  assert.doesNotMatch(FLUX, /^env:/m);
  assert.doesNotMatch(FLUX, /^ {4}env:/m);
  assert.doesNotMatch(scriptDeLEtape(FLUX), /set -x|curl -sS|--verbose|cat "\$corps"/);
});

test("la sentinelle échoue quand il faut, et ne montre ni l'adresse ni la réponse", { skip: !outillage && "bash ou jq absent" }, () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), "sentinelle-"));
  try {
    // Un faux curl : il écrit la réponse prévue dans le fichier de -o, note
    // ses arguments, et affiche le statut prévu (000 : pas de réponse).
    fs.writeFileSync(path.join(dossier, "curl"), [
      "#!/bin/bash",
      'printf "%s\\n" "$@" > "$FAUX_ARGUMENTS"',
      'sortie=""',
      'while [ $# -gt 0 ]; do case "$1" in -o) sortie="$2"; shift 2;; *) shift;; esac; done',
      'printf "%s" "$FAUX_CORPS" > "$sortie"',
      'printf "%s" "$FAUX_STATUT"',
      '[ "$FAUX_STATUT" = "000" ] && exit 7',
      "exit 0",
    ].join("\n"), { mode: 0o755 });
    const script = scriptDeLEtape(FLUX);
    const CLE = "cle-secrete-de-la-sentinelle-0123456789";
    const lancer = (statut, corps, { cle = CLE } = {}) => {
      const r = spawnSync("bash", ["-c", script], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${dossier}:${process.env.PATH}`, PORTEE_CLE: cle, SUPABASE_PROJET: "projet-d-essai", FAUX_STATUT: statut, FAUX_CORPS: corps, FAUX_ARGUMENTS: path.join(dossier, "arguments") },
      });
      const sortie = r.stdout + r.stderr;
      // Ce qui s'afficherait dans le journal public : ni la clé, ni le projet, ni un nom de document.
      for (const interdit of [CLE, "projet-d-essai", "Mon carnet secret"]) assert.ok(!sortie.includes(interdit), `« ${interdit} » affiché : ${sortie}`);
      return { code: r.status, sortie };
    };
    const reponse = (resultat) => JSON.stringify({ jsonrpc: "2.0", id: 1, ...resultat });

    let r = lancer("200", reponse({ result: { content: [{ type: "text", text: "Mon carnet secret" }], structuredContent: { connectee: true, noeuds: [{ nom: "Mon carnet secret" }] } } }));
    assert.equal(r.code, 0, r.sortie);
    // Le bon appel, à la bonne adresse.
    const args = fs.readFileSync(path.join(dossier, "arguments"), "utf8");
    assert.ok(args.includes(`https://projet-d-essai.supabase.co/functions/v1/portee-remarkable/${CLE}`));
    assert.match(args, /"name":"arborescence"/);
    // Tablette plus reliée : un avertissement, pas un échec (le connecteur, lui, répond).
    r = lancer("200", reponse({ result: { structuredContent: { connectee: false, raison: "revoquee" } } }));
    assert.equal(r.code, 0);
    assert.match(r.sortie, /::warning::/);
    // Les échecs.
    for (const [statut, corps] of [
      ["200", reponse({ result: { isError: true, content: [{ type: "text", text: "Mon carnet secret" }] } })],
      ["200", reponse({ error: { code: -32602, message: "Mon carnet secret" } })],
      ["200", "pas du JSON"],
      ["503", ""],
      ["404", "Introuvable"],
      ["000", ""],
    ]) {
      r = lancer(statut, corps);
      assert.equal(r.code, 1, `${statut} ${corps}`);
      assert.match(r.sortie, /::error::/);
    }
    assert.match(lancer("503", "").sortie, /HTTP 503/);
    // Sans secret : un échec qui le dit.
    r = lancer("200", reponse({ result: {} }), { cle: "" });
    assert.equal(r.code, 1);
    assert.match(r.sortie, /PORTEE_CLE/);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});
