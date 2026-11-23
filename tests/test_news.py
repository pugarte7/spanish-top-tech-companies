#!/usr/bin/env python3
"""news.py keeps only an answer that points at a headline it was given."""
import datetime
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))
import news

TODAY = datetime.date(2026, 11, 22)
READ = [{"title": "Acme abre oficina en Málaga", "date": "2026-11-20", "source": "Expansión",
         "url": "https://news.example/1"},
        {"title": "Acme gana un premio", "date": "2026-11-18", "source": "El País",
         "url": "https://news.example/2"}]
ACME = {"name": "Acme", "levels": "acme", "web": "https://acme.example"}

# An empty or broken answer from Google News is "not read"; an empty feed is "no headlines".
news.get = lambda url, limit=0: ""
assert news.headlines("Acme", TODAY) is None
news.get = lambda url, limit=0: "<rss><channel></channel></rss>"
assert news.headlines("Acme", TODAY) == []


def latest(answer, read=READ, key="k"):
    news.headlines = lambda name, today: read
    news.ask = lambda api_key, model, text: answer
    return news.latest(ACME, {}, TODAY, key, "m")


good = {"found": True, "i": 1, "es": "Acme abrió una oficina en Málaga.", "en": "Acme opened an office in Málaga."}
text, found, read = latest(good)
assert found == {"es": good["es"], "en": good["en"], "date": "2026-11-20", "source": "Expansión",
                 "url": "https://news.example/1"}, found
assert read == READ and "1. [2026-11-20] Acme abre oficina en Málaga (Expansión)" in text

# Nothing picked, a number off the list, a missing language, a sentence too long: no news.
for bad in ({"found": False, "i": 0, "es": "", "en": ""}, {**good, "i": 3}, {**good, "i": 0},
            {**good, "en": ""}, {**good, "es": "x" * (news.LATEST_MAX + 1)}, {**good, "i": "1"}):
    assert latest(bad)[1] is None, bad
# No answer from the model is a failure, told apart from "no news".
assert latest(None)[1] == {}
# Google News not answering is a failure too, never "no headlines".
assert latest(good, read=None)[1:] == ({}, [])
# No headlines: the model is not asked.
assert latest(good, read=[])[1:] == (None, [])
print("all passed")
