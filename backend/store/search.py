"""Case-insensitive search that works for Cyrillic on SQLite and PostgreSQL.

SQLite's LIKE folds ASCII letters only, so ``name_ru__icontains="молоко"`` never matches
"Молоко". Instead every product keeps a denormalized ``search_text`` column that is already
casefolded, and queries are casefolded the same way before a plain ``contains`` lookup.
"""

MAX_QUERY_LENGTH = 100
MAX_TERMS = 8


def normalize_text(value: str) -> str:
    """Casefold, treat "ё" as "е", and collapse whitespace."""
    return " ".join(value.casefold().replace("ё", "е").split())


def build_search_text(*fields: str) -> str:
    # One field per line: a normalized query never contains "\n", so a match cannot
    # straddle two fields.
    return "\n".join(normalize_text(field) for field in fields if field)


def search_terms(query: str | None) -> list[str]:
    """Split a user query into normalized terms. Every term must match (AND)."""
    if not query:
        return []
    return normalize_text(query[:MAX_QUERY_LENGTH]).split()[:MAX_TERMS]
