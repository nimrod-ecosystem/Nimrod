"""tag_answer_kinds.py - mark the trivia questions whose right answer is a PERSON or a CHARACTER.

Row 2.63 (Mike, 2026-10-07): Name that person, in the mixed game, asks about known people and characters ("who came
up with the theory of relativity or which character did this"), not only a household's own. The question packs
already hold many such questions, so they are TAGGED rather than written again: each such item gets

    "answerKind": "person"      a real person (an author, a painter, a president, a scientist)
    "answerKind": "character"   somebody made up, in a story, a film, a cartoon or a myth

and Name that person draws every trivia question so tagged (modules/name_that.js `knownBank`). packs.js refuses any
other value.

HOW AN ITEM IS CHOSEN. Not by guessing from the question's wording, which gets "Which big cat ...?" and "Which
country was Picasso from?" wrong. By its RIGHT ANSWER: the names below were read off every pack, one by one, by the
person (or Claude pass) running this, and kept here so the next run decides the same way. An answer that is also
something else (Neptune is a god and a planet) carries the words its question must contain to count.
Left out on purpose: a band ("Bill Haley and His Comets"), two people in one answer ("Shakespeare and Pope"), an
answer list with "Both of them" in it (Name that offers names, and "both" is not one), and an answer with a
description glued on ("Paul Brown, their first coach").

USE (from web/):
    py -3.13 tools/tag_answer_kinds.py            tag every pack in client/packs and client/packs_review; say what changed
    py -3.13 tools/tag_answer_kinds.py --check    change nothing; exit 1 if a pack is not tagged as this list says
    py -3.13 tools/tag_answer_kinds.py --suggest  also list untagged questions that look like they ask for somebody
                                                  (Who ...? Which painter ...?), to read and add to the lists below
Re-runnable: a tag this list no longer gives is taken off. The files are edited as text, one line after each item's
"correct" line, so a pack's own layout is kept and a diff shows only the tags.
"""
import json
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
FOLDERS = [WEB / "client" / "packs", WEB / "client" / "packs_review"]

# ------------------------------------------------------------------------------------------------------------------
# THE NAMES (right answers exactly as the packs write them)
# ------------------------------------------------------------------------------------------------------------------
PEOPLE = {
    # painters and sculptors
    "John Singleton Copley", "George Bellows", "Vincent van Gogh", "Frederic Edwin Church", "Claude Monet",
    "Edgar Degas", "Frans Hals", "Thomas Eakins", "Jacques-Louis David", "Charles Sheeler", "Michelangelo",
    "Edvard Munch", "Leonardo da Vinci", "Johannes Vermeer", "Salvador Dali", "Rembrandt", "Sandro Botticelli",
    "Edward Hopper", "Auguste Rodin", "Grant Wood", "Diego Velazquez", "Hieronymus Bosch", "Jan van Eyck",
    "John Constable", "J. M. W. Turner", "Emanuel Leutze", "Caravaggio", "Andy Warhol",
    # writers and poets
    "Jane Austen", "William Shakespeare", "J. K. Rowling", "Dr. Seuss", "Mark Twain", "Charles Dickens", "Roald Dahl",
    "Louisa May Alcott", "J. R. R. Tolkien", "Beatrix Potter", "Agatha Christie", "Robert Frost", "Bram Stoker",
    "Margaret Wise Brown", "John Steinbeck", "Niccolò Machiavelli", "Virgil",
    # leaders, explorers and people in history
    "George Washington", "Abraham Lincoln", "Thomas Jefferson", "John Adams", "Theodore Roosevelt",
    "Franklin D. Roosevelt", "Ulysses S. Grant", "William Howard Taft", "Julius Caesar", "Augustus", "Hadrian",
    "Tutankhamun", "Queen Victoria", "King George III", "Sejong the Great", "Sequoyah", "Martin Luther King Jr.",
    "Sandra Day O'Connor", "Clara Barton", "Amelia Earhart", "Vasco da Gama", "Roald Amundsen", "Moses Cleaveland",
    "Neil Armstrong", "Buzz Aldrin", "Michael Collins", "Yuri Gagarin", "Sally Ride", "Valentina Tereshkova",
    "Mae Jemison", "Venetia Burney", "George W. Lewis",
    # thinkers, scientists, mathematicians, inventors
    "Aristotle", "Pythagoras", "Euclid", "Brahmagupta", "Al-Khwarizmi", "Robert Recorde", "William Jones", "John Wallis",
    "Srinivasa Ramanujan", "Andrew Wiles", "Galileo Galilei", "Isaac Newton", "William Herschel", "Giuseppe Piazzi",
    "Charles Darwin", "Albert Einstein", "Werner Heisenberg", "Dmitri Mendeleev", "Henri Becquerel", "Marie Curie",
    "Alexander Fleming", "Alfred Wegener", "Carl Sagan", "Johannes Gutenberg", "Alexander Graham Bell", "Thomas Edison",
    "Orville Wright", "Karl Drais", "Gideon Sundback", "Frank M. Robinson", "Bartolomeo Cristofori",
    # music
    "Antonio Vivaldi", "Joseph Haydn", "Beethoven", "Johann Strauss II", "Georges Bizet", "Pyotr Ilyich Tchaikovsky",
    "Claude Debussy", "George Gershwin", "Leonard Bernstein", "Max Steiner", "Henry Mancini", "John Williams",
    "Paul Desmond", "Benny Goodman", "Billie Holiday", "Bing Crosby", "Frank Sinatra", "Mel Tormé", "Elvis Presley",
    "Johnny Cash", "Carl Perkins", "Roy Orbison", "Ringo Starr", "Mick Jagger", "Aretha Franklin", "Diana Ross",
    "Dolly Parton", "Bruce Springsteen", "Michael Jackson", "Prince", "Celine Dion", "Pharrell Williams", "Bruno Mars",
    "Bob Dylan", "Berry Gordy Jr.",
    # film, television and sport
    "Judy Garland", "Julie Andrews", "Humphrey Bogart", "Gregory Peck", "Anne Bancroft", "Jack Haley", "Harpo",
    "Tom Hanks", "Harrison Ford", "Leonardo DiCaprio", "Christopher Lloyd", "Peter Falk", "Vanna White", "Johnny Carson",
    "Steve Allen", "Rod Serling", "Steven Spielberg", "Michael Curtiz", "John G. Avildsen", "Hattie McDaniel",
    "Andrew Stanton", "John Lasseter", "Christopher Nolan", "Hayao Miyazaki", "Bong Joon Ho", "Jonathan Demme",
    "Blanton Collier",
}
CHARACTERS = {
    "Fonzie", "The Tramp", "Kermit", "Hagrid", "Long John Silver", "Nick Carraway", "Holly Golightly", "Ricky", "Wilma",
    "Superman", "Neptune", "Janus",
    # people_and_characters_ai_unreviewed.json (written 2026-10-07 for the levels this list left thin)
    "Snoopy", "Bugs Bunny",
    "Pinocchio", "Cinderella", "Peter Pan", "Winnie-the-Pooh", "Mickey Mouse", "Dorothy", "Sherlock Holmes", "Alice",
    "Ebenezer Scrooge", "Shrek", "Batman", "Robin Hood", "Scarecrow", "Fred Flintstone", "Wilbur", "Captain Ahab",
    "Hercule Poirot", "Albus Dumbledore", "Gandalf", "Huckleberry Finn", "King Arthur", "Professor Moriarty", "Mr. Darcy",
    "Hamlet", "Jim Hawkins", "Jo March", "Sancho Panza", "Hercules", "Merlin", "C. Auguste Dupin",
}
# An answer that is ALSO something else: its question must contain one of these words to count.
ONLY_WHEN = {
    "Neptune": r"\bgod\b",          # also a planet
    "Janus": r"\bgod\b",
    "Prince": r"\bsang\b|\bsinger\b",
    "Dorothy": r"\bOz\b",
    "Alice": r"\brabbit\b|\bWonderland\b",
    "Wilbur": r"\bpig\b",
    "Ricky": r"\bLucy\b",
    "Wilma": r"\bFlintstones?\b",
    "Augustus": r"\bemperor\b",
    "Hamlet": r"\bprince\b|\bcharacter\b",
    "Shrek": r"\bogre\b",           # also a film ("Which film won the first Oscar for Best Animated Feature?")
    "Hercules": r"\bhero\b|\bmyth",
    "Merlin": r"\bwizard\b|\bArthur",
}
NOT_A_NAME = re.compile(r"\b(both|neither|none)\b", re.I)
LOOKS_LIKE_SOMEBODY = re.compile(
    r"^(who|whose|whom)\b|\b(which|what)\s+(\w+\s+){0,3}(person|man|woman|president|painter|artist|author|writer|poet|"
    r"scientist|inventor|explorer|composer|singer|character|king|queen|leader|astronaut|actor|actress|athlete|"
    r"musician|philosopher|physicist|chemist|mathematician|emperor|pharaoh|detective|prince|princess|wizard)\b", re.I)

# A tag as this script writes it: on a line of its own after the "correct" line, or (a pack written one item per
# line) right after "correct": "...", on the same line.
KIND_TAG = re.compile(r'(?:\r?\n[ \t]*| )"answerKind": "[^"]*",')
CORRECT = re.compile(r'"correct"\s*:\s*"(?:[^"\\]|\\.)*"\s*,')


def kind_of(item):
    """'person', 'character' or None for one trivia item."""
    correct = item.get("correct")
    if not isinstance(correct, str):
        return None
    if any(NOT_A_NAME.search(str(a)) for a in item.get("answers") or []):
        return None
    need = ONLY_WHEN.get(correct)
    if need and not re.search(need, item.get("question", ""), re.I):
        return None
    if correct in PEOPLE:
        return "person"
    if correct in CHARACTERS:
        return "character"
    return None


def retag(text, pack):
    """The pack's text with every item's answerKind as kind_of says; None when it cannot be done safely."""
    items = pack.get("items") or []
    base = KIND_TAG.sub("", text)
    spots = list(CORRECT.finditer(base))
    if len(spots) != len(items):
        return None
    out, at = [], 0
    for m, item in zip(spots, items):
        out.append(base[at:m.end()])
        kind = kind_of(item)
        if kind:
            # The layout around it: a "correct" on a line of its own gets the tag on the next line, indented the same.
            rest = base[m.end():]
            nl = "\r\n" if rest.startswith("\r\n") else ("\n" if rest.startswith("\n") else "")
            if nl:
                line_start = base.rfind("\n", 0, m.start()) + 1
                indent = re.match(r"[ \t]*", base[line_start:]).group(0)
                out.append(f'{nl}{indent}"answerKind": "{kind}",')
            else:
                out.append(f' "answerKind": "{kind}",')
        at = m.end()
    out.append(base[at:])
    return "".join(out)


def main(argv):
    check = "--check" in argv
    suggest = "--suggest" in argv
    totals, changed, problems, hints = {}, [], [], []
    for folder in FOLDERS:
        for path in sorted(folder.glob("*.json")):
            text = path.read_text(encoding="utf-8")
            pack = json.loads(text)
            if pack.get("kind") != "trivia":
                continue
            new = retag(text, pack)
            if new is None:
                problems.append(f"{path.name}: could not place the tags safely (each item needs one \"correct\": \"...\", with another key after it)")
                continue
            # The text must say exactly what the pack says, plus the tags: nothing else may move.
            want = json.loads(text)
            for item in want["items"]:
                item.pop("answerKind", None)
                kind = kind_of(item)
                if kind:
                    item["answerKind"] = kind
            if json.loads(new) != want:
                problems.append(f"{path.name}: the edited text does not read back as the pack plus its tags")
                continue
            for item in want["items"]:
                kind = item.get("answerKind")
                if kind:
                    key = (kind, item.get("difficulty") or "none", "packs" if folder.name == "packs" else "packs_review")
                    totals[key] = totals.get(key, 0) + 1
                elif suggest and LOOKS_LIKE_SOMEBODY.search(item.get("question", "")):
                    hints.append(f"{path.name}: {item.get('question')} => {item.get('correct')}")
            if new != text:
                changed.append(path.name)
                if not check:
                    path.write_bytes(new.encode("utf-8"))
    for p in problems:
        print("PROBLEM", p)
    print(("would change" if check else "changed"), len(changed), "pack(s)", ", ".join(changed))
    for kind in ("person", "character"):
        n = sum(v for k, v in totals.items() if k[0] == kind)
        by = ", ".join(f"{d} {sum(v for k, v in totals.items() if k[0] == kind and k[1] == d)}"
                       for d in ("very easy", "easy", "medium", "hard", "none")
                       if any(k[0] == kind and k[1] == d for k in totals))
        shipped = sum(v for k, v in totals.items() if k[0] == kind and k[2] == "packs")
        print(f"{kind}: {n} tagged ({by}); {shipped} of them in packs/ (shipped), the rest waiting for review")
    if suggest:
        print(f"\n{len(hints)} untagged question(s) that look like they ask for somebody (read each; add real ones above):")
        for h in hints:
            print("  ", h)
    return 1 if problems or (check and changed) else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main(sys.argv[1:]))
