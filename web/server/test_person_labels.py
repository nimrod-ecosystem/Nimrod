""""I call them" for everyone on a login, or just for one person on it (Mike, 2026-10-05). The rule, and the routes.

    py -3.13 test_person_labels.py

Mike: *"Maybe there should be an option to set I call them at account vs user levels."* Played as his example: the
parents share one login with Mom and Dad on it, and a card for their daughter. The login calls her "Chrissy"; Dad,
just for himself, calls her "Sweetie". The rule is claims.seen_name (pure); the storage is db.person_labels; the doors
are GET /api/people?viewer= and PUT /api/people/<id>/call-name {viewer}.
"""
import json
import os
import shutil
import sqlite3
import sys
import tempfile

import claims
from claims import seen_name

passed = failed = 0


def check(name, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}   {detail}")


def section(t):
    print(f"\n-- {t}")


# ---------------------------------------------------------------- pure
section("the rule: the looking person's own label, else the login's, else the name on the card")
row = {"id": "c", "name": "Christine", "home_id": None, "call_name": "Chrissy"}
check("*** the looking person's own label first ***", seen_name(row, None, viewer_id="dad", own_label="Sweetie") == "Sweetie")
check("...else the login's", seen_name(row, None, viewer_id="mom", own_label=None) == "Chrissy")
check("...else the name on the card", seen_name({**row, "call_name": ""}, None, viewer_id="mom") == "Christine")
check("no viewer: the login's name, as before (a stray label is not used)",
      seen_name(row, None) == "Chrissy" and seen_name(row, None, own_label="Sweetie") == "Chrissy")
check("*** the looking person's OWN card: the name on it, not the login's label for them ***",
      seen_name(row, None, viewer_id="c") == "Christine" and seen_name(row, None, viewer_id="c", own_label="x") == "Christine")
held = {"id": "h", "name": "Mom", "home_id": "home", "call_name": "Mum"}
check("a card whose profile lives on another login, looked at by its own person: the home's name",
      seen_name(held, "Linda", viewer_id="h") == "Linda" and seen_name(held, "Linda", viewer_id="x") == "Mum")
check("blanks and nothing", seen_name(row, None, viewer_id="dad", own_label="   ") == "Chrissy" and seen_name(None, None) == "")

# ---------------------------------------------------------------- the routes
tmp = tempfile.mkdtemp(prefix="nimrod_labels_")
os.environ["NIMROD_DB"] = os.path.join(tmp, "labels_test.db")
os.environ.pop("DATABASE_URL", None)
os.environ.pop("NIMROD_ENV", None)
from fastapi.testclient import TestClient  # noqa: E402
import app as appmod  # noqa: E402

c = TestClient(appmod.app)
store = appmod.store
PAR, LAB, CHR = "acct-parents", "acct-friend", "acct-daughter"


def H(u):
    return {"X-Dev-User": u}


def people(u, viewer=None):
    q = f"?viewer={viewer}" if viewer else ""
    r = c.get(f"/api/people{q}", headers=H(u))
    return {p["id"]: p for p in r.json()["people"]} if r.status_code == 200 else r.status_code


def label_rows():
    db = sqlite3.connect(os.environ["NIMROD_DB"])
    try:
        return db.execute("SELECT viewer_id, person_id, name FROM person_labels ORDER BY name").fetchall()
    finally:
        db.close()


def put(u, pid, name, viewer=None):
    body = {"name": name, **({"viewer": viewer} if viewer is not None else {})}
    return c.put(f"/api/people/{pid}/call-name", json=body, headers=H(u))


section("(setup) the parents' login: Mom (first), Dad, and a card for their daughter")
mom = c.get("/api/people", headers=H(PAR)).json()["people"][0]["id"]
c.patch(f"/api/people/{mom}", json={"name": "Mom"}, headers=H(PAR))
dad = c.post("/api/people", json={"name": "Dad"}, headers=H(PAR)).json()["id"]
kid = c.post("/api/people", json={"name": "Christine"}, headers=H(PAR)).json()["id"]
check("(setup) three people", len(people(PAR)) == 3)

section("*** everyone on the login, and just Dad ***")
r = put(PAR, kid, "Chrissy")
check("the login's label, as before (no viewer)", r.status_code == 200 and r.json()["call_name"] == "Chrissy"
      and "viewer_call_name" not in r.json(), r.text)
r = put(PAR, kid, "Sweetie", viewer=dad)
check("*** Dad's own label: saved, and what Dad sees; the login's label left as it is ***",
      r.status_code == 200 and r.json() == {"id": kid, "call_name": "Chrissy", "name": "Sweetie", "viewer_call_name": "Sweetie"}, r.text)
pd, pm, pn = people(PAR, dad)[kid], people(PAR, mom)[kid], people(PAR)[kid]
check("*** read as Dad: 'Sweetie', with both labels and the name on the card beside it ***",
      pd["name"] == "Sweetie" and pd["call_name"] == "Chrissy" and pd["viewer_call_name"] == "Sweetie" and pd["profile_name"] == "Christine", str(pd))
check("*** read as Mom: 'Chrissy' - Dad's label is not hers ***",
      pm["name"] == "Chrissy" and pm["viewer_call_name"] == "" and "Sweetie" not in json.dumps(people(PAR, mom)), str(pm))
check("*** read with nobody named (screens' menus, notes, the call page): the login's 'Chrissy', and no per-person field ***",
      pn["name"] == "Chrissy" and "viewer_call_name" not in pn and "Sweetie" not in json.dumps(people(PAR)), str(pn))
check("...and the store's own name for her (screens, notes) is still the login's",
      store.get_person(PAR, kid)["name"] == "Chrissy")

section("*** the person labelled, looking: her own card by the name on it ***")
pk = people(PAR, kid)
check("*** read as her: 'Christine' - not 'Chrissy', not 'Sweetie' - and neither label rides on her own card ***",
      pk[kid]["name"] == "Christine" and pk[kid]["call_name"] == "" and pk[kid]["viewer_call_name"] == ""
      and "Sweetie" not in json.dumps(pk) and "Chrissy" not in json.dumps(pk), str(pk[kid]))
put(PAR, dad, "Pops")
put(PAR, dad, "Daddy", viewer=kid)
check("her own label for Dad shows for her; Mom sees the login's 'Pops'; Dad sees his own name",
      people(PAR, kid)[dad]["name"] == "Daddy" and people(PAR, mom)[dad]["name"] == "Pops" and people(PAR, dad)[dad]["name"] == "Dad")

section("*** who may be the viewer: only one of this login's own people (a security invariant) ***")
lab_me = c.get("/api/people", headers=H(LAB)).json()["people"][0]["id"]
check("*** somebody on another login as the viewer: 404, the same as no such person ***", people(PAR, lab_me) == 404)
check("...a made-up id: 404", people(PAR, "nobody-at-all") == 404)
check("...a malformed one: refused", people(PAR, "bad id!") in (400, 404, 422))
check("*** the other login cannot read the parents' people as Dad ***", people(LAB, dad) == 404)
check("*** a label for another login's person: 404 ***", put(PAR, kid, "x", viewer=lab_me).status_code == 404)
check("...on another login's card: 404", put(PAR, lab_me, "x", viewer=dad).status_code == 404)
check("*** a label on your own card, as yourself: refused (400), in words ***",
      put(PAR, dad, "Me", viewer=dad).status_code == 400 and "own card" in put(PAR, dad, "Me", viewer=dad).json()["detail"])
check("...a name over the limit: refused", put(PAR, kid, "x" * 200, viewer=dad).status_code == 400)
check("nothing was stored by any of those", sorted(n for _, _, n in label_rows()) == ["Daddy", "Sweetie"], str(label_rows()))

section("*** labels stay on the login: another login holding her card sees the name on it ***")
tok = c.post("/api/connect/invites", json={"shares": [mom, kid]}, headers=H(PAR)).json()["token"]
check("(setup) a friend connects, and gets her card", c.post("/api/invites/accept", json={"token": tok}, headers=H(LAB)).status_code == 200)
lp = c.get("/api/people", headers=H(LAB)).json()["people"]
lab_kid = next(p["id"] for p in lp if p["name"] == "Christine")
check("*** on the friend's page she is 'Christine': neither 'Chrissy' nor 'Sweetie' ***",
      "Sweetie" not in json.dumps(lp) and "Chrissy" not in json.dumps(lp), json.dumps(lp))
check("...nor as the friend's own person", "Sweetie" not in json.dumps(people(LAB, lab_me)))
hl = c.get(f"/api/people/{kid}/holders", headers=H(PAR)).json()["holders"]
check("*** her 'Shared with' list names the friend by their own name, with no label in it ***",
      len(hl) == 1 and "Sweetie" not in json.dumps(hl) and "Chrissy" not in json.dumps(hl), str(hl))
pk2 = c.post("/api/invites/peek", json={"token": c.post("/api/connect/invites", json={"shares": [kid]}, headers=H(PAR)).json()["token"]}).json()
check("*** a link's first look names her by the name on her card ***", "Sweetie" not in json.dumps(pk2) and "Chrissy" not in json.dumps(pk2), str(pk2))

section("*** she takes her card over with her own login: her login says her name; Dad still says Sweetie ***")
it = c.post(f"/api/people/{kid}/invites", json={}, headers=H(PAR)).json()["token"]
check("(setup) she takes it over", c.post("/api/invites/accept", json={"token": it}, headers=H(CHR)).status_code == 200)
chr_people = c.get("/api/people", headers=H(CHR)).json()["people"]
check("*** her own login: 'Christine', and no label of the parents' anywhere on it ***",
      chr_people[0]["name"] == "Christine" and "Sweetie" not in json.dumps(chr_people) and "Chrissy" not in json.dumps(chr_people), json.dumps(chr_people))
pdj = people(PAR, dad)[kid]
check("*** on the parents' login, read as Dad, she is still 'Sweetie' (joined), the login's 'Chrissy' kept ***",
      pdj["name"] == "Sweetie" and pdj["kind"] == "joined" and pdj["call_name"] == "Chrissy", str(pdj))
check("...and read as her (her screens on the parents' login): the name she chose", people(PAR, kid)[kid]["name"] == "Christine")

section("*** clearing, and removing a person takes their labels with them ***")
r = put(PAR, kid, "", viewer=dad)
check("*** Dad clears his: he sees the login's 'Chrissy' again; the login's label is untouched ***",
      r.status_code == 200 and r.json()["viewer_call_name"] == "" and r.json()["name"] == "Chrissy"
      and people(PAR, dad)[kid]["name"] == "Chrissy" and people(PAR, mom)[kid]["name"] == "Chrissy", r.text)
put(PAR, kid, "Sweetie", viewer=dad)
put(PAR, mom, "Honey", viewer=dad)
check("(setup) Dad has two labels", sum(1 for v, _, _ in label_rows() if v == dad) == 2, str(label_rows()))
check("(setup) Dad is removed", c.delete(f"/api/people/{dad}", headers=H(PAR)).status_code == 200)
check("*** every label Dad set, and every label on Dad, is gone ***",
      not any(dad in (v, p) for v, p, _ in label_rows()), str(label_rows()))
# A card a connection put on the friend's login, labelled by the friend for themselves, then Stop sharing.
lab2 = c.post("/api/people", json={"name": "Second"}, headers=H(LAB)).json()["id"]
mom_on_lab = next(p["id"] for p in c.get("/api/people", headers=H(LAB)).json()["people"] if p.get("profile_name") == "Mom")
check("(setup) the friend's second person labels Mom 'Auntie' just for themselves",
      put(LAB, mom_on_lab, "Auntie", viewer=lab2).status_code == 200 and people(LAB, lab2)[mom_on_lab]["name"] == "Auntie")
check("*** ...and the parents never see it ***", "Auntie" not in json.dumps(people(PAR)) and "Auntie" not in json.dumps(people(PAR, mom)))
c.delete(f"/api/people/{mom_on_lab}/link", headers=H(LAB))
check("*** Stop sharing removes that card, and the label on it goes with it ***",
      mom_on_lab not in people(LAB) and not any(p == mom_on_lab for _, p, _ in label_rows()), str(label_rows()))

section("the privacy page")
d = c.get("/api/what-we-store").json()
desc = {r["table"]: r["what"] for r in d["stores"]}
check("*** the new table is described, and nothing is undocumented ***",
      d["undocumented"] == [] and "person_labels" in desc and "just for themselves" in desc["person_labels"], str(d["undocumented"]))
check("...it says who sees it, and that removing a person removes it",
      "never to the person it names" in desc["person_labels"] and "Removing either person removes it" in desc["person_labels"])
check("the site's banned words are not in it", not any(w in desc["person_labels"].lower() for w in ("account", "token", "identity", "instance", "widget")))

section("Postgres-safe SQL (a review, kept honest by a check)")
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "db.py"), encoding="utf-8").read()
check("*** both schema blocks create person_labels, with the key the upsert names ***",
      src.count("CREATE TABLE IF NOT EXISTS person_labels") == 2 and src.count("PRIMARY KEY (account_id, viewer_id, person_id)") == 2
      and "ON CONFLICT(account_id, viewer_id, person_id)" in src)
check("no SQLite-only syntax", not any(w in src for w in ("INSERT OR ", "IFNULL(", "GROUP_CONCAT", "datetime('now')")))
check("the three places a person row is deleted each drop its labels", src.count("self._drop_person_labels(cur,") == 3)

try:
    shutil.rmtree(tmp, ignore_errors=True)
except Exception:  # noqa: BLE001
    pass

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
